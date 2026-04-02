#!/bin/bash
set -euo pipefail

# ============================================================
# Store Provisioning Platform - Local K3D Setup
# Creates a k3d cluster, builds images, deploys via Helm
# ============================================================

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
CLUSTER_NAME="${CLUSTER_NAME:-store-platform}"
PLATFORM_NS="${PLATFORM_NS:-store-platform}"
DOMAIN_SUFFIX="${DOMAIN_SUFFIX:-local.store-platform.test}"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log()  { echo -e "${GREEN}[INFO]${NC} $*"; }
warn() { echo -e "${YELLOW}[WARN]${NC} $*"; }
err()  { echo -e "${RED}[ERROR]${NC} $*"; exit 1; }

# -----------------------------------------------------------
# 1. Prerequisite checks
# -----------------------------------------------------------
check_prerequisites() {
  log "Checking prerequisites..."
  local missing=0
  for cmd in docker k3d kubectl helm; do
    if command -v "$cmd" &>/dev/null; then
      echo "  [OK] $cmd $(command -v "$cmd")"
    else
      echo "  [MISSING] $cmd"
      missing=1
    fi
  done
  if [ "$missing" -eq 1 ]; then
    err "Install missing tools before continuing.\n  k3d: https://k3d.io\n  helm: https://helm.sh\n  kubectl: https://kubernetes.io/docs/tasks/tools/"
  fi
}

# -----------------------------------------------------------
# 2. Create k3d cluster
# -----------------------------------------------------------
create_cluster() {
  if k3d cluster list | grep -q "$CLUSTER_NAME"; then
    warn "Cluster '$CLUSTER_NAME' already exists. Skipping creation."
  else
    log "Creating k3d cluster '$CLUSTER_NAME'..."
    k3d cluster create "$CLUSTER_NAME" \
      --api-port 6550 \
      --port "80:80@loadbalancer" \
      --port "443:443@loadbalancer" \
      --agents 2 \
      --k3s-arg "--disable=traefik@server:0" \
      --wait
  fi

  log "Setting kubectl context..."
  kubectl config use-context "k3d-$CLUSTER_NAME"
  kubectl cluster-info
}

# -----------------------------------------------------------
# 3. Install NGINX Ingress Controller
# -----------------------------------------------------------
install_ingress() {
  if kubectl get ns ingress-nginx &>/dev/null 2>&1; then
    warn "ingress-nginx namespace exists. Skipping install."
  else
    log "Installing NGINX Ingress Controller..."
    helm repo add ingress-nginx https://kubernetes.github.io/ingress-nginx 2>/dev/null || true
    helm repo update
    helm install ingress-nginx ingress-nginx/ingress-nginx \
      --namespace ingress-nginx \
      --create-namespace \
      --set controller.publishService.enabled=true \
      --set controller.watchIngressWithoutClass=true \
      --wait --timeout 120s
  fi

  log "Waiting for ingress controller to be ready..."
  kubectl wait --namespace ingress-nginx \
    --for=condition=ready pod \
    --selector=app.kubernetes.io/component=controller \
    --timeout=120s
}

# -----------------------------------------------------------
# 4. Build Docker images and import into k3d
# -----------------------------------------------------------
build_images() {
  log "Building API image..."
  docker build -t store-provisioning-api:latest -f "$PROJECT_DIR/Dockerfile.api" "$PROJECT_DIR"

  log "Building Dashboard image..."
  docker build -t store-provisioning-dashboard:latest -f "$PROJECT_DIR/Dockerfile.dashboard" "$PROJECT_DIR"

  log "Importing images into k3d cluster..."
  k3d image import store-provisioning-api:latest -c "$CLUSTER_NAME"
  k3d image import store-provisioning-dashboard:latest -c "$CLUSTER_NAME"
}

# -----------------------------------------------------------
# 5. Deploy platform via Helm
# -----------------------------------------------------------
deploy_platform() {
  log "Deploying store-platform via Helm..."

  helm upgrade --install store-platform "$PROJECT_DIR/charts/store-platform" \
    --namespace "$PLATFORM_NS" \
    --create-namespace \
    -f "$PROJECT_DIR/charts/store-platform/values.yaml" \
    -f "$PROJECT_DIR/values-local.yaml" \
    --wait --timeout 120s

  log "Waiting for API to be ready..."
  kubectl wait --namespace "$PLATFORM_NS" \
    --for=condition=available deployment/store-provisioning-api \
    --timeout=120s

  log "Waiting for Dashboard to be ready..."
  kubectl wait --namespace "$PLATFORM_NS" \
    --for=condition=available deployment/store-provisioning-dashboard \
    --timeout=120s
}

# -----------------------------------------------------------
# 6. Setup local DNS hint
# -----------------------------------------------------------
print_dns_instructions() {
  echo ""
  log "============================================"
  log "  Deployment Complete!"
  log "============================================"
  echo ""
  echo "  Platform URL:  http://platform.${DOMAIN_SUFFIX}"
  echo "  API URL:       http://platform.${DOMAIN_SUFFIX}/api/stores"
  echo ""
  echo "  Add these entries to your hosts file:"
  echo "  (Linux/Mac: /etc/hosts, Windows: C:\\Windows\\System32\\drivers\\etc\\hosts)"
  echo ""
  echo "    127.0.0.1  platform.${DOMAIN_SUFFIX}"
  echo "    # Add store domains as you create them, e.g.:"
  echo "    # 127.0.0.1  my-store.${DOMAIN_SUFFIX}"
  echo ""
  echo "  Or use a wildcard DNS tool (dnsmasq / nip.io)."
  echo ""
  echo "  Useful commands:"
  echo "    kubectl get pods -n $PLATFORM_NS"
  echo "    kubectl logs -n $PLATFORM_NS deployment/store-provisioning-api -f"
  echo "    helm list -n $PLATFORM_NS"
  echo ""
}

# -----------------------------------------------------------
# Main
# -----------------------------------------------------------
main() {
  echo "============================================"
  echo " Store Provisioning Platform - Local Setup"
  echo "============================================"
  echo ""

  check_prerequisites
  create_cluster
  install_ingress
  build_images
  deploy_platform
  print_dns_instructions
}

main "$@"
