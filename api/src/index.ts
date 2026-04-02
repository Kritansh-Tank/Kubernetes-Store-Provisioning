import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { createStore, deleteStore, getStores, getStore, getMetrics } from './provisioner';
import logger from './logger';

const app = express();
const PORT = parseInt(process.env.PORT || '3001', 10);

app.use(helmet());
app.use(cors());
app.use(express.json());

// Health checks
app.get('/healthz', (_req, res) => {
  res.json({ status: 'ok' });
});

app.get('/readyz', (_req, res) => {
  res.json({ status: 'ready' });
});

// List all stores
app.get('/api/stores', (_req, res) => {
  try {
    const stores = getStores();
    res.json(stores);
  } catch (err: any) {
    logger.error(`GET /api/stores error: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

// Get single store
app.get('/api/stores/:id', (req, res) => {
  try {
    const store = getStore(req.params.id);
    if (!store) {
      return res.status(404).json({ error: 'Store not found' });
    }
    res.json(store);
  } catch (err: any) {
    logger.error(`GET /api/stores/:id error: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

// Create store
app.post('/api/stores', async (req, res) => {
  try {
    const { name, engine } = req.body;

    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      return res.status(400).json({ error: 'Store name is required' });
    }

    if (!engine || !['woocommerce', 'medusa'].includes(engine)) {
      return res.status(400).json({ error: 'Engine must be "woocommerce" or "medusa"' });
    }

    if (name.length > 50) {
      return res.status(400).json({ error: 'Store name must be 50 characters or less' });
    }

    const store = await createStore({ name: name.trim(), engine });
    res.status(201).json(store);
  } catch (err: any) {
    logger.error(`POST /api/stores error: ${err.message}`);
    const status = err.message.includes('already exists') ? 409 :
                   err.message.includes('Maximum') ? 429 : 500;
    res.status(status).json({ error: err.message });
  }
});

// Delete store
app.delete('/api/stores/:id', async (req, res) => {
  try {
    await deleteStore(req.params.id);
    res.json({ message: 'Store deletion initiated' });
  } catch (err: any) {
    logger.error(`DELETE /api/stores/:id error: ${err.message}`);
    const status = err.message.includes('not found') ? 404 : 500;
    res.status(status).json({ error: err.message });
  }
});

// Metrics
app.get('/api/metrics', (_req, res) => {
  try {
    res.json(getMetrics());
  } catch (err: any) {
    logger.error(`GET /api/metrics error: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, '0.0.0.0', () => {
  logger.info(`Store Provisioning API running on port ${PORT}`);
});

export default app;
