# incus-web

`incus-web` creates an Incus container, installs a browser terminal inside it, and exposes that terminal through either Tailscale Serve or an in-container OIDC reverse proxy.

The deploy script is meant to be curlable, but it does not bake secrets into the repository. Put your access-mode secrets in a local `.env` file, keep that file out of git, then run the script from the same directory.

## What It Creates

- An Incus container from `images:debian/trixie` by default.
- A non-root terminal user named `agent` by default.
- A small demo developer toolchain: zsh, Node/npm, Python, Go, Rust/Cargo, Git, GitHub CLI, Claude Code, and Codex CLI.
- A browser terminal listening inside the container on `127.0.0.1:3000`, using WeTTY by default or the experimental `ghostty-web` backend when enabled.
- One of two access layers:
  - Tailscale running inside the nested, unprivileged system container with a `tailscale serve` HTTPS route.
  - `oauth2-proxy` running inside the container as an OIDC-authenticated reverse proxy in front of WeTTY.
- A dedicated Incus bridge with an ACL that blocks direct egress to RFC1918 and IPv4 link-local LAN ranges.
- A committed Incus profile YAML (`incus-web-profile.yaml`) as the source of truth for the container shape, including `security.privileged=false` and `security.nesting=true`.
- A host directory mounted into the container for persistent working files.

## Requirements

- Linux host with `bash`, `curl`, and `sudo`.
- For `ACCESS_MODE=tailscale`: a Tailscale tailnet where HTTPS certs and Serve are enabled, plus a Tailscale auth key. Ephemeral auth keys are recommended for disposable containers.
- For `ACCESS_MODE=oidc`: an OIDC provider app with callback URL `$PUBLIC_URL/oauth2/callback`. If TLS terminates before the container, keep `OIDC_REVERSE_PROXY=true`.

If Incus is missing, `deploy.sh` attempts to install it with `apt-get` and initialize it with minimal defaults.

The Incus container shape lives in `incus-web-profile.yaml`: profile config, the NIC, and the workspace disk device. Provisioning is intentionally handled by `deploy.sh` after the container launches. The demo does not use cloud-init, so packages, users, services, and agent setup stay in one procedural code path instead of drifting between image metadata and this repository.

## CI Image Build

GitHub Actions builds an Incus image on pull requests and pushes to `main` when the deploy script, runtime profile, `distrobuilder.yaml`, image scripts, static tests, or workflow change. The workflow runs on GitHub-hosted `ubuntu-latest`, validates the shell code, builds the Debian Trixie image from `distrobuilder.yaml`, imports the exported tarball, and launches a smoke-test container from that exported artifact.

Pushes to `main` upload the exported Incus image as the short-lived `incus-web-agent-image` workflow artifact with a 14-day retention period, then publish the same exported image to the rolling GitHub Release `incus-web-agent-latest`. Pull requests build and smoke-test the image but do not upload artifacts or update the release.

The image recipe installs the system toolchains from Debian packages, installs Node/npm from the upstream Node 22 tarball, then installs Claude Code, WeTTY, Tailscale, GitHub CLI, and Codex CLI during the distrobuilder `post-packages` hook.

To build the image locally:

```bash
./scripts/build-image.sh
```

Useful overrides:

```bash
DISTROBUILDER_YAML=$PWD/distrobuilder.yaml
IMAGE_ALIAS=incus-web-agent
EXPORT_DIR=$PWD/dist
BUILD_TYPE=unified
```

The exported artifact can be imported on another Incus host and used as the deploy base image:

```bash
incus image import dist/incus-web-agent.tar.xz --alias incus-web-agent
IMAGE=incus-web-agent ./deploy.sh
```

For the durable rolling build, download `incus-web-agent.tar.xz` from the `incus-web-agent-latest` GitHub Release instead of relying on the expiring Actions artifact.

## Quick Start

Create a working directory and a `.env` file:

```bash
mkdir -p ~/incus-web-run
cd ~/incus-web-run
curl -fsSLO https://raw.githubusercontent.com/jmagar/incus-web/main/.env.example
cp .env.example .env
chmod 600 .env
editor .env
```

Run the deploy script:

```bash
curl -fsSL https://raw.githubusercontent.com/jmagar/incus-web/main/deploy.sh | bash
```

The script loads `.env` from the current directory.

Rerunning `deploy.sh` is safe after a partial or successful run. By default it reuses the existing container and reruns provisioning, Tailscale Serve setup, and validation. Set `RECREATE=1` in `.env`, or run with `FORCE_RECREATE=1`, to delete and rebuild the container.

## Configuration

`.env` uses shell-compatible `KEY=value` lines.

```bash
TS_AUTHKEY=tskey-auth-example
ACCESS_MODE=tailscale
CONTAINER_NAME=incus-web
IMAGE=images:debian/trixie
RECREATE=0
INCUS_NETWORK=agentbr0
INCUS_NETWORK_IPV4=198.18.0.1/15
INCUS_ACL=agent-block-lan
ENABLE_NETWORK_ACL=1
INCUS_PROFILE_NAME=incus-web-agent
INCUS_PROFILE_YAML=
CONTAINER_IPV4=
TS_HOSTNAME=incus-web
TS_EXTRA_ARGS=--accept-routes=false
TAILSCALE_SERVE_PORT=443
PUBLIC_URL=https://incus-web.example.com
OIDC_ISSUER_URL=https://issuer.example.com
OIDC_CLIENT_ID=incus-web
OIDC_CLIENT_SECRET=change-me
OIDC_COOKIE_SECRET=
OIDC_EMAIL_DOMAINS=*
OIDC_ALLOWED_EMAILS=
OIDC_PROVIDER_DISPLAY_NAME=OIDC
OIDC_PROXY_PORT=4180
OIDC_HOST_BIND=127.0.0.1
OIDC_HOST_PORT=
OIDC_COOKIE_SECURE=true
OIDC_REVERSE_PROXY=true
OIDC_SKIP_PROVIDER_BUTTON=true
OIDC_COOKIE_REFRESH=1h
OIDC_COOKIE_EXPIRE=8h
OAUTH2_PROXY_VERSION=v7.15.3
TERMINAL_BACKEND=wetty
GHOSTTY_WEB_DEMO_VERSION=0.4.0-next.20.g1858a59
WETTY_PORT=3000
WEB_USER=agent
DOTFILES_REPO=
DOTFILES_AGE_KEY_FILE=
DOTFILES_RUN_MISE=0
HOST_WORKSPACE=$HOME/incus-web-data/incus-web
CONTAINER_WORKSPACE=/workspace
DISK_SHIFT=true
```

Important variables:

- `ACCESS_MODE`: `tailscale` or `oidc`. Defaults to `tailscale`.
- `TS_AUTHKEY`: required Tailscale auth key for `tailscale up` when `ACCESS_MODE=tailscale`.
- `CONTAINER_NAME`: local Incus container name.
- `RECREATE`: set to `1` to delete and recreate an existing container with the same name.
- `FORCE_RECREATE`: command-scoped override for `RECREATE`; useful for one-off rebuilds without editing `.env`.
- `IMAGE`: Incus image to launch. Defaults to a non-cloud Debian image because provisioning is handled by `deploy.sh`.
- `INCUS_NETWORK`: managed Incus bridge used by the container.
- `INCUS_NETWORK_IPV4`: IPv4 CIDR used when creating the bridge. The default uses the lab/benchmarking range from the Incus jail article to avoid common home LAN collisions.
- `INCUS_ACL`: Incus network ACL name for the LAN egress deny list.
- `ENABLE_NETWORK_ACL`: set to `0` to skip bridge/ACL management when using a pre-existing custom network.
- `INCUS_PROFILE_NAME`: Incus profile name created/updated from `incus-web-profile.yaml`.
- `INCUS_PROFILE_YAML`: optional path to a local profile YAML. When unset, `deploy.sh` uses the repo file next to the script or downloads it for curl-piped runs.
- `CONTAINER_IPV4`: optional static IPv4 to assign if DHCP does not come up.
- `TS_HOSTNAME`: tailnet hostname assigned to the container.
- `TS_EXTRA_ARGS`: extra flags passed to `tailscale up`; defaults to `--accept-routes=false`.
- `TAILSCALE_SERVE_PORT`: HTTPS port exposed by `tailscale serve`.
- `PUBLIC_URL`: external URL for the OIDC-protected terminal when `ACCESS_MODE=oidc`.
- `OIDC_ISSUER_URL`: OIDC issuer URL.
- `OIDC_CLIENT_ID`: OIDC client ID.
- `OIDC_CLIENT_SECRET`: OIDC client secret.
- `OIDC_COOKIE_SECRET`: oauth2-proxy cookie secret. Leave blank to generate a per-container secret during deploy.
- `OIDC_EMAIL_DOMAINS`: allowed email domain for oauth2-proxy. `*` allows any authenticated email from the provider.
- `OIDC_ALLOWED_EMAILS`: optional comma- or space-separated email allow list. When set, deploy writes `/etc/incus-web/authenticated-emails`.
- `OIDC_PROVIDER_DISPLAY_NAME`: label shown on the oauth2-proxy login button.
- `OIDC_PROXY_PORT`: oauth2-proxy listen port inside the container.
- `OIDC_HOST_BIND` and `OIDC_HOST_PORT`: optional Incus proxy device bind address and port. Leave `OIDC_HOST_PORT` blank to expose oauth2-proxy only on the container network.
- `OIDC_COOKIE_SECURE`: set to `true` when using HTTPS, including TLS termination in front of the container.
- `OIDC_REVERSE_PROXY`: set to `true` when another proxy terminates TLS before oauth2-proxy.
- `OIDC_SKIP_PROVIDER_BUTTON`: skip the oauth2-proxy provider selection page.
- `OIDC_COOKIE_REFRESH` and `OIDC_COOKIE_EXPIRE`: oauth2-proxy cookie lifetime controls.
- `OAUTH2_PROXY_VERSION`: oauth2-proxy release to install.
- `TERMINAL_BACKEND`: `wetty` or `ghostty-web`. Ghostty-web is experimental and still runs behind the same access layer.
- `GHOSTTY_WEB_DEMO_VERSION`: `@ghostty-web/demo` package version used by the experimental backend. The default pins the `next` build that includes same-origin WebSocket token checks.
- `WETTY_PORT`: local WeTTY HTTP port inside the container.
- `WEB_USER`: non-root terminal user created inside the container.
- `DOTFILES_REPO`: optional chezmoi source, passed to `chezmoi init --apply` as the terminal user.
- `DOTFILES_AGE_KEY_FILE`: optional host path copied to `~/.config/chezmoi/key.txt` for encrypted chezmoi secrets.
- `DOTFILES_RUN_MISE`: set to `1` to install mise for the terminal user and run `mise install` after dotfiles apply.
- `HOST_WORKSPACE`: host path mounted into the container.
- `CONTAINER_WORKSPACE`: mount point inside the container.
- `DISK_SHIFT`: use Incus idmapped shifting for the mounted workspace.

## Example

```bash
mkdir -p ~/incus-web-demo
cd ~/incus-web-demo
cat >.env <<'EOF'
TS_AUTHKEY=tskey-auth-your-key
CONTAINER_NAME=incus-web-demo
TS_HOSTNAME=incus-web-demo
HOST_WORKSPACE=$HOME/incus-web-data/demo
CONTAINER_WORKSPACE=/workspace
RECREATE=1
EOF
chmod 600 .env
curl -fsSL https://raw.githubusercontent.com/jmagar/incus-web/main/deploy.sh | bash
```

When it finishes, open the Tailscale HTTPS URL for `TS_HOSTNAME`. The script also prints `tailscale serve status` from inside the container.

For OIDC mode:

```bash
cat >.env <<'EOF'
ACCESS_MODE=oidc
CONTAINER_NAME=incus-web-oidc
PUBLIC_URL=https://incus-web.example.com
OIDC_ISSUER_URL=https://issuer.example.com
OIDC_CLIENT_ID=incus-web
OIDC_CLIENT_SECRET=change-me
OIDC_EMAIL_DOMAINS=example.com
OIDC_HOST_BIND=127.0.0.1
OIDC_HOST_PORT=4180
RECREATE=1
EOF
chmod 600 .env
curl -fsSL https://raw.githubusercontent.com/jmagar/incus-web/main/deploy.sh | bash
```

Configure the OIDC app callback as `https://incus-web.example.com/oauth2/callback`. The example above binds oauth2-proxy to `127.0.0.1:4180` on the host with an Incus proxy device, so a host-level TLS proxy can publish `PUBLIC_URL` while OIDC enforcement stays inside the container.

## Notes

- `.env` and `.env.*` are gitignored. Commit `.env.example`, never real auth keys.
- The Tailscale auth key is copied into the container only long enough to run `tailscale up`, then removed.
- In OIDC mode, `oauth2-proxy` is the only service intended to be exposed; WeTTY stays bound to `127.0.0.1` inside the container.
- Do not build an Incus image with `/var/lib/tailscale` already populated. Cloned containers should join Tailscale with their own node identity.
- The default profile is nested but unprivileged. Keep privileged containers out of the hosted multi-tenant path; use a dedicated trusted pool or an Incus VM for workloads that truly require privileged semantics.
