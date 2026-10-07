import { FlightDatabase } from './database.ts';
import { FlightService } from './service.ts';
import { createApp } from './app.ts';

try { process.loadEnvFile(); }
catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }

const rawPort = Number(process.env.PORT ?? 3001);
if (!Number.isInteger(rawPort) || rawPort < 1 || rawPort > 65535) throw new Error('PORT must be an integer from 1 to 65535.');
const database = new FlightDatabase();
const service = new FlightService(database);
const app = createApp({ service });
const server = app.listen(rawPort, process.env.HOST ?? '0.0.0.0', () => {
  console.log(`Flight Monitor API: http://localhost:${rawPort}`);
  console.log(`Live polling: ${service.pollIntervalSeconds} seconds. Demo data is stored separately.`);
});

let shuttingDown = false;
function stop() {
  if (shuttingDown) return;
  shuttingDown = true;
  server.close(() => { database.close(); });
}
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
server.on('error', error => {
  console.error(`Could not start API server: ${error.message}`);
  database.close();
  process.exitCode = 1;
});
