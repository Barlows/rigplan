#!/usr/bin/env bash
# Create a Proxmox container that runs the electrical load schedule workbench.
#
# Run this on the Proxmox host, as root:
#
#     ./deploy-to-proxmox.sh
#
# It creates the container, installs nginx and git, clones the repository, and
# enables the update timer. The container then serves the app at its root and
# pulls every push to main within a minute.
#
# The repository is private, so the clone needs a token. Either export
# GITHUB_TOKEN or pass --token. A fine-grained read-only token is enough.
#
# Everything is a parameter with a default, so the common case is no arguments
# and the unusual case is a flag.

set -euo pipefail

# ------------------------------------------------------------------ defaults --
VMID="${VMID:-8100}"
HOSTNAME="${HOSTNAME:-elschedule}"
TEMPLATE="${TEMPLATE:-debian-12-standard_12.7-1_amd64.tar.zst}"
STORAGE="${STORAGE:-local-lvm}"
CORES="${CORES:-2}"
MEMORY="${MEMORY:-2048}"
SWAP="${SWAP:-512}"
ROOTFS="${ROOTFS:-8}"
BRIDGE="${BRIDGE:-vmbr0}"
CT_IP=""                       # filled in after creation
GITHUB_TOKEN="${GITHUB_TOKEN:-}"
REPO="https://github.com/Barlows/electrical-load-schedule.git"
CLONE_DIR="/var/www/electrical-load-schedule/repo"
DEPLOY_DIR="/var/www/electrical-load-schedule"

# ------------------------------------------------------------------- usage ---
usage() {
  cat <<'EOF'
Usage: deploy-to-proxmox.sh [options]

  --vmid <id>          Container ID            (default 8100)
  --hostname <name>    Hostname                (default elschedule)
  --template <file>    Proxmox template        (default debian-12-standard_12.7-1_amd64.tar.zst)
  --storage <name>     Storage pool             (default local-lvm)
  --cores <n>          CPU cores               (default 2)
  --memory <mb>        RAM in MB               (default 2048)
  --rootfs <gb>        Disk in GB              (default 8)
  --bridge <name>      Network bridge          (default vmbr0)
  --token <token>      GitHub token            (or set GITHUB_TOKEN)
  --force             Re-create if the VMID is taken
  -h, --help           This message

The template must already be downloaded on the Proxmox host:
  pveam available                 # lists what is in the catalogue
  pveam download local <file>     # fetches one
EOF
  exit 0
}

FORCE=0
while [ $# -gt 0 ]; do
  case "$1" in
    --vmid)      VMID="$2"; shift 2 ;;
    --hostname)  HOSTNAME="$2"; shift 2 ;;
    --template)  TEMPLATE="$2"; shift 2 ;;
    --storage)   STORAGE="$2"; shift 2 ;;
    --cores)     CORES="$2"; shift 2 ;;
    --memory)    MEMORY="$2"; shift 2 ;;
    --rootfs)    ROOTFS="$2"; shift 2 ;;
    --bridge)    BRIDGE="$2"; shift 2 ;;
    --token)     GITHUB_TOKEN="$2"; shift 2 ;;
    --force)     FORCE=1; shift ;;
    -h|--help)   usage ;;
    *) echo "unknown option: $1" >&2; usage >&2 ;;
  esac
done

log()  { printf '\n\033[1;34m==> %s\033[0m\n' "$*"; }
ok()   { printf '  \033[1;32mok\033[0m  %s\n' "$*"; }
warn() { printf '  \033[1;33m!!\033[0m  %s\n' "$*"; }
die()  { printf '\n\033[1;31mERROR:\033[0m %s\n' "$*" >&2; exit 1; }

# ---------------------------------------------------------------- preflight --
log "Preflight"

[ "$(id -u)" -eq 0 ] || die "run this on the Proxmox host as root"
command -v pct >/dev/null 2>&1 || die "pct not found — this must run on a Proxmox host"

# The template name is what pveam calls it, and it has to be on this node.
if ! pveam list local 2>/dev/null | grep -q "$(basename "$TEMPLATE")"; then
  die "template '$TEMPLATE' is not on this host. Fetch it with:
     pveam download local $TEMPLATE
   or pass --template with one that is present."
fi
ok "template $TEMPLATE is present"

# A taken VMID is a real hazard: pct create will happily overwrite a container
# that already exists. Refuse unless --force was given.
if pct status "$VMID" >/dev/null 2>&1; then
  if [ "$FORCE" = "1" ]; then
    warn "VMID $VMID exists — destroying it because --force was given"
    pct stop "$VMID" >/dev/null 2>&1 || true
    pct destroy "$VMID"
  else
    die "VMID $VMID already exists. Use --force to replace it, or --vmid to pick another."
  fi
fi
ok "VMID $VMID is free"

[ -n "$GITHUB_TOKEN" ] || die "no GitHub token. Export GITHUB_TOKEN or pass --token.
   A fine-grained read-only token is enough — the container only ever pulls."

# ------------------------------------------------------------------- create --
log "Creating container $VMID ($HOSTNAME)"

pct create "$VMID" "$TEMPLATE" \
  --hostname "$HOSTNAME" \
  --storage "$STORAGE" \
  --cores "$CORES" \
  --memory "$MEMORY" \
  --swap "$SWAP" \
  --rootfs "$ROOTFS" \
  --net0 "name=eth0,bridge=$BRIDGE,ip=dhcp,ip6=dhcp" \
  --unprivileged 1 \
  --features nesting=1 \
  --onboot 1 \
  --startup order=1,up=30

pct start "$VMID"
ok "container started"

# Wait for it to get an address. DHCP on a home bridge can take a moment, and
# every later step needs one.
log "Waiting for the container to get an address"
CT_IP=""
for _ in $(seq 1 30); do
  CT_IP="$(pct exec "$VMID" -- hostname -I 2>/dev/null | awk '{print $1}' || true)"
  [ -n "$CT_IP" ] && break
  sleep 2
done
[ -n "$CT_IP" ] || die "the container never got an address. Check the bridge and DHCP."
ok "address $CT_IP"

# ------------------------------------------------------------------- inside --
log "Installing packages inside the container"

# nginx serves the files, git pulls them, curl is used by the update script's
# own checks. ca-certificates because the clone is over HTTPS.
pct exec "$VMID" -- bash -c '
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -qq
  apt-get install -y -qq nginx git curl ca-certificates >/dev/null
'
ok "nginx, git, curl installed"

# A dedicated unprivileged user. The container only ever reads from GitHub and
# writes to its own web root, so it needs no privileges and should not have any.
log "Creating the deploy user"
pct exec "$VMID" -- bash -c "
  if ! id deploy >/dev/null 2>&1; then
    adduser --system --group --home $DEPLOY_DIR deploy
  fi
  mkdir -p $DEPLOY_DIR/releases
  chown -R deploy:deploy $DEPLOY_DIR
"
ok "deploy user ready"

# Clone as the deploy user, over HTTPS with the token. The token is used once
# here and is not written anywhere the container can read back.
log "Cloning the repository"
pct exec "$VMID" --user deploy -- bash -c "
  rm -rf $CLONE_DIR
  git clone --quiet https://x-access-token:${GITHUB_TOKEN}@github.com/Barlows/electrical-load-schedule.git $CLONE_DIR
"
ok "cloned to $CLONE_DIR"

# ------------------------------------------------------------------- nginx ---
log "Installing the nginx configuration"

# Pushed rather than written through a quoted heredoc. Getting a nested heredoc
# through pct exec means the host shell evaluates the substitution, and the
# nginx config is full of $uri and $host that must not be touched by anything.
# pct push copies the file as it is.
pct push "$VMID" "$CLONE_DIR/deploy/nginx.conf" /etc/nginx/sites-available/elschedule

pct exec "$VMID" -- bash -c '
  ln -sf /etc/nginx/sites-available/elschedule /etc/nginx/sites-enabled/elschedule
  rm -f /etc/nginx/sites-enabled/default
  nginx -t
  systemctl reload nginx
'

# ----------------------------------------------------------------- systemd ---
log "Enabling the update timer"

pct push "$VMID" "$CLONE_DIR/deploy/elschedule-update.service" /etc/systemd/system/
pct push "$VMID" "$CLONE_DIR/deploy/elschedule-update.timer"   /etc/systemd/system/
pct exec "$VMID" -- bash -c '
  systemctl daemon-reload
  systemctl enable --now elschedule-update.timer
' 
ok "timer enabled"

# --------------------------------------------------------------- first run --
log "Running the first update by hand"

# This is the step that proves the whole thing works, and it is worth watching
# rather than trusting: it parses every script, runs the full test suite, and
# only then moves the new tree into place.
pct exec "$VMID" --user deploy -- "$CLONE_DIR/deploy/update.sh" --test

# ------------------------------------------------------------------ report --
CT_IP="$(pct exec "$VMID" -- hostname -I | awk '{print $1}')"

cat <<EOF

\033[1;32mDone.\033[0m

  Container   $VMID  ($HOSTNAME)
  Address     http://$CT_IP/launch.html
  Repository  $CLONE_DIR
  Web root    $DEPLOY_DIR/current

  The landing page opens the WXM project. The app is at
  http://$CT_IP/index.html — the same thing without the project.

  Updates:     journalctl -u elschedule-update.service -f
  Rollback:    ls -1t $DEPLOY_DIR/releases
  Re-run this: ./deploy-to-proxmox.sh --force

\033[1;33mOne thing to decide:\033[0m this container serves the WXM project file
at its root. That is the deployment you asked for, and it is fine on a LAN. If
the container is ever reachable from outside your network, put basic auth or a
network allow-list on it first — see the top of deploy/README.md.
EOF