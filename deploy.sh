#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"

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

ensure_agent_network() {
  if [[ "$ENABLE_NETWORK_ACL" != "1" ]]; then
    return
  fi

  if ! incus_cmd network acl show "$INCUS_ACL" >/dev/null 2>&1; then
    log "creating Incus network ACL $INCUS_ACL"
    incus_cmd network acl create "$INCUS_ACL"
  fi

  incus_cmd network acl edit "$INCUS_ACL" <<EOF
name: $INCUS_ACL
description: "Deny egress from incus-web agent containers to local/LAN ranges while allowing Internet."
egress:
  - action: reject
    state: enabled
    description: "Block RFC1918 private LAN ranges"
    destination: 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16
  - action: reject
    state: enabled
    description: "Block IPv4 link-local"
    destination: 169.254.0.0/16
ingress: []
config: {}
EOF

  if ! incus_cmd network show "$INCUS_NETWORK" >/dev/null 2>&1; then
    log "creating Incus bridge $INCUS_NETWORK"
    incus_cmd network create "$INCUS_NETWORK" \
      --type=bridge \
      "ipv4.address=$INCUS_NETWORK_IPV4" \
      ipv4.nat=true \
      ipv6.address=none \
      ipv6.nat=false
  fi

  log "applying $INCUS_ACL to $INCUS_NETWORK"
  incus_cmd network set "$INCUS_NETWORK" security.acls="$INCUS_ACL"
  incus_cmd network set "$INCUS_NETWORK" security.acls.default.egress.action=allow
  incus_cmd network set "$INCUS_NETWORK" security.acls.default.ingress.action=drop
}

resolve_profile_yaml() {
  if [[ -f "$INCUS_PROFILE_YAML" ]]; then
    return
  fi

  log "downloading Incus profile YAML from $INCUS_PROFILE_URL"
  INCUS_PROFILE_YAML="$(mktemp)"
  curl -fsSL "$INCUS_PROFILE_URL" -o "$INCUS_PROFILE_YAML"
}

ensure_incus_profile() {
  resolve_profile_yaml

  if ! incus_cmd profile show "$INCUS_PROFILE_NAME" >/dev/null 2>&1; then
    log "creating Incus profile $INCUS_PROFILE_NAME"
    incus_cmd profile create "$INCUS_PROFILE_NAME"
  fi

  log "applying Incus profile source of truth $INCUS_PROFILE_YAML"
  incus_cmd profile edit "$INCUS_PROFILE_NAME" <"$INCUS_PROFILE_YAML"
}

ensure_profile_paths() {
  sudo_cmd install -d -m 755 /srv/incus-web/default-workspace
}

wait_for_running() {
  local name="$1"
  local state=""

  for _ in $(seq 1 90); do
    state="$(incus_cmd info "$name" 2>/dev/null | awk -F': ' '$1 == "Status" {print $2; exit}' || true)"
    if [[ "$state" == "RUNNING" ]]; then
      return
    fi
    sleep 1
  done

  die "$name did not reach RUNNING state"
}

wait_for_network() {
  local name="$1"

  for _ in $(seq 1 45); do
    if incus_cmd exec "$name" -- getent hosts deb.debian.org >/dev/null 2>&1; then
      return
    fi
    sleep 2
  done

  log "$name does not have DHCP/DNS yet; trying static IPv4 fallback"
  configure_static_ipv4 "$name"

  for _ in $(seq 1 30); do
    if incus_cmd exec "$name" -- getent hosts deb.debian.org >/dev/null 2>&1; then
      return
    fi
    sleep 2
  done

  die "$name does not have working DNS/network access"
}

prefix_len_to_netmask() {
  local bits="$1"
  local mask=""
  local value

  for value in 1 2 3 4; do
    if (( bits >= 8 )); then
      mask="${mask}255"
      bits=$((bits - 8))
    elif (( bits > 0 )); then
      mask="${mask}$((256 - (1 << (8 - bits))))"
      bits=0
    else
      mask="${mask}0"
    fi
    [[ "$value" == "4" ]] || mask="${mask}."
  done

  printf '%s\n' "$mask"
}

pick_static_ipv4() {
  local bridge_cidr="$1"
  local gateway="${bridge_cidr%/*}"
  local prefix="${gateway%.*}"
  local seed
  local candidate

  if [[ -n "${CONTAINER_IPV4:-}" ]]; then
    printf '%s\n' "$CONTAINER_IPV4"
    return
  fi

  seed="$(printf '%s' "$CONTAINER_NAME" | cksum | awk '{print $1}')"
  for offset in $(seq 0 149); do
    candidate="${prefix}.$((50 + ((seed + offset) % 150)))"
    if ! ping -c 1 -W 1 "$candidate" >/dev/null 2>&1; then
      printf '%s\n' "$candidate"
      return
    fi
  done

  die "could not find an unused IPv4 address on $INCUS_NETWORK; set CONTAINER_IPV4 in .env"
}

configure_static_ipv4() {
  local name="$1"
  local bridge_cidr
  local gateway
  local prefix_len
  local ipv4

  bridge_cidr="$(incus_cmd network get "$INCUS_NETWORK" ipv4.address 2>/dev/null || true)"
  [[ -n "$bridge_cidr" && "$bridge_cidr" != "none" && "$bridge_cidr" == */* ]] || die "could not read ipv4.address from Incus network $INCUS_NETWORK"

  gateway="${bridge_cidr%/*}"
  prefix_len="${bridge_cidr#*/}"
  ipv4="$(pick_static_ipv4 "$bridge_cidr")"

  log "configuring $name with static IPv4 $ipv4/$prefix_len via $gateway"
  incus_cmd config device set "$name" eth0 ipv4.address "$ipv4" >/dev/null 2>&1 || true
  container_bash "$name" "set -euo pipefail
cat >/etc/systemd/network/10-incus-web-eth0.network <<EOF
[Match]
Name=eth0

[Network]
Address=$ipv4/$prefix_len
Gateway=$gateway
DNS=$gateway
IPv6AcceptRA=yes
EOF
ip addr flush dev eth0 || true
ip addr add '$ipv4/$prefix_len' dev eth0
ip link set eth0 up
ip route replace default via '$gateway' dev eth0
printf 'nameserver $gateway\n' >/etc/resolv.conf"
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
  # This script is evaluated inside the container; keep expansions there.
  # shellcheck disable=SC2016
  container_bash "$name" 'export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y \
  build-essential \
  ca-certificates \
  cargo \
  curl \
  git \
  golang-go \
  gnupg \
  jq \
  libssl-dev \
  netcat-openbsd \
  nodejs \
  npm \
  pkg-config \
  python3 \
  python3-pip \
  python3-venv \
  rustc \
  sudo \
  unzip \
  zip
if ! command -v gh >/dev/null 2>&1; then
  mkdir -p /etc/apt/keyrings
  curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg \
    | tee /etc/apt/keyrings/githubcli-archive-keyring.gpg >/dev/null
  chmod go+r /etc/apt/keyrings/githubcli-archive-keyring.gpg
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" \
    >/etc/apt/sources.list.d/github-cli.list
  apt-get update
  apt-get install -y gh
fi
if ! command -v tailscale >/dev/null 2>&1; then
  curl -fsSL https://tailscale.com/install.sh | sh
fi
if ! command -v claude >/dev/null 2>&1; then
  npm install -g @anthropic-ai/claude-code
fi
if ! command -v wetty >/dev/null 2>&1; then
  npm install -g wetty
fi'

  log "configuring user, workspace, developer tools, tailscaled, and wetty"
  container_bash "$name" "set -euo pipefail
if ! id -u '$WEB_USER' >/dev/null 2>&1; then
  useradd -m -s /bin/bash '$WEB_USER'
fi
install -d -o '$WEB_USER' -g '$WEB_USER' '$CONTAINER_WORKSPACE'
usermod -aG sudo '$WEB_USER'
printf '%s ALL=(ALL) NOPASSWD:ALL\n' '$WEB_USER' >/etc/sudoers.d/incus-web-user
chmod 440 /etc/sudoers.d/incus-web-user
printf '%s\n' \
  '#!/usr/bin/env bash' \
  'set -euo pipefail' \
  '' \
  'export HOME=/home/$WEB_USER' \
  'export USER=$WEB_USER' \
  'export LOGNAME=$WEB_USER' \
  'export PATH=\"\$HOME/.local/bin:/usr/local/bin:/usr/bin:/bin:\$PATH\"' \
  '' \
  'cd $CONTAINER_WORKSPACE 2>/dev/null || cd \"\$HOME\"' \
  'exec \"\$@\"' \
  >/usr/local/bin/agent-env
chmod 755 /usr/local/bin/agent-env
if ! grep -q '/usr/local/bin' /home/'$WEB_USER'/.bashrc 2>/dev/null; then
  cat >>/home/'$WEB_USER'/.bashrc <<'EOF'

export PATH=\"\$HOME/.local/bin:/usr/local/bin:\$PATH\"
cd '$CONTAINER_WORKSPACE' 2>/dev/null || true
EOF
fi
chown '$WEB_USER':'$WEB_USER' /home/'$WEB_USER'/.bashrc
if ! runuser -u '$WEB_USER' -- bash -lc 'command -v codex >/dev/null 2>&1'; then
  runuser -u '$WEB_USER' -- bash -lc 'cd \"\$HOME\" && curl -fsSL https://chatgpt.com/codex/install.sh | CODEX_NON_INTERACTIVE=1 sh'
fi
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
  # Expand the Tailscale values inside the container after sourcing the pushed env file.
  # shellcheck disable=SC2016
  container_bash "$name" 'set -euo pipefail
. /etc/incus-web/tailscale.env
tailscale up --authkey="$TS_AUTHKEY" --hostname="$TS_HOSTNAME" $TS_EXTRA_ARGS
tailscale serve --bg --https="$TAILSCALE_SERVE_PORT" "http://127.0.0.1:$WETTY_PORT"
rm -f /etc/incus-web/tailscale.env
tailscale serve status'
}

validate_container() {
  local name="$1"

  log "validating toolchain and network boundaries"

  agent_check() {
    local command="$1"
    container_bash "$name" "su -l '$WEB_USER' -c '/usr/local/bin/agent-env $command'"
  }

  expect_blocked_lan() {
    local host="$1"
    local port="$2"
    if agent_check "nc -vz -w 2 $host $port" >/tmp/incus-web-lan-check.log 2>&1; then
      cat /tmp/incus-web-lan-check.log >&2
      die "LAN egress unexpectedly succeeded: $host:$port"
    fi
  }

  agent_check "node --version"
  agent_check "npm --version"
  agent_check "python3 --version"
  agent_check "go version"
  agent_check "rustc -V"
  agent_check "cargo -V"
  agent_check "git --version"
  agent_check "gh --version"
  agent_check "claude --version"
  agent_check "codex --version"
  container_bash "$name" "tailscale version >/dev/null"
  container_bash "$name" "tailscale status >/dev/null"
  agent_check "nc -vz -w 5 1.1.1.1 443"
  expect_blocked_lan 10.0.0.1 80
  expect_blocked_lan 172.16.0.1 80
  expect_blocked_lan 192.168.0.1 80
  expect_blocked_lan 169.254.0.1 80
}

main() {
  load_env

  CONTAINER_NAME="${CONTAINER_NAME:-incus-web}"
  IMAGE="${IMAGE:-images:debian/trixie}"
  RECREATE="${FORCE_RECREATE:-${RECREATE:-0}}"
  INCUS_NETWORK="${INCUS_NETWORK:-agentbr0}"
  INCUS_NETWORK_IPV4="${INCUS_NETWORK_IPV4:-198.18.0.1/15}"
  INCUS_ACL="${INCUS_ACL:-agent-block-lan}"
  ENABLE_NETWORK_ACL="${ENABLE_NETWORK_ACL:-1}"
  INCUS_PROFILE_NAME="${INCUS_PROFILE_NAME:-incus-web-agent}"
  INCUS_PROFILE_YAML="${INCUS_PROFILE_YAML:-$SCRIPT_DIR/incus-web-profile.yaml}"
  INCUS_PROFILE_URL="${INCUS_PROFILE_URL:-https://raw.githubusercontent.com/jmagar/incus-web/main/incus-web-profile.yaml}"
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
  ensure_agent_network
  ensure_profile_paths
  ensure_incus_profile

  if incus_cmd list "$CONTAINER_NAME" --format csv -c n | grep -qx "$CONTAINER_NAME"; then
    if [[ "$RECREATE" == "1" ]]; then
      log "deleting existing container $CONTAINER_NAME"
      incus_cmd delete "$CONTAINER_NAME" --force
    else
      log "reusing existing container $CONTAINER_NAME"
      wait_for_running "$CONTAINER_NAME"
      wait_for_network "$CONTAINER_NAME"
      provision_container "$CONTAINER_NAME"
      push_secret_env "$CONTAINER_NAME"
      join_tailnet_and_serve "$CONTAINER_NAME"
      validate_container "$CONTAINER_NAME"
      log "ready"
      log "container: $CONTAINER_NAME"
      log "workspace: $HOST_WORKSPACE -> $CONTAINER_WORKSPACE"
      log "tailnet host: $TS_HOSTNAME"
      return
    fi
  fi

  log "creating host workspace $HOST_WORKSPACE"
  mkdir -p "$HOST_WORKSPACE"

  log "creating $CONTAINER_NAME from $IMAGE"
  incus_cmd init "$IMAGE" "$CONTAINER_NAME" \
    --profile default \
    --profile "$INCUS_PROFILE_NAME"

  log "applying runtime device overrides"
  incus_cmd config device override "$CONTAINER_NAME" eth0 network="$INCUS_NETWORK"
  incus_cmd config device override "$CONTAINER_NAME" workspace source="$HOST_WORKSPACE" path="$CONTAINER_WORKSPACE" shift="$DISK_SHIFT"

  log "starting $CONTAINER_NAME"
  incus_cmd start "$CONTAINER_NAME"
  wait_for_running "$CONTAINER_NAME"

  wait_for_network "$CONTAINER_NAME"
  provision_container "$CONTAINER_NAME"
  push_secret_env "$CONTAINER_NAME"
  join_tailnet_and_serve "$CONTAINER_NAME"
  validate_container "$CONTAINER_NAME"

  log "ready"
  log "container: $CONTAINER_NAME"
  log "workspace: $HOST_WORKSPACE -> $CONTAINER_WORKSPACE"
  log "tailnet host: $TS_HOSTNAME"
}

main "$@"
