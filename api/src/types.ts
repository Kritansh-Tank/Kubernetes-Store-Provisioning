export interface Store {
  id: string;
  name: string;
  engine: 'woocommerce' | 'medusa';
  status: 'provisioning' | 'ready' | 'failed' | 'deleting';
  namespace: string;
  storeUrl: string;
  adminUrl: string;
  createdAt: string;
  updatedAt: string;
  error?: string;
  events: StoreEvent[];
}

export interface StoreEvent {
  timestamp: string;
  type: 'info' | 'warn' | 'error';
  message: string;
}

export interface CreateStoreRequest {
  name: string;
  engine: 'woocommerce' | 'medusa';
}

export interface StoreMetrics {
  totalStores: number;
  provisioningStores: number;
  readyStores: number;
  failedStores: number;
  totalProvisioned: number;
  totalDeleted: number;
  avgProvisioningDurationMs: number;
}
