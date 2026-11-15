/**
 * Local server entry: `pnpm --filter @soc/api dev` (tsx watch, loads ../../.env).
 * Listens on 0.0.0.0 so a phone on the same LAN can reach http://<pc-ip>:4000/api.
 */
import { createDb } from '@soc/db';
import { FileMailer } from './adapters/mail.js';
import { FsStorage } from './adapters/storage.js';
import { buildApp } from './app.js';
import { loadConfig } from './config.js';

const config = loadConfig();
const { db, close } = createDb(config.databaseUrl);
const app = await buildApp({
  db,
  storage: new FsStorage(config.storageDir),
  mail: new FileMailer(config.mailDir, config.mailFrom),
  config,
});

const shutdown = async (signal: string) => {
  app.log.info({ signal }, 'shutting down');
  await app.close();
  await close();
  process.exit(0);
};
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

try {
  await app.listen({ host: config.host, port: config.port });
  app.log.info(`SOC API on http://${config.host}:${config.port}/api (auth=${config.authMode}, storage=${config.storageDir}, mail=${config.mailDir})`);
} catch (err) {
  app.log.error(err);
  await close();
  process.exit(1);
}
