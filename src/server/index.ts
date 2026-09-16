import { createServer } from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import express from 'express';
import { config } from './config.js';
import { getDb } from './db.js';
import { ensureSchema } from './schema.js';
import { attachUser } from './auth.js';
import { api } from './routes.js';
import { Hub } from './realtime.js';
import { buildSnapshot, setHub, startTicker } from './sessions.js';
import { loadUser } from './auth.js';

async function main(): Promise<void> {
  const db = await getDb();
  await ensureSchema(db);

  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', true);
  app.use(express.json({ limit: '16kb' }));
  app.use(attachUser);
  app.use('/api', api);

  // Production: serve the built client with an SPA fallback.
  const clientDir = path.resolve(process.cwd(), 'dist/client');
  if (fs.existsSync(clientDir)) {
    app.use(express.static(clientDir, { index: false, maxAge: '1h', etag: true }));
    app.use((req, res, next) => {
      if (req.method !== 'GET' || req.path.startsWith('/api') || req.path === '/ws') return next();
      res.setHeader('Cache-Control', 'no-cache');
      res.sendFile(path.join(clientDir, 'index.html'));
    });
  } else {
    app.get('/', (_req, res) => {
      res
        .type('text/plain')
        .send('Specs API is running. In development, open the Vite dev server (http://localhost:5173). In production, run `npm run build` first.');
    });
  }

  const server = createServer(app);
  const hub = new Hub(async (userId) => buildSnapshot(await loadUser(userId)));
  hub.attach(server);
  setHub(hub);
  const ticker = startTicker();

  server.listen(config.port, () => {
    console.log(`[specs] listening on http://localhost:${config.port} (${config.isProd ? 'production' : 'development'})`);
  });

  const shutdown = () => {
    console.log('[specs] shutting down');
    clearInterval(ticker);
    hub.close();
    server.close(() => {
      db.close().finally(() => process.exit(0));
    });
    setTimeout(() => process.exit(0), 3000).unref();
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error('[specs] failed to start', err);
  process.exit(1);
});
