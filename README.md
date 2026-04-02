# Store Provisioning Platform

A Kubernetes-native platform for provisioning isolated e-commerce stores (WooCommerce or MedusaJS) via a React dashboard. Deploys on local k3d and production k3s using the same Helm charts with values-file overrides.

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│  store-platform namespace                               │
│  ┌─────────────┐    ┌──────────────────┐                │
│  │  Dashboard   │───▶│  API Server      │                │
│  │  (React/Nginx)│   │  (Node/Express)  │                │
│  └─────────────┘    └────────┬─────────┘                │
│                              │ Helm + K8s API           │
└──────────────────────────────┼──────────────────────────┘
                               │
          ┌────────────────────┼────────────────────┐
          ▼                    ▼                     ▼
  ┌───────────────┐   ┌───────────────┐    ┌───────────────┐
  │ store-shop-a  │   │ store-shop-b  │    │ store-shop-c  │
  │ (namespace)   │   │ (namespace)   │    │ (namespace)   │
  │               │   │               │    │               │
  │ WordPress     │   │ WordPress     │    │ Medusa        │
  │ MariaDB       │   │ MariaDB       │    │ PostgreSQL    │
  │ WooSetup Job  │   │ WooSetup Job  │    │ Redis         │
  │ Ingress       │   │ Ingress       │    │ Ingress       │
  │ NetworkPolicy │   │ NetworkPolicy │    │ NetworkPolicy │
  │ ResourceQuota │   │ ResourceQuota │    │ ResourceQuota │
  └───────────────┘   └───────────────┘    └───────────────┘
```

**Per-store isolation:**
- Namespace-per-store with optional ResourceQuota + LimitRange
- Dedicated PVCs for database and WordPress content
- Optional deny-by-default NetworkPolicies
- Auto-generated unique database passwords per store

## Prerequisites

| Tool | Version | Purpose |
|------|---------|---------|
| Docker | 20+ | Container builds |
| k3d | 5.x | Local K8s cluster |
| kubectl | 1.27+ | K8s CLI |
| Helm | 3.12+ | Chart deployment |
| Node.js | 20+ | Local dev only |

## Quick Start (Local k3d)

### 1. One-command setup

```bash
chmod +x scripts/setup-k3d.sh
./scripts/setup-k3d.sh
```

This will:
- Create a k3d cluster with 2 agent nodes
- Install NGINX Ingress Controller
- Build and import Docker images
- Deploy the platform via Helm

### 2. Configure DNS

Add to your hosts file (`/etc/hosts` on Linux/Mac, `C:\Windows\System32\drivers\etc\hosts` on Windows):

```
127.0.0.1  platform.local.store-platform.test
# Add store domains as you create them:
# 127.0.0.1  my-store.local.store-platform.test
```

Alternatively, use a wildcard DNS approach with `dnsmasq` or `nip.io`.

### 3. Open Dashboard

Navigate to: `http://platform.local.store-platform.test`

### 4. Create a Store

1. Enter a store name (e.g., `my-shop`)
2. Select engine: **WooCommerce** (fully implemented) or **MedusaJS** (stubbed)
3. Click **Create Store**
4. Watch the events log as provisioning progresses
5. Once ready, add `my-shop.local.store-platform.test` to your hosts filestore-platform.test
6. Click the store URL to open the storefront

### 5. Test End-to-End Order (WooCommerce)

1. Open the store URL (e.g., `http://my-shop.local.store-platform.test`)
2. Browse products (3 sample products are seeded: T-Shirt, Mug, Hoodie)
3. Add a product to cart
4. Proceed to checkout
5. Fill in billing details, select **Cash on Delivery**
6. Place order
7. Verify in WP Admin (`/wp-admin`, credentials shown in events log): **WooCommerce > Orders**

## Project Structure

```
├── api/                          # Node.js/Express API server
│   └── src/
│       ├── index.ts              # Express routes + health checks
│       ├── provisioner.ts        # Helm-based K8s provisioning logic
│       ├── store-db.ts           # In-memory store database
│       ├── types.ts              # TypeScript interfaces
│       └── logger.ts             # Winston logger
├── dashboard/                    # React frontend
│   ├── src/App.js                # Main dashboard UI
│   └── nginx.conf                # Production nginx config
├── charts/
│   ├── store-platform/           # Platform chart (API + Dashboard)
│   │   ├── templates/
│   │   │   ├── platform.yaml     # Deployments, Services, Ingress
│   │   │   └── rbac.yaml         # ServiceAccount, ClusterRole, Binding
│   │   └── values.yaml           # Default values
│   ├── woocommerce-store/        # Per-store WooCommerce chart
│   │   ├── templates/
│   │   │   ├── mariadb.yaml      # MariaDB Secret, PVC, Deployment, Service
│   │   │   ├── wordpress.yaml    # WordPress Secret, PVC, Deployment, Service, Ingress
│   │   │   ├── woo-setup-job.yaml# Post-install Job: WP-CLI WooCommerce setup
│   │   │   └── security.yaml     # ResourceQuota, LimitRange, NetworkPolicy
│   │   ├── values.yaml
│   │   └── values-prod.yaml      # Production overrides
│   └── medusa-store/             # Per-store MedusaJS chart (stubbed)
│       ├── templates/
│       │   ├── postgres.yaml
│       │   ├── redis.yaml
│       │   ├── medusa.yaml
│       │   └── security.yaml
│       └── values.yaml
├── scripts/
│   ├── setup-k3d.sh              # Full k3d cluster setup + deploy
│   ├── setup.sh                  # Dev environment setup (npm install)
│   └── teardown.sh               # Destroy k3d cluster
├── values-local.yaml             # Helm overrides for local k3d
├── values-prod.yaml              # Helm overrides for production k3s
├── Dockerfile.api
├── Dockerfile.dashboard
├── docker-compose.yml            # Docker Compose for non-K8s dev
└── .env.example
```

## Helm Values: Local vs Production

All environment differences are handled via Helm values files. **No code changes** between local and production.

| Setting | Local (`values-local.yaml`) | Production (`values-prod.yaml`) |
|---------|----------------------------|----------------------------------|
| Domain | `local.store-platform.test` | `stores.yourdomain.com` |
| Replicas | 1 (API), 1 (Dashboard) | 2 (API), 2 (Dashboard) |
| Image pull | `IfNotPresent` (local) | `Always` (registry) |
| TLS | Disabled | cert-manager + Let's Encrypt |
| Log level | `debug` | `info` |
| Max stores | 20 | 50 |
| Resources | Minimal | Larger limits |
| ResourceQuotas | Disabled | Enabled per-store |
| NetworkPolicies | Disabled | Enabled per-store |

## Production Deployment (k3s on VPS)

### 1. Install k3s

```bash
curl -sfL https://get.k3s.io | sh -s - --disable traefik
export KUBECONFIG=/etc/rancher/k3s/k3s.yaml
```

### 2. Install NGINX Ingress

```bash
helm repo add ingress-nginx https://kubernetes.github.io/ingress-nginx
helm install ingress-nginx ingress-nginx/ingress-nginx \
  --namespace ingress-nginx --create-namespace \
  --set controller.publishService.enabled=true
```

### 3. (Optional) Install cert-manager for TLS

```bash
helm repo add jetstack https://charts.jetstack.io
helm install cert-manager jetstack/cert-manager \
  --namespace cert-manager --create-namespace \
  --set crds.enabled=true

# Create a ClusterIssuer for Let's Encrypt
cat <<EOF | kubectl apply -f -
apiVersion: cert-manager.io/v1
kind: ClusterIssuer
metadata:
  name: letsencrypt-prod
spec:
  acme:
    server: https://acme-v02.api.letsencrypt.org/directory
    email: your-email@example.com
    privateKeySecretRef:
      name: letsencrypt-prod
    solvers:
      - http01:
          ingress:
            class: nginx
EOF
```

### 4. Push images to registry

```bash
# Build and tag
docker build -t ghcr.io/your-org/store-provisioning-api:1.0.0 -f Dockerfile.api .
docker build -t ghcr.io/your-org/store-provisioning-dashboard:1.0.0 -f Dockerfile.dashboard .

# Push
docker push ghcr.io/your-org/store-provisioning-api:1.0.0
docker push ghcr.io/your-org/store-provisioning-dashboard:1.0.0
```

### 5. Edit `values-prod.yaml`

Update `api.image`, `dashboard.image`, `ingress.host`, and `api.env.DOMAIN_SUFFIX` with your actual values.

### 6. Deploy

```bash
helm upgrade --install store-platform charts/store-platform \
  --namespace store-platform --create-namespace \
  -f values-prod.yaml
```

### 7. DNS

Point your domain's DNS A record to the VPS IP:
- `platform.yourdomain.com` -> VPS IP
- `*.stores.yourdomain.com` -> VPS IP (wildcard for store subdomains)

## API Reference

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/healthz` | Liveness check |
| GET | `/readyz` | Readiness check |
| GET | `/api/stores` | List all stores |
| GET | `/api/stores/:id` | Get store details + events |
| POST | `/api/stores` | Create store `{name, engine}` |
| DELETE | `/api/stores/:id` | Delete store + all resources |
| GET | `/api/metrics` | Platform metrics |

### Create Store Request

```json
{
  "name": "my-shop",
  "engine": "woocommerce"
}
```

### Store Response

```json
{
  "id": "uuid",
  "name": "my-shop",
  "engine": "woocommerce",
  "status": "provisioning",
  "namespace": "store-my-shop",
  "storeUrl": "http://my-shop.local.store-platform.test",
  "adminUrl": "http://my-shop.local.store-platform.test/wp-admin",
  "createdAt": "2025-01-01T00:00:00.000Z",
  "events": [...]
}
```

## Security Features

- **RBAC**: Least-privilege ClusterRole for the provisioner service account (namespaces, deployments, services, ingress, jobs, quotas only)
- **No hardcoded secrets**: Database passwords and WP admin passwords auto-generated per store via UUID
- **ResourceQuota** (prod): CPU, memory, and PVC storage limits per store namespace
- **LimitRange** (prod): Default container resource requests/limits per store namespace
- **NetworkPolicy** (prod): Deny-by-default ingress with explicit allows (ingress->WordPress, WordPress->MariaDB)
- **Health checks**: Readiness and liveness probes on all components

## Abuse Prevention

- **Max stores limit**: Configurable via `MAX_STORES` (default: 20)
- **Concurrency control**: Configurable via `MAX_CONCURRENT_PROVISIONS` (default: 5)
- **Provisioning timeout**: Configurable via `PROVISION_TIMEOUT_MS` (default: 10 min)
- **Name validation**: Store names sanitized, max 50 chars, duplicates rejected
- **Idempotent creation**: Failed stores with same name are cleaned up before retry

## Idempotency and Recovery

- **Startup reconciliation**: On API restart, the system scans existing Helm releases in `store-*` namespaces and rebuilds the in-memory store database. Stores that were `ready` before the restart are detected and shown correctly.
- **Idempotent creation**: If a store creation failed, re-creating with the same name cleans up the failed entry first. Helm `upgrade --install` is inherently idempotent.
- **Provisioning timeout**: If a store is stuck provisioning, the timeout fires and marks it as `failed` with a clear error message.
- **Clean teardown**: Deleting a store runs `helm uninstall` + namespace deletion, cleaning up all resources (PVCs, Secrets, Deployments, etc).

## Upgrades and Rollback

### Upgrade platform

```bash
# Update images, then:
helm upgrade store-platform charts/store-platform -f values-prod.yaml
```

### Upgrade a store's WordPress version

```bash
# Change the image in values and re-deploy the store's Helm release
helm upgrade <store-name> charts/woocommerce-store \
  --namespace store-<store-name> \
  --set wordpress.image=wordpress:6.5-apache \
  --reuse-values
```

### Rollback

```bash
# List revisions
helm history store-platform -n store-platform

# Rollback to previous
helm rollback store-platform 1 -n store-platform

# Rollback a store
helm rollback <store-name> 1 -n store-<store-name>
```

## Teardown

```bash
# Remove everything (cluster + all stores)
./scripts/teardown.sh

# Or manually:
helm uninstall store-platform -n store-platform
k3d cluster delete store-platform
```

## Development (No K8s)

For working on the API/Dashboard without Kubernetes:

```bash
# Install deps
./scripts/setup.sh

# Terminal 1: API (port 3001)
cd api && npm run dev

# Terminal 2: Dashboard (port 3000)
cd dashboard && npm start
```

The API will log a warning that the K8s client is unavailable but will still serve the REST endpoints (Helm/K8s operations will fail gracefully).

## Docker Compose (No K8s)

```bash
docker-compose up --build
# Dashboard: http://localhost:3000
# API: http://localhost:3001/api/stores
```

## MedusaJS (Stubbed)

The Medusa chart is architecturally complete (PostgreSQL, Redis, Medusa deployment, Ingress, security templates) but not yet end-to-end tested. The provisioner already handles `engine: "medusa"` and will deploy the chart. To complete Medusa support:

1. Verify the `medusajs/medusa:1.20` image starts correctly with the provided env vars
2. Add a seed Job similar to `woo-setup-job.yaml` for Medusa admin user + sample products
3. Test end-to-end order flow via Medusa storefront
