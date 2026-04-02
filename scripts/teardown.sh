#!/bin/bash
set -euo pipefail

# ============================================================
# Store Provisioning Platform - Teardown
# Removes the k3d cluster and all resources
# ============================================================

CLUSTER_NAME="${CLUSTER_NAME:-store-platform}"

RED='\033[0;31m'
GREEN='\033[0;32m'
NC='\033[0m'

log() { echo -e "${GREEN}[INFO]${NC} $*"; }
err() { echo -e "${RED}[ERROR]${NC} $*"; exit 1; }

echo "============================================"
echo " Store Provisioning Platform - Teardown"
echo "============================================"
echo ""

read -p "This will delete the k3d cluster '$CLUSTER_NAME' and ALL stores. Continue? (y/N) " confirm
if [[ "$confirm" != [yY] ]]; then
  echo "Aborted."
  exit 0
fi

if k3d cluster list | grep -q "$CLUSTER_NAME"; then
  log "Deleting k3d cluster '$CLUSTER_NAME'..."
  k3d cluster delete "$CLUSTER_NAME"
  log "Cluster deleted."
else
  log "Cluster '$CLUSTER_NAME' not found. Nothing to delete."
fi

log "Teardown complete."
