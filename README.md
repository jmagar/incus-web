# incus-web

`incus-web` creates an Incus container, installs a browser terminal inside it, joins it to your Tailscale tailnet, and publishes the terminal with `tailscale serve`.

The deploy script is meant to be curlable, but it does not bake secrets into the repository. Put your Tailscale auth key in a local `.env` file, keep that file out of git, then run the script from the same directory.

## What It Creates

- An Incus container from `images:debian/trixie/cloud` by default.
- A non-root terminal user named `agent` by default.
- WeTTY listening inside the container on `127.0.0.1:3000`.
- Tailscale running in userspace networking mode so the container can run unprivileged.
- A `tailscale serve` HTTPS route for the web terminal.
- A host directory mounted into the container for persistent working files.

## Requirements

- Linux host with `bash`, `curl`, and `sudo`.
- Tailscale tailnet where HTTPS certs and Serve are enabled.
- A Tailscale auth key. Ephemeral auth keys are recommended for disposable containers.

If Incus is missing, `deploy.sh` attempts to install it with `apt-get` and initialize it with minimal defaults.

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
IMAGE=images:debian/trixie/cloud
RECREATE=0
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
