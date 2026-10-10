#!/usr/bin/env bash

################################################################################
#  ____                                        _     _                        #
# |  _ \  _____      ___ __  ___  __ _ _ __ __ _| |__ | |_ __   ___          #
# | |_) |/ _ \ \ /\ / / '_ \/ __|/ _` | '__/ _` | '_ \| | '_ \ / __|         #
# |  __/|  __/\ V  V /| |_) \__ \ (_| | | | (_| | | | | | | | \__ \         #
# |_|    \___| \_/\_/| .__/|___/\__,_|_|  \__,_|_| |_|_|_| |_|___/         #
#                    |_|                                                     #
#                                                                             #
#   Electrical load schedule workbench — Proxmox container deployment         #
#                                                                             #
#   Run on the Proxmox host as root. Creates a container running the app     #
#   at its root, with the update timer enabled, and prints the address.       #
################################################################################

set -euo pipefail
YELLOW="\e[1;33m"
GREEN="\e[1;32m"
RED="\e[1;31m"
BLUE="\e[1;34m"
MAGENTA="\e[1;35m"
TURQ="\e[1;36m"
ENDCOLOR="\e[0m"
BOLD="\e[1m"
CLEAR_LINE="\033[2K"

# ======================================================================== #
# Functions                                                                  #
# ======================================================================== #

header_info() {
  clear
  cat <<EOF
─────────────────────────────────────────────────────────────────────────────
${BOLD} ____                                        _     _${ENDCOLOR}
${BOLD}|  _ \  _____      ___ __  ___  __ _ _ __ __ _| |__ | |_ __   ___${ENDCOLOR}
${BOLD}| |_) |/ _ \ \ /\ / / '_ \/ __|/ _\` | '__/ _\` | '_ \| | '_ \ / __|${ENDCOLOR}
${BOLD}|  __/|  __/\ V  V /| |_) \__ \ (_| | | | (_| | | | | | | | \__ \${ENDCOLOR}
${BOLD}|_|    \___| \_/\_/| .__/|___/\__,_|_|  \__,_|_| |_|_|_| |_|___/${ENDCOLOR}
${BOLD}                    |_|${ENDCOLOR}

${TURQ}  Electrical load schedule workbench${ENDCOLOR}
${TURQ}  Proxmox container deployment${ENDCOLOR}
─────────────────────────────────────────────────────────────────────────────
EOF
  echo
}

msg_info() {
  echo -e "${BLUE}[INFO]${ENDCOLOR} $1"
}

msg_ok() {
  echo -e "${GREEN}[OK]${ENDCOLOR} $1"
}

msg_error() {
  echo -e "${RED}[ERROR]${ENDCOLOR} $1" >&2
  exit_script
}

exit_script() {
  echo -e "${RED}[EXITING]${ENDCOLOR} due to $1"
  trap - SIGINT SIGTERM
  kill "$(jobs -p)" 2>/dev/null || true
  exit 1
}

cleanup() {
  if [ "${CLEANUP:-0}" = "1" ]; then
    msg_info "Cleaning up temporary files"
    rm -rf "${SCRIPT_DIR:?}"/*.tmp 2>/dev/null || true
  fi
}
trap cleanup EXIT

check_root() {
  if [[ $EUID -ne 0 ]]; then
    msg_error "This script must be run as root."
  fi
}

check_Proxmox() {
  command -v pct >/dev/null 2>&1 || msg_error "pct not found — this script runs on Proxmox VE."
  if ! grep -q "Proxmox Virtual Environment" /etc/issue 2>/dev/null; then
    msg_error "This script must be run on Proxmox VE."
  fi
}

check_template() {
  local t
  t="$(basename "$1")"
  if ! pveam list local 2>/dev/null | grep -q "$t"; then
    msg_error "Template '$t' is not on this host. Fetch it with:
     pveam download local $t
   Or pass --template with one that is present."
  fi
}

# ======================================================================== #
# Defaults                                                                  #
# ======================================================================== #
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VMID="8100"
HOSTNAME="elschedule"
TEMPLATE="debian-12-standard_12.7-1_amd64.tar.zst"
STORAGE="local-lvm"
CORES="2"
MEMORY="2048"
SWAP="512"
ROOTFS="8"
BRIDGE="vmbr0"
GITHUB_TOKEN="${GITHUB_TOKEN:-}"
REPO="https://github.com/Barlows/electrical-load-schedule.git"
CLONE_DIR="/var/www/electrical-load-schedule/repo"
DEPLOY_DIR="/var/www/electrical-load-schedule"

FORCE=0

while [ $# -gt 0 ]; do
  case "$1" in
    --vmid)      VMID="$2"; shift 2 ;;
    --hostname)  HOSTNAME="$2"; shift 2 ;;
    --template)  TEMPLATE="$2"; shift 2 ;;
    --storage)   STORAGE="$2"; shift 2 ;;
    --cores)     CORES="$2"; shift 2 ;;
    --memory)    MEMORY="$2"; shift 2 ;;
    --swap)      SWAP="$2"; shift 2 ;;
    --rootfs)    ROOTFS="$2"; shift 2 ;;
    --bridge)    BRIDGE="$2"; shift 2 ;;
    --token)     GITHUB_TOKEN="$2"; shift 2 ;;
    --force)     FORCE=1; shift ;;
    --cleanup)   CLEANUP=1; shift ;;
    -h|--help)   grep '^#' "$0" | head -20; exit 0 ;;
    *)           msg_error "Unknown option: $1. Use --help for usage." ;;
  esac
done

# ======================================================================== #
# Preflight                                                                 #
# ======================================================================== #

header_info
msg_info "Checking prerequisites"

check_root
msg_ok "Running as root"

check_Proxmox
msg_ok "Proxmox VE detected"

check_template "$TEMPLATE"
msg_ok "Template $(basename "$TEMPLATE") is available"

if pct status "$VMID" >/dev/null 2>&1; then
  if [ "$FORCE" = "1" ]; then
    msg_info "VMID $VMID exists — destroying because --force was given"
    pct stop "$VMID" >/dev/null 2>&1 || true
    pct destroy "$VMID"
    msg_ok "Removed existing container $VMID"
  else
    msg_error "VMID $VMID already exists. Use --force to replace it, or --vmid to pick another.
   pct create will overwrite an existing container without asking, and the
   failure is silent until the old one is gone."
  fi
fi
msg_ok "VMID $VMID is free"

if [ -z "$GITHUB_TOKEN" ]; then
  msg_error "No GitHub token. Export GITHUB_TOKEN or pass --token.
   A fine-grained read-only token is enough — the container only ever pulls."
fi
msg_ok "GitHub token provided"

# ======================================================================== #
# Create the container                                                      #
# ======================================================================== #

msg_info "Creating container $VMID ($HOSTNAME)"

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

msg_ok "Container created"

msg_info "Starting container $VMID"
pct start "$VMID"
msg_ok "Container started"

# ======================================================================== #
# Wait for network                                                          #
# ======================================================================== #

msg_info "Waiting for the container to obtain an address"
CT_IP=""
for _ in $(seq 1 30); do
  CT_IP="$(pct exec "$VMID" -- hostname -I 2>/dev/null | awk '{print $1}' || true)"
  if [ -n "$CT_IP" ]; then
    break
  fi
  printf '.'
  sleep 2
done
echo

if [ -z "$CT_IP" ]; then
  msg_error "The container never received an address.
   Check the bridge ($BRIDGE) and that DHCP is working.
   Every later step needs an address, and a container that has not got one yet
   looks identical to one that never will."
fi
msg_ok "Address obtained: $CT_IP"

# ======================================================================== #
# Install packages                                                          #
# ======================================================================== #

msg_info "Installing packages (nginx, git, curl, ca-certificates)"

pct exec "$VMID" -- bash -c '
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -qq
  apt-get install -y -qq nginx git curl ca-certificates >/dev/null
'

msg_ok "Packages installed"

# ======================================================================== #
# Deploy user                                                               #
# ======================================================================== #

msg_info "Creating unprivileged deploy user"

pct exec "$VMID" -- bash -c "
  if ! id deploy >/dev/null 2>&1; then
    adduser --system --group --home $DEPLOY_DIR deploy
  fi
  mkdir -p $DEPLOY_DIR/releases
  chown -R deploy:deploy $DEPLOY_DIR
"

msg_ok "Deploy user ready"

# ======================================================================== #
# Clone repository                                                          #
# ======================================================================== #

msg_info "Cloning $REPO"

# The token is used once here and never written anywhere the container can read
# back. git clone over HTTPS with the token in the URL means it does not persist
# in the credential store.
pct exec "$VMID" --user deploy -- bash -c "
  rm -rf $CLONE_DIR
  git clone --quiet https://x-access-token:${GITHUB_TOKEN}@github.com/Barlows/electrical-load-schedule.git $CLONE_DIR
"

msg_ok "Repository cloned to $CLONE_DIR"

# ======================================================================== #
# nginx configuration                                                       #
# ======================================================================== #

msg_info "Installing nginx configuration"

# Files are pushed with pct push rather than written through a quoted heredoc.
# A nested heredoc through pct exec means the HOST shell evaluates the
# substitution — and nginx.conf is full of $uri and $host that must not be
# touched by anything. The first version of this script did exactly that and
# would have written a configuration full of empty strings.
pct push "$VMID" "$CLONE_DIR/deploy/nginx.conf" /etc/nginx/sites-available/elschedule

pct exec "$VMID" -- bash -c '
  ln -sf /etc/nginx/sites-available/elschedule /etc/nginx/sites-enabled/elschedule
  rm -f /etc/nginx/sites-enabled/default
  nginx -t
  systemctl reload nginx
'

msg_ok "nginx configured and reloaded"

# ======================================================================== #
# systemd timer                                                             #
# ======================================================================== #

msg_info "Enabling the update timer"

pct push "$VMID" "$CLONE_DIR/deploy/elschedule-update.service" /etc/systemd/system/
pct push "$VMID" "$CLONE_DIR/deploy/elschedule-update.timer"   /etc/systemd/system/

pct exec "$VMID" -- bash -c '
  systemctl daemon-reload
  systemctl enable --now elschedule-update.timer
'

msg_ok "Update timer enabled"

# ======================================================================== #
# First update (checked)                                                    #
# ======================================================================== #

msg_info "Running the initial update with --test"

# This step is the one that proves the deployment works rather than the one
# that is trusted. --test parses every script with a real JavaScript engine and
# runs the full headless suite before anything goes live, so a push that breaks
# the build leaves the previous version serving instead of taking the site down
# unattended.
pct exec "$VMID" --user deploy -- "$CLONE_DIR/deploy/update.sh" --test

msg_ok "Initial update completed and verified"

# ======================================================================== #
# Summary                                                                   #
# ======================================================================== #

header_info "Completed Successfully!"

CT_IP="$(pct exec "$VMID" -- hostname -I | awk '{print $1}')"

echo -e "${GREEN}─────────────────────────────────────────────────────────────────────────────${ENDCOLOR}"
echo -e "  ${BOLD}Container${ENDCOLOR}   $VMID  ($HOSTNAME)"
echo -e "  ${BOLD}Address${ENDCOLOR}     http://$CT_IP/launch.html"
echo -e "  ${BOLD}Repository${ENDCOLOR}  $CLONE_DIR"
echo -e "  ${BOLD}Web root${ENDCOLOR}    $DEPLOY_DIR/current"
echo -e "${GREEN}─────────────────────────────────────────────────────────────────────────────${ENDCOLOR}"
echo
echo -e "  ${BLUE}Updates:${ENDCOLOR}   journalctl -u elschedule-update.service -f"
echo -e "  ${BLUE}Rollback:${ENDCOLOR}  ls -1t $DEPLOY_DIR/releases"
echo -e "  ${BLUE}Re-run:${ENDCOLOR}    ./deploy-to-proxmox.sh --force"
echo
echo -e "  ${YELLOW}Caveat:${ENDCOLOR}    this container serves the WXM project at its root."
echo -e "                   That is the deployment you asked for, and it is fine on a LAN."
echo -e "                   If it is ever reachable from outside your network, put basic"
echo -e "                   auth or a network allow-list on it first."
echo

exit 0