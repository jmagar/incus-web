#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
deploy="$root/deploy.sh"
profile="$root/incus-web-profile.yaml"
definition="$root/distrobuilder.yaml"
build_image="$root/scripts/build-image.sh"
lib="$root/scripts/incus-web-lib.sh"
info_script="$root/scripts/incus-web-info.sh"
smoke_image="$root/scripts/smoke-image.sh"
workflow="$root/.github/workflows/build-image.yml"

require_literal() {
  local needle="$1"
  if ! grep -Fq -- "$needle" "$deploy" "$lib"; then
    printf 'missing expected deploy surface content: %s\n' "$needle" >&2
    exit 1
  fi
}

require_info_literal() {
  local needle="$1"
  if ! grep -Fq -- "$needle" "$info_script"; then
    printf 'missing expected info script content: %s\n' "$needle" >&2
    exit 1
  fi
}

require_literal "validate_container()"
require_literal "validating toolchain and network boundaries"
require_literal "ACCESS_MODE="
require_literal "node --version"
require_literal "npm --version"
require_literal "python3 --version"
require_literal "go version"
require_literal "rustc -V"
require_literal "cargo -V"
require_literal "git --version"
require_literal "gh --version"
require_literal "zsh --version"
require_literal "claude --version"
require_literal "codex --version"
require_literal "tailscale version"
require_literal "tailscale status"
require_literal "configure_oidc_proxy()"
require_literal "ensure_oauth2_proxy_installed()"
require_literal "push_oidc_env()"
require_literal "oauth2-proxy --version"
require_literal "systemctl is-active --quiet oauth2-proxy"
require_literal "http://127.0.0.1:\$OIDC_PROXY_PORT/oauth2/sign_in"
require_literal "OIDC_ISSUER_URL="
require_literal "OIDC_CLIENT_ID="
require_literal "OIDC_CLIENT_SECRET="
require_literal "OIDC_COOKIE_SECRET="
require_literal "cut -c1-32"
require_literal "OIDC_HOST_PORT="
require_literal "OAUTH2_PROXY_VERSION="
require_literal "TERMINAL_BACKEND="
require_literal "GHOSTTY_WEB_DEMO_VERSION="
require_literal "SETUP_ENABLED="
require_literal "SETUP_PORT="
require_literal "SETUP_ALLOWED_EMAILS="
require_literal "SETUP_ALLOW_KEY_PERSISTENCE="
require_literal "SETUP_COMMAND_TIMEOUT_MS="
require_literal "IDENTITY_PROXY_PORT="
require_literal "OAUTH2_PROXY_URL=http://127.0.0.1:\$OIDC_PROXY_PORT"
require_literal "incus-web-bootstrap-server"
require_literal "incus-web-identity-proxy"
require_literal "incus-web-info"
require_literal "incus-web-open"
require_literal "INCUS_WEB_INFO_SCRIPT"
require_literal "INCUS_WEB_IDENTITY_PROXY"
require_literal "INCUS_WEB_OPEN_SCRIPT"
require_literal "BROWSER=/usr/local/bin/incus-web-open"
require_literal "INCUS_WEB_WORKSPACE_LABEL="
require_literal "--upstream=\"http://127.0.0.1:\$SETUP_PORT/setup/\""
require_literal "GHOSTTY_ALLOWED_HOSTS"
require_literal "public_host=\"\${PUBLIC_URL#*://}\""
require_literal "DOTFILES_REPO="
require_literal "DOTFILES_SOURCE_DIR="
require_literal "DOTFILES_RUN_MISE="
require_literal "DOTFILES_SKIP_APT="
require_literal "incus-web-dotfiles-source.tgz"
require_literal "chezmoi --source"
require_info_literal "check_commands()"
require_info_literal "check_packages()"
require_info_literal "check_mise()"
require_info_literal "check_dotfiles()"
require_info_literal "base packages installed"
require_info_literal "source clean"
if grep -Fq -- "labelFromBearer" "$root/scripts/identity-proxy.mjs"; then
  printf 'identity proxy must not trust unsigned bearer-token labels\n' >&2
  exit 1
fi
if ! grep -Fq -- "queryUserinfo" "$root/scripts/identity-proxy.mjs"; then
  printf 'missing expected identity proxy userinfo fallback\n' >&2
  exit 1
fi
for needle in \
  "apps/web/**" \
  "npm ci --prefix apps/web" \
  "npm --prefix apps/web run lint" \
  "npm --prefix apps/web run test" \
  "npm --prefix apps/web run build"; do
  if ! grep -Fq -- "$needle" "$workflow"; then
    printf 'missing expected web CI content: %s\n' "$needle" >&2
    exit 1
  fi
done
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
require_literal "if [[ \"\${BASH_SOURCE[0]}\" == \"\$0\" ]]; then"
require_literal "INCUS_WEB_LIB_URL="
require_literal "raw.githubusercontent.com/jmagar/incus-web/main/scripts/incus-web-lib.sh"
require_literal "curl -fsSL \"\$INCUS_WEB_LIB_URL\" -o \"\$INCUS_WEB_LIB_TMP\""

if [[ ! -f "$lib" ]]; then
  printf 'missing shared provisioning library: %s\n' "$lib" >&2
  exit 1
fi

for needle in \
  "provision_container()" \
  "ensure_tailscale_installed()" \
  "validate_container()" \
  "SCRIPT_DIR="; do
  if ! grep -Fq -- "$needle" "$lib"; then
    printf 'missing expected shared library content: %s\n' "$needle" >&2
    exit 1
  fi
done

if [[ ! -f "$profile" ]]; then
  printf 'missing Incus profile source of truth: %s\n' "$profile" >&2
  exit 1
fi

for needle in \
  "name: incus-web-agent" \
  "security.privileged: \"false\"" \
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

if [[ ! -f "$build_image" ]]; then
  printf 'missing CI image build script: %s\n' "$build_image" >&2
  exit 1
fi

if [[ ! -f "$definition" ]]; then
  printf 'missing distrobuilder image definition: %s\n' "$definition" >&2
  exit 1
fi

for needle in \
  "downloader: debootstrap" \
  "release: trixie" \
  "name: incus-web-agent" \
  "build-essential" \
  "zsh" \
  "golang-go" \
  "rustc" \
  "latest-v22.x" \
  "npm install -g @anthropic-ai/claude-code" \
  "npm install -g wetty" \
  "@ghostty-web/demo@0.4.0-next.20.g1858a59" \
  "ghostty-web-demo" \
  "tailscale.com/install.sh" \
  "npm install -g @openai/codex" \
  "systemctl enable wetty.service" \
  "systemctl enable tailscaled.service"; do
  if ! grep -Fq -- "$needle" "$definition"; then
    printf 'missing expected distrobuilder content: %s\n' "$needle" >&2
    exit 1
  fi
done

# shellcheck disable=SC2016
for needle in \
  "DISTROBUILDER_YAML" \
  "distrobuilder build-incus" \
  "IMAGE_ALIAS" \
  "BUILD_TYPE" \
  "mv \"\$EXPORT_DIR/incus.tar.xz\" \"\$EXPORT_DIR/\$IMAGE_ALIAS.tar.xz\""; do
  if ! grep -Fq -- "$needle" "$build_image"; then
    printf 'missing expected build-image.sh content: %s\n' "$needle" >&2
    exit 1
  fi
done

if [[ ! -f "$smoke_image" ]]; then
  printf 'missing exported image smoke script: %s\n' "$smoke_image" >&2
  exit 1
fi

# shellcheck disable=SC2016
for needle in \
  '. "$ROOT/scripts/incus-web-lib.sh"' \
  "incus_cmd image import \"\$image_tar\" --alias \"\$SMOKE_IMAGE_ALIAS\"" \
  "incus_cmd init \"\$SMOKE_IMAGE_ALIAS\" \"\$SMOKE_CONTAINER_NAME\"" \
  "node --version" \
  "python3 --version" \
  "go version" \
  "rustc -V" \
  "claude --version" \
  "tailscale version" \
  "codex --version"; do
  if ! grep -Fq -- "$needle" "$smoke_image"; then
    printf 'missing expected smoke-image.sh content: %s\n' "$needle" >&2
    exit 1
  fi
done

if [[ ! -f "$workflow" ]]; then
  printf 'missing CI image workflow: %s\n' "$workflow" >&2
  exit 1
fi

for needle in \
  "name: Build Incus image" \
  "pull_request:" \
  "runs-on: ubuntu-latest" \
  "distrobuilder.yaml" \
  "scripts/build-image.sh" \
  "scripts/incus-web-lib.sh" \
  "scripts/smoke-image.sh" \
  "bash tests/deploy_static_tests.sh" \
  "shellcheck debootstrap squashfs-tools" \
  "snap install distrobuilder --classic" \
  "sudo incus admin init --minimal" \
  "sudo -E ./scripts/build-image.sh" \
  "sudo -E ./scripts/smoke-image.sh" \
  "contents: write" \
  "actions/upload-artifact@v4" \
  "if: github.event_name == 'push' && github.ref == 'refs/heads/main'" \
  "retention-days: 14" \
  "Publish rolling latest release" \
  "RELEASE_TAG: incus-web-agent-latest" \
  "git tag -f \"\$RELEASE_TAG\" \"\$GITHUB_SHA\"" \
  "git push -f origin \"\$RELEASE_TAG\"" \
  "gh release upload \"\$RELEASE_TAG\" dist/* --clobber" \
  "incus-web-agent-image"; do
  if ! grep -Fq -- "$needle" "$workflow"; then
    printf 'missing expected workflow content: %s\n' "$needle" >&2
    exit 1
  fi
done

printf 'deploy validation checks are wired\n'
