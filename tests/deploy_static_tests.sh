#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
deploy="$root/deploy.sh"
profile="$root/incus-web-profile.yaml"

require_literal() {
  local needle="$1"
  if ! grep -Fq -- "$needle" "$deploy"; then
    printf 'missing expected deploy.sh content: %s\n' "$needle" >&2
    exit 1
  fi
}

require_literal "validate_container()"
require_literal "validating toolchain and network boundaries"
require_literal "node --version"
require_literal "npm --version"
require_literal "python3 --version"
require_literal "go version"
require_literal "rustc -V"
require_literal "cargo -V"
require_literal "git --version"
require_literal "gh --version"
require_literal "claude --version"
require_literal "codex --version"
require_literal "tailscale version"
require_literal "tailscale status"
require_literal "nc -vz -w 5 1.1.1.1 443"
require_literal "expect_blocked_lan 10.0.0.1 80"
require_literal "expect_blocked_lan 172.16.0.1 80"
require_literal "expect_blocked_lan 192.168.0.1 80"
require_literal "expect_blocked_lan 169.254.0.1 80"
require_literal "validate_container \"\$CONTAINER_NAME\""
require_literal "INCUS_PROFILE_YAML="
require_literal "INCUS_PROFILE_NAME="
require_literal "INCUS_PROFILE_URL="
require_literal "ensure_incus_profile()"
require_literal "ensure_profile_paths()"
require_literal "sudo_cmd install -d -m 755 /srv/incus-web/default-workspace"
require_literal "resolve_profile_yaml()"
require_literal "incus_cmd profile edit \"\$INCUS_PROFILE_NAME\" <\"\$INCUS_PROFILE_YAML\""
require_literal "incus_cmd init \"\$IMAGE\" \"\$CONTAINER_NAME\" \\"
require_literal "--profile default \\"
require_literal "--profile \"\$INCUS_PROFILE_NAME\""
require_literal "incus_cmd config device override \"\$CONTAINER_NAME\" eth0 network=\"\$INCUS_NETWORK\""
require_literal "incus_cmd config device override \"\$CONTAINER_NAME\" workspace source=\"\$HOST_WORKSPACE\" path=\"\$CONTAINER_WORKSPACE\" shift=\"\$DISK_SHIFT\""
require_literal "incus_cmd start \"\$CONTAINER_NAME\""

if [[ ! -f "$profile" ]]; then
  printf 'missing Incus profile source of truth: %s\n' "$profile" >&2
  exit 1
fi

for needle in \
  "name: incus-web-agent" \
  "security.privileged: \"true\"" \
  "security.nesting: \"true\"" \
  "limits.cpu: \"2\"" \
  "limits.memory: 4GiB" \
  "limits.memory.enforce: \"hard\"" \
  "limits.processes: \"2048\"" \
  "network: agentbr0" \
  "source: /srv/incus-web/default-workspace" \
  "path: /workspace" \
  "shift: \"true\""; do
  if ! grep -Fq -- "$needle" "$profile"; then
    printf 'missing expected profile content: %s\n' "$needle" >&2
    exit 1
  fi
done

printf 'deploy validation checks are wired\n'
