import { Store, StoreMetrics, StoreEvent } from './types';
import logger from './logger';

/**
 * In-memory store database. In production, replace with a persistent store (e.g., PostgreSQL).
 * The API is designed so swapping this is straightforward.
 */
class StoreDB {
  private stores: Map<string, Store> = new Map();
  private metrics: StoreMetrics = {
    totalStores: 0,
    provisioningStores: 0,
    readyStores: 0,
    failedStores: 0,
    totalProvisioned: 0,
    totalDeleted: 0,
    avgProvisioningDurationMs: 0,
  };
  private provisioningDurations: number[] = [];

  getAll(): Store[] {
    return Array.from(this.stores.values()).sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
  }

  get(id: string): Store | undefined {
    return this.stores.get(id);
  }

  getByName(name: string): Store | undefined {
    return Array.from(this.stores.values()).find((s) => s.name === name);
  }

  getByNamespace(namespace: string): Store | undefined {
    return Array.from(this.stores.values()).find((s) => s.namespace === namespace);
  }

  create(store: Store): void {
    this.stores.set(store.id, store);
    this.recalcMetrics();
  }

  update(id: string, updates: Partial<Store>): Store | undefined {
    const store = this.stores.get(id);
    if (!store) return undefined;

    const wasProvisioning = store.status === 'provisioning';
    Object.assign(store, updates, { updatedAt: new Date().toISOString() });

    if (wasProvisioning && store.status === 'ready') {
      const duration = new Date(store.updatedAt).getTime() - new Date(store.createdAt).getTime();
      this.provisioningDurations.push(duration);
      this.metrics.totalProvisioned++;
    }

    this.recalcMetrics();
    return store;
  }

  addEvent(id: string, event: StoreEvent): void {
    const store = this.stores.get(id);
    if (store) {
      store.events.push(event);
      if (store.events.length > 100) {
        store.events = store.events.slice(-100);
      }
    }
  }

  delete(id: string): boolean {
    const existed = this.stores.delete(id);
    if (existed) {
      this.metrics.totalDeleted++;
      this.recalcMetrics();
    }
    return existed;
  }

  countByStatus(status: string): number {
    return Array.from(this.stores.values()).filter((s) => s.status === status).length;
  }

  count(): number {
    return this.stores.size;
  }

  getMetrics(): StoreMetrics {
    return { ...this.metrics };
  }

  private recalcMetrics(): void {
    const stores = Array.from(this.stores.values());
    this.metrics.totalStores = stores.length;
    this.metrics.provisioningStores = stores.filter((s) => s.status === 'provisioning').length;
    this.metrics.readyStores = stores.filter((s) => s.status === 'ready').length;
    this.metrics.failedStores = stores.filter((s) => s.status === 'failed').length;
    if (this.provisioningDurations.length > 0) {
      this.metrics.avgProvisioningDurationMs =
        this.provisioningDurations.reduce((a, b) => a + b, 0) / this.provisioningDurations.length;
    }
  }
}

export const storeDB = new StoreDB();
