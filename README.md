# incus-web

`incus-web` creates an Incus container, installs a browser terminal inside it, joins it to your Tailscale tailnet, and publishes the terminal with `tailscale serve`.

The deploy script is meant to be curlable, but it does not bake secrets into the repository. Put your Tailscale auth key in a local `.env` file, keep that file out of git, then run the script from the same directory.

## What It Creates

- An Incus container from `images:debian/trixie` by default.
- A non-root terminal user named `agent` by default.
- A small demo developer toolchain: Node/npm, Python, Go, Rust/Cargo, Git, GitHub CLI, Claude Code, and Codex CLI.
- WeTTY listening inside the container on `127.0.0.1:3000`.
- Tailscale running inside the privileged system container.
- A `tailscale serve` HTTPS route for the web terminal.
- A dedicated Incus bridge with an ACL that blocks direct egress to RFC1918 and IPv4 link-local LAN ranges.
- A committed Incus profile YAML (`incus-web-profile.yaml`) as the source of truth for the container shape.
- A host directory mounted into the container for persistent working files.

## Requirements

- Linux host with `bash`, `curl`, and `sudo`.
- Tailscale tailnet where HTTPS certs and Serve are enabled.
- A Tailscale auth key. Ephemeral auth keys are recommended for disposable containers.

If Incus is missing, `deploy.sh` attempts to install it with `apt-get` and initialize it with minimal defaults.

The Incus container shape lives in `incus-web-profile.yaml`: profile config, the NIC, and the workspace disk device. Provisioning is intentionally handled by `deploy.sh` after the container launches. The demo does not use cloud-init, so packages, users, services, and agent setup stay in one procedural code path instead of drifting between image metadata and this repository.

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

## Configuration

`.env` uses shell-compatible `KEY=value` lines.

```bash
TS_AUTHKEY=tskey-auth-example
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
WETTY_PORT=3000
WEB_USER=agent
HOST_WORKSPACE=$HOME/incus-web-data/incus-web
CONTAINER_WORKSPACE=/workspace
DISK_SHIFT=true
```

Important variables:

- `TS_AUTHKEY`: required Tailscale auth key for `tailscale up`.
- `CONTAINER_NAME`: local Incus container name.
- `IMAGE`: Incus image to launch. Defaults to a non-cloud Debian image because provisioning is handled by `deploy.sh`.
- `INCUS_NETWORK`: managed Incus bridge used by the container.
- `INCUS_NETWORK_IPV4`: IPv4 CIDR used when creating the bridge. The default uses the lab/benchmarking range from the Incus jail article to avoid common home LAN collisions.
- `INCUS_ACL`: Incus network ACL name for the LAN egress deny list.
- `ENABLE_NETWORK_ACL`: set to `0` to skip bridge/ACL management when using a pre-existing custom network.
- `INCUS_PROFILE_NAME`: Incus profile name created/updated from `incus-web-profile.yaml`.
- `INCUS_PROFILE_YAML`: optional path to a local profile YAML. When unset, `deploy.sh` uses the repo file next to the script or downloads it for curl-piped runs.
- `CONTAINER_IPV4`: optional static IPv4 to assign if DHCP does not come up.
- `TS_HOSTNAME`: tailnet hostname assigned to the container.
- `TAILSCALE_SERVE_PORT`: HTTPS port exposed by `tailscale serve`.
- `HOST_WORKSPACE`: host path mounted into the container.
- `CONTAINER_WORKSPACE`: mount point inside the container.
- `DISK_SHIFT`: use Incus idmapped shifting for the mounted workspace.
- `RECREATE=1`: delete and recreate an existing container with the same name.

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

## Notes

- `.env` and `.env.*` are gitignored. Commit `.env.example`, never real auth keys.
- The auth key is copied into the container only long enough to run `tailscale up`, then removed.
- Do not build an Incus image with `/var/lib/tailscale` already populated. Cloned containers should join Tailscale with their own node identity.
