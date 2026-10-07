import { FlightDatabase } from './database.ts';
import { FlightService } from './service.ts';
import { createApp } from './app.ts';

try { process.loadEnvFile(); }
catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }

const rawPort = Number(process.env.PORT ?? 3001);
if (!Number.isInteger(rawPort) || rawPort < 1 || rawPort > 65535) throw new Error('PORT must be an integer from 1 to 65535.');
const backgroundSetting = process.env.BACKGROUND_REFRESH;
if (backgroundSetting !== undefined && !['true', 'false'].includes(backgroundSetting)) {
  throw new Error('BACKGROUND_REFRESH must be true or false.');
}
const collectInBackground = backgroundSetting === 'true' || (backgroundSetting === undefined && process.env.NODE_ENV === 'production');
const database = new FlightDatabase();
let service: FlightService;
let app: ReturnType<typeof createApp>;
try {
  service = new FlightService(database);
  app = createApp({ service });
} catch (error) {
  database.close();
  throw error;
}
const server = app.listen(rawPort, process.env.HOST ?? '127.0.0.1', () => {
  console.log(`Flight Monitor API: http://localhost:${rawPort}`);
  console.log(`Live polling: ${service.pollIntervalSeconds} seconds. Background collection: ${collectInBackground}.`);
  if (collectInBackground) service.start();
});
server.headersTimeout = 10_000;
server.requestTimeout = 30_000;
server.keepAliveTimeout = 5_000;
server.maxRequestsPerSocket = 100;

let shuttingDown = false;
async function stop() {
  if (shuttingDown) return;
  shuttingDown = true;
  // Stop accepting requests before waiting for collection and existing responses to finish.
  const deadline = setTimeout(() => {
    console.error('Graceful shutdown exceeded 15 seconds.');
    server.closeAllConnections();
    process.exit(1);
  }, 15_000);
  deadline.unref();
  const closed = new Promise<void>(resolve => { server.close(() => { resolve(); }); });
  try {
    await Promise.all([closed, service.stop()]);
  } catch {
    console.error('Could not finish pending collection during shutdown.');
    process.exitCode = 1;
  } finally {
    clearTimeout(deadline);
    database.close();
  }
}
process.once('SIGINT', () => { void stop(); });
process.once('SIGTERM', () => { void stop(); });
server.on('error', error => {
  console.error(`Could not start API server: ${error.message}`);
  process.exitCode = 1;
  void stop();
});
