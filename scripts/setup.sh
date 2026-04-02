#!/bin/bash
set -euo pipefail

# ============================================================
# Store Provisioning Platform - Dev Setup
# Installs dependencies for local development (no K8s needed)
# ============================================================

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

log()  { echo -e "${GREEN}[INFO]${NC} $*"; }
warn() { echo -e "${YELLOW}[WARN]${NC} $*"; }
err()  { echo -e "${RED}[ERROR]${NC} $*"; exit 1; }

echo "============================================"
echo " Store Provisioning Platform - Dev Setup"
echo "============================================"
echo ""

# Check Node.js
if command -v node &>/dev/null; then
  log "Node.js: $(node --version)"
else
  err "Node.js is required. Install from https://nodejs.org"
fi

# Check npm
if command -v npm &>/dev/null; then
  log "npm: $(npm --version)"
else
  err "npm is required."
fi

# Optional checks
for cmd in docker helm kubectl k3d; do
  if command -v "$cmd" &>/dev/null; then
    log "$cmd: found"
  else
    warn "$cmd: not found (needed for K8s deployment)"
  fi
done

echo ""
log "Installing API dependencies..."
cd "$PROJECT_DIR/api" && npm install

echo ""
log "Installing Dashboard dependencies..."
cd "$PROJECT_DIR/dashboard" && npm install

echo ""
log "============================================"
log "  Dev Setup Complete!"
log "============================================"
echo ""
echo "  Local development (no K8s):"
echo "    cd api && npm run dev       # API on :3001"
echo "    cd dashboard && npm start   # Dashboard on :3000"
echo ""
echo "  Docker Compose (no K8s):"
echo "    docker-compose up --build"
echo ""
echo "  Full K8s deployment:"
echo "    ./scripts/setup-k3d.sh"
echo ""
