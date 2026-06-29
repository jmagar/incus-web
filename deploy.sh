#!/usr/bin/env bash
set -euo pipefail

INCUS_WEB_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"
INCUS_WEB_LIB="$INCUS_WEB_ROOT/scripts/incus-web-lib.sh"
INCUS_WEB_LIB_URL="${INCUS_WEB_LIB_URL:-https://raw.githubusercontent.com/jmagar/incus-web/main/scripts/incus-web-lib.sh}"

if [[ -f "$INCUS_WEB_LIB" ]]; then
  # shellcheck source=scripts/incus-web-lib.sh
  . "$INCUS_WEB_LIB"
else
  INCUS_WEB_LIB_TMP="$(mktemp)"
  curl -fsSL "$INCUS_WEB_LIB_URL" -o "$INCUS_WEB_LIB_TMP"
  # shellcheck disable=SC1090
  . "$INCUS_WEB_LIB_TMP"
fi

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
  ACCESS_MODE="${ACCESS_MODE:-tailscale}"
  TS_HOSTNAME="${TS_HOSTNAME:-$CONTAINER_NAME}"
  TS_EXTRA_ARGS="${TS_EXTRA_ARGS:---accept-routes=false}"
  TAILSCALE_SERVE_PORT="${TAILSCALE_SERVE_PORT:-443}"
  PUBLIC_URL="${PUBLIC_URL:-}"
  OIDC_ISSUER_URL="${OIDC_ISSUER_URL:-}"
  OIDC_CLIENT_ID="${OIDC_CLIENT_ID:-}"
  OIDC_CLIENT_SECRET="${OIDC_CLIENT_SECRET:-}"
  OIDC_COOKIE_SECRET="${OIDC_COOKIE_SECRET:-}"
  OIDC_EMAIL_DOMAINS="${OIDC_EMAIL_DOMAINS:-*}"
  OIDC_ALLOWED_EMAILS="${OIDC_ALLOWED_EMAILS:-}"
  OIDC_PROVIDER_DISPLAY_NAME="${OIDC_PROVIDER_DISPLAY_NAME:-OIDC}"
  OIDC_PROXY_PORT="${OIDC_PROXY_PORT:-4180}"
  OIDC_HOST_BIND="${OIDC_HOST_BIND:-127.0.0.1}"
  OIDC_HOST_PORT="${OIDC_HOST_PORT:-}"
  OIDC_COOKIE_SECURE="${OIDC_COOKIE_SECURE:-true}"
  OIDC_REVERSE_PROXY="${OIDC_REVERSE_PROXY:-true}"
  OIDC_SKIP_PROVIDER_BUTTON="${OIDC_SKIP_PROVIDER_BUTTON:-true}"
  OIDC_COOKIE_REFRESH="${OIDC_COOKIE_REFRESH:-1h}"
  OIDC_COOKIE_EXPIRE="${OIDC_COOKIE_EXPIRE:-8h}"
  OAUTH2_PROXY_VERSION="${OAUTH2_PROXY_VERSION:-v7.15.3}"
  TERMINAL_BACKEND="${TERMINAL_BACKEND:-wetty}"
  GHOSTTY_WEB_DEMO_VERSION="${GHOSTTY_WEB_DEMO_VERSION:-0.4.0-next.20.g1858a59}"
  SETUP_PORT="${SETUP_PORT:-3080}"
  SETUP_ENABLED="${SETUP_ENABLED:-1}"
  IDENTITY_PROXY_PORT="${IDENTITY_PROXY_PORT:-3090}"
  INCUS_WEB_BOOTSTRAP_SERVER="${INCUS_WEB_BOOTSTRAP_SERVER:-$SCRIPT_DIR/scripts/bootstrap-server.mjs}"
  INCUS_WEB_BOOTSTRAP_SERVER_URL="${INCUS_WEB_BOOTSTRAP_SERVER_URL:-https://raw.githubusercontent.com/jmagar/incus-web/main/scripts/bootstrap-server.mjs}"
  INCUS_WEB_IDENTITY_PROXY="${INCUS_WEB_IDENTITY_PROXY:-$SCRIPT_DIR/scripts/identity-proxy.mjs}"
  INCUS_WEB_IDENTITY_PROXY_URL="${INCUS_WEB_IDENTITY_PROXY_URL:-https://raw.githubusercontent.com/jmagar/incus-web/main/scripts/identity-proxy.mjs}"
  INCUS_WEB_INFO_SCRIPT="${INCUS_WEB_INFO_SCRIPT:-$SCRIPT_DIR/scripts/incus-web-info.sh}"
  INCUS_WEB_INFO_SCRIPT_URL="${INCUS_WEB_INFO_SCRIPT_URL:-https://raw.githubusercontent.com/jmagar/incus-web/main/scripts/incus-web-info.sh}"
  INCUS_WEB_OPEN_SCRIPT="${INCUS_WEB_OPEN_SCRIPT:-$SCRIPT_DIR/scripts/incus-web-open.sh}"
  INCUS_WEB_OPEN_SCRIPT_URL="${INCUS_WEB_OPEN_SCRIPT_URL:-https://raw.githubusercontent.com/jmagar/incus-web/main/scripts/incus-web-open.sh}"
  WETTY_PORT="${WETTY_PORT:-3000}"
  WEB_USER="${WEB_USER:-agent}"
  INCUS_WEB_WORKSPACE_LABEL="${INCUS_WEB_WORKSPACE_LABEL:-}"
  if [[ -z "$INCUS_WEB_WORKSPACE_LABEL" && -n "$OIDC_ALLOWED_EMAILS" && "$OIDC_ALLOWED_EMAILS" != *","* && "$OIDC_ALLOWED_EMAILS" != *" "* ]]; then
    INCUS_WEB_WORKSPACE_LABEL="$OIDC_ALLOWED_EMAILS"
  fi
  DOTFILES_REPO="${DOTFILES_REPO:-}"
  DOTFILES_SOURCE_DIR="${DOTFILES_SOURCE_DIR:-}"
  DOTFILES_AGE_KEY_FILE="${DOTFILES_AGE_KEY_FILE:-}"
  DOTFILES_RUN_MISE="${DOTFILES_RUN_MISE:-0}"
  DOTFILES_SKIP_APT="${DOTFILES_SKIP_APT:-1}"
  HOST_WORKSPACE="${HOST_WORKSPACE:-$HOME/incus-web-data/$CONTAINER_NAME}"
  CONTAINER_WORKSPACE="${CONTAINER_WORKSPACE:-/workspace}"
  DISK_SHIFT="${DISK_SHIFT:-true}"

  case "$ACCESS_MODE" in
    tailscale)
      require_var TS_AUTHKEY
      ;;
    oidc)
      require_var PUBLIC_URL
      require_var OIDC_ISSUER_URL
      require_var OIDC_CLIENT_ID
      require_var OIDC_CLIENT_SECRET
      ;;
    *)
      die "ACCESS_MODE must be tailscale or oidc"
      ;;
  esac

  case "$TERMINAL_BACKEND" in
    wetty|ghostty-web)
      ;;
    *)
      die "TERMINAL_BACKEND must be wetty or ghostty-web"
      ;;
  esac

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
      configure_access "$CONTAINER_NAME"
      validate_container "$CONTAINER_NAME"
      log "ready"
      log "container: $CONTAINER_NAME"
      log "workspace: $HOST_WORKSPACE -> $CONTAINER_WORKSPACE"
      log "access mode: $ACCESS_MODE"
      [[ "$ACCESS_MODE" == "tailscale" ]] && log "tailnet host: $TS_HOSTNAME"
      [[ "$ACCESS_MODE" == "oidc" ]] && log "public URL: $PUBLIC_URL"
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
  configure_access "$CONTAINER_NAME"
  validate_container "$CONTAINER_NAME"

  log "ready"
  log "container: $CONTAINER_NAME"
  log "workspace: $HOST_WORKSPACE -> $CONTAINER_WORKSPACE"
  log "access mode: $ACCESS_MODE"
  [[ "$ACCESS_MODE" == "tailscale" ]] && log "tailnet host: $TS_HOSTNAME"
  [[ "$ACCESS_MODE" == "oidc" ]] && log "public URL: $PUBLIC_URL"
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  main "$@"
fi
