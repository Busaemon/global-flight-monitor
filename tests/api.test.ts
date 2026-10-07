import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import type { DashboardResponse, DashboardSummaryResponse, Flight, FlightListResponse, FlightMapResponse } from '../shared/types.ts';
import { createApp } from '../server/app.ts';
import { FlightDatabase } from '../server/database.ts';
import { summarize } from '../server/opensky.ts';
import { FlightService } from '../server/service.ts';

const NOW = 1_800_000_000_000;
function flight(index: number, overrides: Partial<Flight> = {}): Flight {
  return {
    icao24: index.toString(16).padStart(6, '0'), callsign: `TEST${index.toString().padStart(4, '0')}`, originCountry: 'Japan',
    latitude: 35, longitude: 139, altitudeMeters: 10_000, velocityMps: 230, headingDegrees: 90,
    verticalRateMps: 0, onGround: false, lastContact: new Date(NOW).toISOString(),
    positionUpdatedAt: new Date(NOW).toISOString(), positionSource: 'ADS-B', ...overrides,
  };
}

async function withApi(flights: Flight[], run: (context: { base: string; service: FlightService; calls: () => number; advance: (ms: number) => void }) => Promise<void>, staticDirectory = '/tmp/skytrace-no-dist-api-test') {
  const database = new FlightDatabase(':memory:');
  let now = NOW;
  let calls = 0;
  const service = new FlightService(database, {
    now: () => now, pollIntervalSeconds: 60, provider: { fetchObservation: async () => {
      calls++;
      return { flights, observedAt: new Date(now).toISOString(), stats: summarize(flights, flights.length + 2) };
    } },
  });
  const server = createApp({ service, staticDirectory }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try { await run({ base, service, calls: () => calls, advance: ms => { now += ms; } }); }
  finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    await service.stop();
    database.close();
  }
}

test('lightweight summary and paginated flights preserve global counts with stable null-last sorting', async () => {
  const flights = [
    flight(1, { callsign: 'alpha', altitudeMeters: null, velocityMps: null }),
    flight(2, { callsign: 'ALPHA', altitudeMeters: 9000, velocityMps: 200 }),
    flight(3, { callsign: 'Bravo', originCountry: 'France', altitudeMeters: 9000, velocityMps: 250 }),
    flight(4, { callsign: 'Charlie', originCountry: 'France', altitudeMeters: 11000, velocityMps: 250 }),
    flight(5, { callsign: 'Delta', latitude: null, longitude: null, altitudeMeters: null, velocityMps: 100 }),
  ];
  await withApi(flights, async ({ base, calls }) => {
    const summary = await (await fetch(`${base}/api/summary`)).json() as DashboardSummaryResponse;
    assert.equal('flights' in summary, false);
    assert.equal(summary.stats.airborne, 5);
    assert.equal(summary.stats.withPosition, 4);
    assert.equal(summary.stats.totalObserved, 7);

    const first = await (await fetch(`${base}/api/flights?limit=2`)).json() as FlightListResponse;
    assert.deepEqual(first.flights.map(item => item.icao24), ['000001', '000002']);
    assert.equal(first.pageCount, 3);
    assert.equal(first.pageSize, 2);
    assert.equal(first.total, 5);
    const last = await (await fetch(`${base}/api/flights?limit=2&page=100`)).json() as FlightListResponse;
    assert.equal(last.page, 3);
    assert.deepEqual(last.flights.map(item => item.icao24), ['000005']);
    const altitude = await (await fetch(`${base}/api/flights?sort=altitude`)).json() as FlightListResponse;
    assert.deepEqual(altitude.flights.map(item => item.icao24), ['000004', '000002', '000003', '000001', '000005']);
    const speed = await (await fetch(`${base}/api/flights?sort=speed`)).json() as FlightListResponse;
    assert.deepEqual(speed.flights.map(item => item.icao24), ['000003', '000004', '000002', '000005', '000001']);
    const search = await (await fetch(`${base}/api/flights?q=fRaNcE`)).json() as FlightListResponse;
    assert.equal(search.total, 2);
    const empty = await (await fetch(`${base}/api/flights?q=missing&page=30`)).json() as FlightListResponse;
    assert.deepEqual(empty.flights, []);
    assert.equal(empty.total, 0);
    assert.equal(empty.pageCount, 0);
    assert.equal(empty.page, 1);
    const again = await (await fetch(`${base}/api/summary`)).json() as DashboardSummaryResponse;
    assert.deepEqual(again.stats, summary.stats);
    assert.equal(calls(), 1);
  });
});

test('map respects antimeridian bounds, search and selected aircraft without leaking details or missing positions', async () => {
  await withApi([
    flight(1, { longitude: 179, originCountry: 'Japan' }),
    flight(2, { longitude: -179, originCountry: 'Japan' }),
    flight(3, { longitude: 0, originCountry: 'France' }),
    flight(4, { latitude: 70, longitude: -179, originCountry: 'Japan' }),
    flight(5, { latitude: null, longitude: null }),
  ], async ({ base }) => {
    const map = await (await fetch(`${base}/api/map?bounds=170,0,-170,60&limit=1&selected=000002`)).json() as FlightMapResponse;
    assert.equal(map.total, 2);
    assert.equal(map.sampled, true);
    assert.deepEqual(map.flights.map(item => item.icao24), ['000002']);
    assert.deepEqual(Object.keys(map.flights[0]).sort(), ['callsign', 'headingDegrees', 'icao24', 'latitude', 'longitude', 'originCountry']);
    for (const query of ['bounds=170,0,-170,60&selected=000003', 'q=France&selected=000001']) {
      const selectedOutside = await (await fetch(`${base}/api/map?${query}`)).json() as FlightMapResponse;
      assert.equal(selectedOutside.flights.some(item => item.icao24 === (query.startsWith('q=') ? '000001' : '000003')), false);
    }
    const world = await (await fetch(`${base}/api/map`)).json() as FlightMapResponse;
    assert.equal(world.total, 4);
    assert.equal(world.sampled, false);
  });
});

test('large observations return capped deterministic map samples and smaller summary payloads', async () => {
  const flights = Array.from({ length: 1305 }, (_, index) => flight(index + 1));
  await withApi(flights, async ({ base }) => {
    const dashboard = await (await fetch(`${base}/api/dashboard`)).text();
    assert.equal((JSON.parse(dashboard) as DashboardResponse).flights.length, 1305);
    const summary = await (await fetch(`${base}/api/summary`)).text();
    assert.ok(summary.length < dashboard.length / 100);
    const map = await (await fetch(`${base}/api/map?limit=1000`)).json() as FlightMapResponse;
    const repeated = await (await fetch(`${base}/api/map?limit=1000`)).json() as FlightMapResponse;
    assert.equal(map.flights.length, 1000);
    assert.equal(new Set(map.flights.map(item => item.icao24)).size, 1000);
    assert.equal(map.total, 1305);
    assert.equal(map.sampled, true);
    assert.deepEqual(map, repeated);
    const selected = flights.at(-1)!.icao24;
    const mapSelected = await (await fetch(`${base}/api/map?limit=1000&selected=${selected}`)).json() as FlightMapResponse;
    assert.equal(mapSelected.flights.length, 1000);
    assert.equal(mapSelected.flights.some(item => item.icao24 === selected), true);
    const list = await (await fetch(`${base}/api/flights?limit=50`)).json() as FlightListResponse;
    assert.equal(list.flights.length, 50);
    assert.equal(list.total, 1305);
  });
});

test('API rejects duplicate, unknown and invalid query parameters before fetching upstream', async () => {
  await withApi([flight(1)], async ({ base, calls }) => {
    const paths = [
      '/api/summary?mode=', '/api/summary?mode=demo&mode=live', '/api/summary?unknown=1', '/api/health?unknown=1',
      '/api/flights?sort=', '/api/flights?sort=bad', '/api/flights?page=0', '/api/flights?page=-1',
      '/api/flights?page=1.5', '/api/flights?page=1e3', '/api/flights?page=1000001', '/api/flights?limit=51',
      '/api/flights?limit=', '/api/flights?limit=1&limit=2', '/api/flights?q[bad]=value',
      `/api/flights?q=${'a'.repeat(81)}`, '/api/flights?q=%00', '/api/flights?unknown=value',
      '/api/map?bounds=', '/api/map?bounds=1,2,3', '/api/map?bounds=1,90,2,80',
      '/api/map?bounds=-181,-90,180,90', '/api/map?bounds=0,-91,1,90', '/api/map?bounds=0x10,0,20,10',
      '/api/map?bounds=NaN,0,1,10', '/api/map?bounds=0,,1,10', '/api/map?limit=1001', '/api/map?selected=bad',
      '/api/map?selected=000001&selected=000002', '/api/map?unknown=value', '/api/flights/000001?sort=speed',
    ];
    for (const path of paths) {
      const response = await fetch(base + path);
      assert.equal(response.status, 400, path);
      assert.equal(typeof (await response.json() as { error: unknown }).error, 'string', path);
    }
    assert.equal(calls(), 0);
  });
});

test('ETag revalidation preserves freshness checks and compressed JSON works', async () => {
  await withApi(Array.from({ length: 50 }, (_, index) => flight(index + 1)), async ({ base, calls, advance }) => {
    const first = await fetch(`${base}/api/flights?limit=50`, { headers: { 'Accept-Encoding': 'gzip' } });
    const etag = first.headers.get('etag');
    assert.ok(etag);
    assert.equal(first.headers.get('content-encoding'), 'gzip');
    assert.equal((await first.json() as FlightListResponse).flights.length, 50);
    const unchanged = await fetch(`${base}/api/flights?limit=50`, { headers: { 'If-None-Match': etag } });
    assert.equal(unchanged.status, 304);
    assert.equal(await unchanged.text(), '');
    assert.equal(unchanged.headers.get('cache-control'), 'private, no-cache, must-revalidate');
    assert.equal(calls(), 1);
    advance(60000);
    const refreshed = await fetch(`${base}/api/flights?limit=50`, { headers: { 'If-None-Match': etag } });
    assert.equal(refreshed.status, 200);
    assert.notEqual(refreshed.headers.get('etag'), etag);
    assert.equal(calls(), 2);
  });
});

test('static cache rules allow SPA navigation while missing assets remain 404', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'skytrace-static-test-'));
  try {
    await mkdir(join(directory, 'assets'));
    await writeFile(join(directory, 'index.html'), '<!doctype html><html><body>Skytrace</body></html>');
    await writeFile(join(directory, 'sw.js'), '// service worker');
    await writeFile(join(directory, 'manifest.webmanifest'), '{}');
    await writeFile(join(directory, 'assets', 'index-a1b2c3d4.js'), '// hashed script');
    await withApi([], async ({ base }) => {
      for (const path of ['/', '/flights/000001', '/sw.js', '/manifest.webmanifest']) {
        const response = await fetch(base + path);
        assert.equal(response.status, 200, path);
        assert.equal(response.headers.get('cache-control'), 'no-cache', path);
      }
      const asset = await fetch(`${base}/assets/index-a1b2c3d4.js`);
      assert.equal(asset.headers.get('cache-control'), 'public, max-age=31536000, immutable');
      for (const path of ['/assets/missing.js', '/assets/missing', '/icons/missing', '/missing.css', '/api/missing']) {
        assert.equal((await fetch(base + path)).status, 404, path);
      }
    }, directory);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
