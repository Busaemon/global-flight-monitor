import { FlightDatabase } from './database.ts';

try { process.loadEnvFile(); }
catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }

const database = new FlightDatabase();
if (!database.ready()) throw new Error('Database initialization failed.');
database.close();
console.log('SQLite database is ready (schema version 1).');
