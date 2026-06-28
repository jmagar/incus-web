#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# Reuse the deploy-time provisioning functions so the CI image and live deploys
# are built from the same source of truth.
# shellcheck source=scripts/incus-web-lib.sh disable=SC1091
. "$ROOT/scripts/incus-web-lib.sh"

CONTAINER_NAME="${BUILD_CONTAINER_NAME:-incus-web-image-build}"
IMAGE="${BUILD_BASE_IMAGE:-images:debian/trixie}"
IMAGE_ALIAS="${IMAGE_ALIAS:-incus-web-agent}"
IMAGE_DESCRIPTION="${IMAGE_DESCRIPTION:-incus-web agent image built from ${GITHUB_SHA:-local}}"
BUILD_GIT_SHA="${BUILD_GIT_SHA:-${GITHUB_SHA:-local}}"
BUILD_GITHUB_REPOSITORY="${BUILD_GITHUB_REPOSITORY:-${GITHUB_REPOSITORY:-local}}"
BUILD_GITHUB_RUN_ID="${BUILD_GITHUB_RUN_ID:-${GITHUB_RUN_ID:-local}}"
BUILD_GITHUB_SERVER_URL="${BUILD_GITHUB_SERVER_URL:-${GITHUB_SERVER_URL:-https://github.com}}"
BUILD_GITHUB_RUN_URL="${BUILD_GITHUB_RUN_URL:-$BUILD_GITHUB_SERVER_URL/$BUILD_GITHUB_REPOSITORY/actions/runs/$BUILD_GITHUB_RUN_ID}"
EXPORT_DIR="${EXPORT_DIR:-$ROOT/dist}"
EXPORT_NAME="${EXPORT_NAME:-$IMAGE_ALIAS}"
RECREATE="${FORCE_RECREATE:-${RECREATE:-1}}"
INCUS_NETWORK="${INCUS_NETWORK:-agentbr0}"
INCUS_NETWORK_IPV4="${INCUS_NETWORK_IPV4:-198.18.0.1/15}"
INCUS_ACL="${INCUS_ACL:-agent-block-lan}"
ENABLE_NETWORK_ACL="${ENABLE_NETWORK_ACL:-1}"
INCUS_PROFILE_NAME="${INCUS_PROFILE_NAME:-incus-web-agent}"
INCUS_PROFILE_YAML="${INCUS_PROFILE_YAML:-$ROOT/incus-web-profile.yaml}"
INCUS_PROFILE_URL="${INCUS_PROFILE_URL:-https://raw.githubusercontent.com/jmagar/incus-web/main/incus-web-profile.yaml}"
WETTY_PORT="${WETTY_PORT:-3000}"
WEB_USER="${WEB_USER:-agent}"
HOST_WORKSPACE="${HOST_WORKSPACE:-$HOME/incus-web-data/$CONTAINER_NAME}"
CONTAINER_WORKSPACE="${CONTAINER_WORKSPACE:-/workspace}"
DISK_SHIFT="${DISK_SHIFT:-true}"

install_incus_if_needed
ensure_incus_ready
ensure_agent_network
ensure_profile_paths
ensure_incus_profile

if incus_cmd list "$CONTAINER_NAME" --format csv -c n | grep -qx "$CONTAINER_NAME"; then
  if [[ "$RECREATE" == "1" ]]; then
    log "deleting existing build container $CONTAINER_NAME"
    incus_cmd delete "$CONTAINER_NAME" --force
  else
    die "$CONTAINER_NAME already exists. Set RECREATE=1 or BUILD_CONTAINER_NAME to a different name."
  fi
fi

mkdir -p "$HOST_WORKSPACE" "$EXPORT_DIR"

log "creating image build container $CONTAINER_NAME from $IMAGE"
incus_cmd init "$IMAGE" "$CONTAINER_NAME" \
  --profile default \
  --profile "$INCUS_PROFILE_NAME"
incus_cmd config device override "$CONTAINER_NAME" eth0 network="$INCUS_NETWORK"
incus_cmd config device override "$CONTAINER_NAME" workspace source="$HOST_WORKSPACE" path="$CONTAINER_WORKSPACE" shift="$DISK_SHIFT"
incus_cmd start "$CONTAINER_NAME"
wait_for_running "$CONTAINER_NAME"
wait_for_network "$CONTAINER_NAME"

provision_container "$CONTAINER_NAME"
ensure_tailscale_installed "$CONTAINER_NAME"

log "cleaning image state before publish"
container_bash "$CONTAINER_NAME" 'set -euo pipefail
systemctl disable --now wetty >/dev/null 2>&1 || true
systemctl disable --now tailscaled >/dev/null 2>&1 || true
rm -rf /etc/incus-web /tmp/* /var/tmp/*
rm -f /root/.bash_history /home/*/.bash_history
apt-get clean
rm -rf /var/lib/apt/lists/*
find /var/log -type f -exec truncate -s 0 {} + 2>/dev/null || true'

log "publishing $IMAGE_ALIAS"
incus_cmd stop "$CONTAINER_NAME" --timeout 120
incus_cmd snapshot create "$CONTAINER_NAME" image-ready
incus_cmd publish "$CONTAINER_NAME/image-ready" \
  --alias "$IMAGE_ALIAS" \
  --reuse \
  "description=$IMAGE_DESCRIPTION" \
  "incus-web.commit=$BUILD_GIT_SHA" \
  "incus-web.repository=$BUILD_GITHUB_REPOSITORY" \
  "incus-web.run_id=$BUILD_GITHUB_RUN_ID" \
  "incus-web.run_url=$BUILD_GITHUB_RUN_URL"

log "exporting image artifacts to $EXPORT_DIR"
incus_cmd image export "$IMAGE_ALIAS" "$EXPORT_DIR/$EXPORT_NAME"
ls -lh "$EXPORT_DIR"
