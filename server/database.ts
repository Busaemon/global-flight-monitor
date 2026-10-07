import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import type { DashboardResponse, DataMode, Flight, HistoryPoint } from '../shared/types.ts';

export type StoredSnapshot = Pick<DashboardResponse,
  'mode' | 'source' | 'coverageNote' | 'fetchedAt' | 'observedAt' | 'stats' | 'flights'>;

/** Current state and history are partitioned by mode, including the primary keys. */
export class FlightDatabase {
  private readonly connection: DatabaseSync;

  constructor(path = process.env.DATABASE_PATH ?? resolve('data/flights.sqlite')) {
    if (!path.trim()) throw new Error('DATABASE_PATH must not be empty.');
    if (path !== ':memory:') mkdirSync(dirname(resolve(path)), { recursive: true });
    this.connection = new DatabaseSync(path);
    this.connection.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
    if (path !== ':memory:') this.connection.exec('PRAGMA journal_mode = WAL;');
    this.migrate();
  }

  private migrate() {
    const row = this.connection.prepare('PRAGMA user_version').get() as { user_version: number };
    if (row.user_version > 1) throw new Error('This database was created by a newer application version.');
    if (row.user_version === 1) return;
    this.connection.exec(`
      BEGIN IMMEDIATE;
      CREATE TABLE snapshots (
        mode TEXT PRIMARY KEY CHECK (mode IN ('live', 'demo')),
        source TEXT NOT NULL, coverage_note TEXT NOT NULL,
        fetched_at TEXT NOT NULL, observed_at TEXT NOT NULL,
        airborne INTEGER NOT NULL, total_observed INTEGER NOT NULL,
        with_position INTEGER NOT NULL, countries INTEGER NOT NULL,
        avg_altitude_meters REAL, avg_velocity_mps REAL
      );
      CREATE TABLE current_flights (
        mode TEXT NOT NULL REFERENCES snapshots(mode) ON DELETE CASCADE,
        icao24 TEXT NOT NULL, callsign TEXT NOT NULL, origin_country TEXT NOT NULL,
        longitude REAL, latitude REAL, altitude_meters REAL, velocity_mps REAL,
        heading_degrees REAL, vertical_rate_mps REAL, on_ground INTEGER NOT NULL,
        last_contact TEXT NOT NULL, position_updated_at TEXT, position_source TEXT NOT NULL,
        PRIMARY KEY (mode, icao24)
      );
      CREATE TABLE count_history (
        mode TEXT NOT NULL CHECK (mode IN ('live', 'demo')),
        observed_at TEXT NOT NULL, airborne INTEGER NOT NULL,
        PRIMARY KEY (mode, observed_at)
      );
      CREATE INDEX history_mode_time ON count_history(mode, observed_at DESC);
      PRAGMA user_version = 1;
      COMMIT;
    `);
  }

  ready(): boolean {
    return Boolean(this.connection.prepare('SELECT 1 AS ready').get());
  }

  save(snapshot: StoredSnapshot) {
    const { mode, stats } = snapshot;
    if (!snapshot.fetchedAt || !snapshot.observedAt) throw new Error('A stored snapshot requires timestamps.');
    const upsert = this.connection.prepare(`INSERT INTO snapshots VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(mode) DO UPDATE SET source=excluded.source, coverage_note=excluded.coverage_note,
      fetched_at=excluded.fetched_at, observed_at=excluded.observed_at, airborne=excluded.airborne,
      total_observed=excluded.total_observed, with_position=excluded.with_position,
      countries=excluded.countries, avg_altitude_meters=excluded.avg_altitude_meters,
      avg_velocity_mps=excluded.avg_velocity_mps`);
    const flightInsert = this.connection.prepare('INSERT INTO current_flights VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
    this.connection.exec('BEGIN IMMEDIATE');
    try {
      upsert.run(mode, snapshot.source, snapshot.coverageNote, snapshot.fetchedAt, snapshot.observedAt,
        stats.airborne, stats.totalObserved, stats.withPosition, stats.countries,
        stats.avgAltitudeMeters, stats.avgVelocityMps);
      this.connection.prepare('DELETE FROM current_flights WHERE mode = ?').run(mode);
      for (const flight of snapshot.flights) {
        flightInsert.run(mode, flight.icao24, flight.callsign, flight.originCountry,
          flight.longitude, flight.latitude, flight.altitudeMeters, flight.velocityMps,
          flight.headingDegrees, flight.verticalRateMps, Number(flight.onGround),
          flight.lastContact, flight.positionUpdatedAt, flight.positionSource);
      }
      this.insertHistory(mode, snapshot.observedAt, stats.airborne);
      this.pruneHistory(mode, snapshot.observedAt);
      this.connection.exec('COMMIT');
    } catch (error) {
      this.connection.exec('ROLLBACK');
      throw error;
    }
  }

  private insertHistory(mode: DataMode, observedAt: string, airborne: number) {
    this.connection.prepare(`INSERT INTO count_history VALUES (?, ?, ?)
      ON CONFLICT(mode, observed_at) DO UPDATE SET airborne=excluded.airborne`).run(mode, observedAt, airborne);
  }

  private pruneHistory(mode: DataMode, observedAt: string) {
    const cutoff = new Date(Date.parse(observedAt) - 24 * 60 * 60 * 1000).toISOString();
    this.connection.prepare('DELETE FROM count_history WHERE mode = ? AND observed_at < ?').run(mode, cutoff);
    this.connection.prepare(`DELETE FROM count_history WHERE mode = ? AND observed_at NOT IN
      (SELECT observed_at FROM count_history WHERE mode = ? ORDER BY observed_at DESC LIMIT 1440)`).run(mode, mode);
  }

  seedDemoHistory(points: HistoryPoint[]) {
    const latest = this.history('demo', 1)[0];
    if (!points.length || (latest && latest.observedAt >= points[0].observedAt)) return;
    this.connection.exec('BEGIN IMMEDIATE');
    try {
      for (const point of points) this.insertHistory('demo', point.observedAt, point.airborne);
      this.connection.exec('COMMIT');
    } catch (error) {
      this.connection.exec('ROLLBACK');
      throw error;
    }
  }

  history(mode: DataMode, limit = 360): HistoryPoint[] {
    const rows = this.connection.prepare(`SELECT observed_at, airborne FROM count_history
      WHERE mode = ? ORDER BY observed_at DESC LIMIT ?`).all(mode, limit) as Array<{ observed_at: string; airborne: number }>;
    return rows.reverse().map(row => ({ observedAt: row.observed_at, airborne: row.airborne }));
  }

  read(mode: DataMode): StoredSnapshot | null {
    const row = this.connection.prepare('SELECT * FROM snapshots WHERE mode = ?').get(mode);
    if (!row) return null;
    const rows = this.connection.prepare('SELECT * FROM current_flights WHERE mode = ? ORDER BY icao24').all(mode);
    const flights: Flight[] = rows.map(flight => ({
      icao24: String(flight.icao24), callsign: String(flight.callsign), originCountry: String(flight.origin_country),
      longitude: flight.longitude as number | null, latitude: flight.latitude as number | null,
      altitudeMeters: flight.altitude_meters as number | null, velocityMps: flight.velocity_mps as number | null,
      headingDegrees: flight.heading_degrees as number | null, verticalRateMps: flight.vertical_rate_mps as number | null,
      onGround: Boolean(flight.on_ground), lastContact: String(flight.last_contact),
      positionUpdatedAt: flight.position_updated_at as string | null, positionSource: String(flight.position_source),
    }));
    return {
      mode, source: String(row.source), coverageNote: String(row.coverage_note),
      fetchedAt: String(row.fetched_at), observedAt: String(row.observed_at),
      stats: {
        airborne: Number(row.airborne), totalObserved: Number(row.total_observed),
        withPosition: Number(row.with_position), countries: Number(row.countries),
        avgAltitudeMeters: row.avg_altitude_meters as number | null,
        avgVelocityMps: row.avg_velocity_mps as number | null,
      }, flights,
    };
  }

  close() { this.connection.close(); }
}
