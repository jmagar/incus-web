#!/usr/bin/env bash
set -euo pipefail

log() {
  printf '[incus-web] %s\n' "$*"
}

die() {
  printf '[incus-web] error: %s\n' "$*" >&2
  exit 1
}

have() {
  command -v "$1" >/dev/null 2>&1
}

load_env() {
  local env_file="${ENV_FILE:-.env}"
  if [[ -f "$env_file" ]]; then
    log "loading $env_file"
    set -a
    # shellcheck disable=SC1090
    . "$env_file"
    set +a
  fi
}

require_var() {
  local name="$1"
  local value="${!name:-}"
  [[ -n "$value" ]] || die "$name is required. Create .env from .env.example or export $name."
}

sudo_cmd() {
  if [[ "$(id -u)" -eq 0 ]]; then
    "$@"
  else
    sudo "$@"
  fi
}

install_incus_if_needed() {
  if have incus; then
    return
  fi

  have apt-get || die "incus is not installed and this script only knows how to install it with apt-get"
  have sudo || [[ "$(id -u)" -eq 0 ]] || die "sudo is required to install incus"

  log "installing incus"
  sudo_cmd apt-get update
  sudo_cmd apt-get install -y incus uidmap squashfs-tools
}

INCUS_USE_SUDO=0

incus_cmd() {
  if [[ "$INCUS_USE_SUDO" == "1" ]]; then
    sudo incus "$@"
  else
    incus "$@"
  fi
}

ensure_incus_ready() {
  if incus version >/dev/null 2>&1; then
    return
  fi

  if have sudo && sudo incus version >/dev/null 2>&1; then
    INCUS_USE_SUDO=1
    return
  fi

  have sudo || [[ "$(id -u)" -eq 0 ]] || die "incus is installed but not usable by this user; add the user to incus-admin or run with sudo"

  log "initializing incus with minimal defaults"
  sudo_cmd incus admin init --minimal

  if sudo_cmd incus version >/dev/null 2>&1; then
    INCUS_USE_SUDO=1
    return
  fi

  die "incus did not become usable after initialization"
}

wait_for_running() {
  local name="$1"
  local state=""

  for _ in $(seq 1 90); do
    state="$(incus_cmd list "$name" --format csv -c s 2>/dev/null || true)"
    if [[ "$state" == "RUNNING" ]]; then
      return
    fi
    sleep 1
  done

  die "$name did not reach RUNNING state"
}

wait_for_network() {
  local name="$1"

  for _ in $(seq 1 90); do
    if incus_cmd exec "$name" -- getent hosts deb.debian.org >/dev/null 2>&1; then
      return
    fi
    sleep 2
  done

  die "$name does not have working DNS/network access"
}

container_bash() {
  local name="$1"
  shift
  incus_cmd exec "$name" -- bash -lc "$*"
}

push_secret_env() {
  local name="$1"
  local tmp_file

  tmp_file="$(mktemp)"
  chmod 600 "$tmp_file"
  {
    printf 'TS_AUTHKEY=%q\n' "$TS_AUTHKEY"
    printf 'TS_HOSTNAME=%q\n' "$TS_HOSTNAME"
    printf 'TS_EXTRA_ARGS=%q\n' "$TS_EXTRA_ARGS"
    printf 'TAILSCALE_SERVE_PORT=%q\n' "$TAILSCALE_SERVE_PORT"
    printf 'WETTY_PORT=%q\n' "$WETTY_PORT"
  } >"$tmp_file"

  incus_cmd exec "$name" -- install -d -m 700 /etc/incus-web
  incus_cmd file push "$tmp_file" "$name/etc/incus-web/tailscale.env"
  incus_cmd exec "$name" -- chmod 600 /etc/incus-web/tailscale.env
  rm -f "$tmp_file"
}

provision_container() {
  local name="$1"

  log "installing container packages"
  container_bash "$name" 'export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y ca-certificates curl gnupg sudo nodejs npm
if ! command -v tailscale >/dev/null 2>&1; then
  curl -fsSL https://tailscale.com/install.sh | sh
fi
if ! command -v wetty >/dev/null 2>&1; then
  npm install -g wetty
fi'

  log "configuring user, workspace, tailscaled, and wetty"
  container_bash "$name" "set -euo pipefail
if ! id -u '$WEB_USER' >/dev/null 2>&1; then
  useradd -m -s /bin/bash '$WEB_USER'
fi
install -d -o '$WEB_USER' -g '$WEB_USER' '$CONTAINER_WORKSPACE'
usermod -aG sudo '$WEB_USER'
printf '%s ALL=(ALL) NOPASSWD:ALL\n' '$WEB_USER' >/etc/sudoers.d/incus-web-user
chmod 440 /etc/sudoers.d/incus-web-user
install -d -m 755 /etc/default
cat >/etc/default/tailscaled <<'EOF'
PORT=\"41641\"
FLAGS=\"--tun=userspace-networking\"
EOF
cat >/etc/systemd/system/wetty.service <<EOF
[Unit]
Description=WeTTY browser terminal
After=network-online.target
Wants=network-online.target

[Service]
Environment=HOME=/home/$WEB_USER
ExecStart=/usr/local/bin/wetty --host 127.0.0.1 --port $WETTY_PORT --base / --command 'runuser -u $WEB_USER -- /bin/bash -l'
Restart=always
RestartSec=2

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable --now tailscaled
systemctl enable --now wetty"
}

join_tailnet_and_serve() {
  local name="$1"

  log "joining tailnet and configuring tailscale serve"
  container_bash "$name" 'set -euo pipefail
. /etc/incus-web/tailscale.env
tailscale up --authkey="$TS_AUTHKEY" --hostname="$TS_HOSTNAME" $TS_EXTRA_ARGS
tailscale serve --bg --https="$TAILSCALE_SERVE_PORT" "http://127.0.0.1:$WETTY_PORT"
rm -f /etc/incus-web/tailscale.env
tailscale serve status'
}

main() {
  load_env

  CONTAINER_NAME="${CONTAINER_NAME:-incus-web}"
  IMAGE="${IMAGE:-images:debian/trixie/cloud}"
  RECREATE="${RECREATE:-0}"
  TS_HOSTNAME="${TS_HOSTNAME:-$CONTAINER_NAME}"
  TS_EXTRA_ARGS="${TS_EXTRA_ARGS:---accept-routes=false}"
  TAILSCALE_SERVE_PORT="${TAILSCALE_SERVE_PORT:-443}"
  WETTY_PORT="${WETTY_PORT:-3000}"
  WEB_USER="${WEB_USER:-agent}"
  HOST_WORKSPACE="${HOST_WORKSPACE:-$HOME/incus-web-data/$CONTAINER_NAME}"
  CONTAINER_WORKSPACE="${CONTAINER_WORKSPACE:-/workspace}"
  DISK_SHIFT="${DISK_SHIFT:-true}"

  require_var TS_AUTHKEY

  install_incus_if_needed
  ensure_incus_ready

  if incus_cmd list "$CONTAINER_NAME" --format csv -c n | grep -qx "$CONTAINER_NAME"; then
    if [[ "$RECREATE" == "1" ]]; then
      log "deleting existing container $CONTAINER_NAME"
      incus_cmd delete "$CONTAINER_NAME" --force
    else
      die "container $CONTAINER_NAME already exists. Set RECREATE=1 to replace it."
    fi
  fi

  log "creating host workspace $HOST_WORKSPACE"
  mkdir -p "$HOST_WORKSPACE"

  log "launching $CONTAINER_NAME from $IMAGE"
  incus_cmd launch "$IMAGE" "$CONTAINER_NAME"
  wait_for_running "$CONTAINER_NAME"

  log "mounting $HOST_WORKSPACE at $CONTAINER_WORKSPACE"
  incus_cmd config device add "$CONTAINER_NAME" workspace disk source="$HOST_WORKSPACE" path="$CONTAINER_WORKSPACE" shift="$DISK_SHIFT"

  wait_for_network "$CONTAINER_NAME"
  provision_container "$CONTAINER_NAME"
  push_secret_env "$CONTAINER_NAME"
  join_tailnet_and_serve "$CONTAINER_NAME"

  log "ready"
  log "container: $CONTAINER_NAME"
  log "workspace: $HOST_WORKSPACE -> $CONTAINER_WORKSPACE"
  log "tailnet host: $TS_HOSTNAME"
}

main "$@"
