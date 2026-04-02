import * as k8s from '@kubernetes/client-node';
import { v4 as uuidv4 } from 'uuid';
import { Store, CreateStoreRequest } from './types';
import { storeDB } from './store-db';
import logger from './logger';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

const DOMAIN_SUFFIX = process.env.DOMAIN_SUFFIX || 'local.store-platform.test';
const HELM_TIMEOUT = process.env.HELM_TIMEOUT || '600s';
const MAX_STORES = parseInt(process.env.MAX_STORES || '20', 10);
const MAX_CONCURRENT_PROVISIONS = parseInt(process.env.MAX_CONCURRENT_PROVISIONS || '5', 10);
const WOOCOMMERCE_CHART_PATH = process.env.WOOCOMMERCE_CHART_PATH || '/app/charts/woocommerce-store';
const MEDUSA_CHART_PATH = process.env.MEDUSA_CHART_PATH || '/app/charts/medusa-store';
const PROVISION_TIMEOUT_MS = parseInt(process.env.PROVISION_TIMEOUT_MS || '600000', 10);

let kc: k8s.KubeConfig;
let k8sApi: k8s.CoreV1Api;
let k8sAppsApi: k8s.AppsV1Api;
let k8sAvailable = false;

try {
  kc = new k8s.KubeConfig();
  kc.loadFromDefault();
  k8sApi = kc.makeApiClient(k8s.CoreV1Api);
  k8sAppsApi = kc.makeApiClient(k8s.AppsV1Api);
  k8sAvailable = true;
  logger.info('Kubernetes client initialized');
} catch (err) {
  logger.warn('Kubernetes client not available - running in dev mode');
}

/**
 * Startup reconciliation: scan existing store-* namespaces and Helm releases
 * to rebuild in-memory state after an API restart. This ensures the system
 * recovers cleanly if the provisioning component restarts mid-provisioning.
 */
async function reconcileOnStartup(): Promise<void> {
  if (!k8sAvailable) {
    logger.info('Skipping reconciliation - no K8s client');
    return;
  }

  try {
    logger.info('Starting reconciliation of existing store namespaces...');
    const { stdout } = await execAsync(
      'helm list --all-namespaces --filter "^[a-z]" --output json',
      { timeout: 30000 }
    );

    const releases: Array<{
      name: string;
      namespace: string;
      status: string;
      chart: string;
      app_version: string;
      updated: string;
    }> = JSON.parse(stdout || '[]');

    let reconciled = 0;
    for (const release of releases) {
      // Only process store namespaces (store-*)
      if (!release.namespace.startsWith('store-')) continue;

      // Skip if already tracked
      if (storeDB.getByNamespace(release.namespace)) continue;

      const engine: 'woocommerce' | 'medusa' = release.chart.includes('medusa') ? 'medusa' : 'woocommerce';
      const storeName = release.name;
      const isDeployed = release.status === 'deployed';

      // Check if the main deployment is ready
      let status: 'ready' | 'provisioning' | 'failed' = 'provisioning';
      const deploymentName = engine === 'woocommerce'
        ? `${storeName}-wordpress`
        : `${storeName}-medusa`;

      try {
        const { body } = await k8sAppsApi.readNamespacedDeployment(deploymentName, release.namespace);
        if (body.status?.readyReplicas && body.status.readyReplicas >= 1) {
          status = 'ready';
        } else if (!isDeployed) {
          status = 'failed';
        }
      } catch {
        status = isDeployed ? 'provisioning' : 'failed';
      }

      const domain = `${storeName}.${DOMAIN_SUFFIX}`;
      const store: Store = {
        id: uuidv4(),
        name: storeName,
        engine,
        status,
        namespace: release.namespace,
        storeUrl: status === 'ready' ? `http://${domain}` : '',
        adminUrl: status === 'ready'
          ? (engine === 'woocommerce' ? `http://${domain}/wp-admin` : `http://${domain}/app`)
          : '',
        createdAt: release.updated || new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        events: [{
          timestamp: new Date().toISOString(),
          type: 'info',
          message: `Reconciled from existing Helm release (status: ${status})`,
        }],
      };

      storeDB.create(store);
      reconciled++;
      logger.info(`Reconciled store: ${storeName} (${engine}, ${status}) in ${release.namespace}`);
    }

    logger.info(`Reconciliation complete: ${reconciled} store(s) recovered`);
  } catch (err: any) {
    logger.warn(`Reconciliation failed (non-fatal): ${err.message}`);
  }
}

// Run reconciliation on startup (non-blocking)
reconcileOnStartup();

function sanitizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .substring(0, 40);
}

function addEvent(storeId: string, type: 'info' | 'warn' | 'error', message: string) {
  storeDB.addEvent(storeId, {
    timestamp: new Date().toISOString(),
    type,
    message,
  });
  logger.info(`[${storeId}] ${type}: ${message}`);
}

async function helmInstall(
  releaseName: string,
  chartPath: string,
  namespace: string,
  values: Record<string, string>
): Promise<void> {
  const setArgs = Object.entries(values)
    .map(([k, v]) => `--set ${k}=${v}`)
    .join(' ');

  const cmd = `helm upgrade --install ${releaseName} ${chartPath} --namespace ${namespace} --create-namespace ${setArgs} --timeout ${HELM_TIMEOUT} --wait`;

  logger.info(`Executing: ${cmd}`);
  const { stdout, stderr } = await execAsync(cmd, { timeout: PROVISION_TIMEOUT_MS });
  if (stdout) logger.info(`helm stdout: ${stdout}`);
  if (stderr) logger.warn(`helm stderr: ${stderr}`);
}

async function helmUninstall(releaseName: string, namespace: string): Promise<void> {
  const cmd = `helm uninstall ${releaseName} --namespace ${namespace}`;
  logger.info(`Executing: ${cmd}`);
  try {
    const { stdout, stderr } = await execAsync(cmd, { timeout: 120000 });
    if (stdout) logger.info(`helm stdout: ${stdout}`);
    if (stderr) logger.warn(`helm stderr: ${stderr}`);
  } catch (err: any) {
    logger.warn(`helm uninstall warning: ${err.message}`);
  }
}

async function deleteNamespace(namespace: string): Promise<void> {
  try {
    await k8sApi.deleteNamespace(namespace);
    logger.info(`Namespace ${namespace} deletion initiated`);
  } catch (err: any) {
    if (err.statusCode !== 404) {
      logger.error(`Failed to delete namespace ${namespace}: ${err.message}`);
      throw err;
    }
  }
}

async function provisionWooCommerce(store: Store): Promise<void> {
  const storeId = store.id;
  const sanitized = sanitizeName(store.name);
  const namespace = store.namespace;

  addEvent(storeId, 'info', 'Starting WooCommerce provisioning via Helm');

  const dbPassword = uuidv4().replace(/-/g, '').substring(0, 16);
  const wpAdminPassword = uuidv4().replace(/-/g, '').substring(0, 16);

  const helmValues: Record<string, string> = {
    'storeName': sanitized,
    'storeId': storeId,
    'domain': `${sanitized}.${DOMAIN_SUFFIX}`,
    'wordpress.adminUser': 'admin',
    'wordpress.adminPassword': wpAdminPassword,
    'wordpress.adminEmail': `admin@${sanitized}.${DOMAIN_SUFFIX}`,
    'mariadb.rootPassword': dbPassword,
    'mariadb.password': dbPassword,
    'mariadb.database': 'wordpress',
    'mariadb.user': 'wordpress',
  };

  await helmInstall(sanitized, WOOCOMMERCE_CHART_PATH, namespace, helmValues);

  addEvent(storeId, 'info', 'Helm release installed, waiting for pods to be ready');

  // Wait for WordPress deployment to be ready
  await waitForDeployment(namespace, `${sanitized}-wordpress`, storeId);

  storeDB.update(storeId, {
    status: 'ready',
    storeUrl: `http://${sanitized}.${DOMAIN_SUFFIX}`,
    adminUrl: `http://${sanitized}.${DOMAIN_SUFFIX}/wp-admin`,
  });

  addEvent(storeId, 'info', `Store ready at http://${sanitized}.${DOMAIN_SUFFIX}`);
  addEvent(storeId, 'info', `Admin: admin / ${wpAdminPassword}`);
}

async function provisionMedusa(store: Store): Promise<void> {
  const storeId = store.id;
  const sanitized = sanitizeName(store.name);
  const namespace = store.namespace;

  addEvent(storeId, 'info', 'Starting MedusaJS provisioning via Helm');

  const dbPassword = uuidv4().replace(/-/g, '').substring(0, 16);
  const jwtSecret = uuidv4().replace(/-/g, '');
  const cookieSecret = uuidv4().replace(/-/g, '');

  const helmValues: Record<string, string> = {
    'storeName': sanitized,
    'storeId': storeId,
    'domain': `${sanitized}.${DOMAIN_SUFFIX}`,
    'postgres.password': dbPassword,
    'postgres.database': 'medusa',
    'postgres.user': 'medusa',
    'medusa.jwtSecret': jwtSecret,
    'medusa.cookieSecret': cookieSecret,
  };

  await helmInstall(sanitized, MEDUSA_CHART_PATH, namespace, helmValues);

  addEvent(storeId, 'info', 'Helm release installed, waiting for pods to be ready');

  await waitForDeployment(namespace, `${sanitized}-medusa`, storeId);

  storeDB.update(storeId, {
    status: 'ready',
    storeUrl: `http://${sanitized}.${DOMAIN_SUFFIX}`,
    adminUrl: `http://${sanitized}.${DOMAIN_SUFFIX}/app`,
  });

  addEvent(storeId, 'info', `Store ready at http://${sanitized}.${DOMAIN_SUFFIX}`);
}

async function waitForDeployment(
  namespace: string,
  deploymentName: string,
  storeId: string,
  timeoutMs: number = PROVISION_TIMEOUT_MS
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const { body } = await k8sAppsApi.readNamespacedDeployment(deploymentName, namespace);
      const status = body.status;
      if (status?.readyReplicas && status.readyReplicas >= 1) {
        addEvent(storeId, 'info', `Deployment ${deploymentName} is ready`);
        return;
      }
      addEvent(storeId, 'info', `Waiting for ${deploymentName}: ${status?.readyReplicas || 0}/${status?.replicas || '?'} ready`);
    } catch (err: any) {
      if (err.statusCode !== 404) {
        addEvent(storeId, 'warn', `Error checking deployment: ${err.message}`);
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 10000));
  }
  throw new Error(`Deployment ${deploymentName} did not become ready within ${timeoutMs}ms`);
}

// Track active provisions for concurrency control
const activeProvisions = new Set<string>();

export async function createStore(req: CreateStoreRequest): Promise<Store> {
  // Validate limits
  if (storeDB.count() >= MAX_STORES) {
    throw new Error(`Maximum store limit (${MAX_STORES}) reached`);
  }

  if (activeProvisions.size >= MAX_CONCURRENT_PROVISIONS) {
    throw new Error(`Maximum concurrent provisions (${MAX_CONCURRENT_PROVISIONS}) reached. Try again later.`);
  }

  // Check for duplicate name
  const existing = storeDB.getByName(req.name);
  if (existing && existing.status !== 'failed') {
    throw new Error(`Store with name "${req.name}" already exists`);
  }

  // If a failed store with same name exists, clean it up first
  if (existing && existing.status === 'failed') {
    storeDB.delete(existing.id);
  }

  const id = uuidv4();
  const sanitized = sanitizeName(req.name);
  const namespace = `store-${sanitized}`;

  const store: Store = {
    id,
    name: req.name,
    engine: req.engine,
    status: 'provisioning',
    namespace,
    storeUrl: '',
    adminUrl: '',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    events: [],
  };

  storeDB.create(store);
  addEvent(id, 'info', `Store creation initiated (engine: ${req.engine})`);

  // Async provisioning
  activeProvisions.add(id);
  (async () => {
    const timeout = setTimeout(() => {
      if (storeDB.get(id)?.status === 'provisioning') {
        storeDB.update(id, { status: 'failed', error: 'Provisioning timed out' });
        addEvent(id, 'error', 'Provisioning timed out');
        activeProvisions.delete(id);
      }
    }, PROVISION_TIMEOUT_MS);

    try {
      if (req.engine === 'woocommerce') {
        await provisionWooCommerce(store);
      } else if (req.engine === 'medusa') {
        await provisionMedusa(store);
      }
    } catch (err: any) {
      const currentStore = storeDB.get(id);
      if (currentStore && currentStore.status === 'provisioning') {
        storeDB.update(id, { status: 'failed', error: err.message });
        addEvent(id, 'error', `Provisioning failed: ${err.message}`);
      }
    } finally {
      clearTimeout(timeout);
      activeProvisions.delete(id);
    }
  })();

  return store;
}

export async function deleteStore(id: string): Promise<void> {
  const store = storeDB.get(id);
  if (!store) {
    throw new Error('Store not found');
  }

  storeDB.update(id, { status: 'deleting' });
  addEvent(id, 'info', 'Store deletion initiated');

  (async () => {
    try {
      const sanitized = sanitizeName(store.name);

      // Uninstall Helm release
      await helmUninstall(sanitized, store.namespace);
      addEvent(id, 'info', 'Helm release uninstalled');

      // Delete namespace (cleans up all remaining resources)
      if (k8sApi) {
        await deleteNamespace(store.namespace);
        addEvent(id, 'info', 'Namespace deletion initiated');

        // Wait for namespace deletion
        const start = Date.now();
        while (Date.now() - start < 120000) {
          try {
            await k8sApi.readNamespace(store.namespace);
            await new Promise((r) => setTimeout(r, 3000));
          } catch (err: any) {
            if (err.statusCode === 404) break;
          }
        }
      }

      addEvent(id, 'info', 'All resources cleaned up');
      storeDB.delete(id);
    } catch (err: any) {
      addEvent(id, 'error', `Deletion failed: ${err.message}`);
      storeDB.update(id, { status: 'failed', error: `Deletion failed: ${err.message}` });
    }
  })();
}

export function getStores(): Store[] {
  return storeDB.getAll();
}

export function getStore(id: string): Store | undefined {
  return storeDB.get(id);
}

export function getMetrics() {
  return storeDB.getMetrics();
}
