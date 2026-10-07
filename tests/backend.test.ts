import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { once } from 'node:events';
import test from 'node:test';
import { createApp } from '../server/app.ts';
import { FlightDatabase, type StoredSnapshot } from '../server/database.ts';
import { LIVE_COVERAGE, LIVE_SOURCE, OpenSkyProvider, ProviderError, parseOpenSky,
  type FlightProvider, type Observation } from '../server/opensky.ts';
import { FlightService } from '../server/service.ts';
import type { DashboardResponse, FlightDetailResponse } from '../shared/types.ts';

const EPOCH = 1_800_000_000;
const NOW = EPOCH * 1000;

function vector(icao24: string, overrides: Record<number, unknown> = {}): unknown[] {
  const state: unknown[] = [icao24, ' ANA123 ', 'Japan', EPOCH - 3, EPOCH - 1,
    139.7, 35.6, 9000, false, 230, 90, 0.5, null, 9100, '7000', false, 0];
  for (const [index, value] of Object.entries(overrides)) state[Number(index)] = value;
  return state;
}

function observation(states: unknown[] = [vector('abc123')], time = EPOCH): Observation {
  return parseOpenSky({ time, states });
}

function snapshot(mode: 'live' | 'demo', value = observation()): StoredSnapshot {
  return {
    ...value, mode, source: mode === 'live' ? LIVE_SOURCE : 'Test demo',
    coverageNote: mode === 'live' ? LIVE_COVERAGE : 'Synthetic test data',
    fetchedAt: new Date(NOW).toISOString(),
  };
}

test('state vectors retain airborne aircraft with missing or old positions while excluding old contacts and ground aircraft', () => {
  const value = observation([
    vector('abc123'),
    vector('abc124', { 3: EPOCH - 121 }),
    vector('abc125', { 3: null, 5: null, 6: null, 7: 8500, 13: null }),
    vector('abc126', { 8: true }),
    vector('abc127', { 4: EPOCH - 121 }),
    vector('abc128', { 4: EPOCH + 31 }),
    vector('abc129', { 3: EPOCH + 31 }),
  ]);
  assert.deepEqual(value.flights.map(flight => flight.icao24), ['abc123', 'abc124', 'abc125', 'abc129']);
  assert.equal(value.stats.airborne, 4);
  assert.equal(value.stats.totalObserved, 5);
  assert.equal(value.stats.withPosition, 1);
  assert.equal(value.stats.countries, 1);
  assert.equal(value.flights[0].callsign, 'ANA123');
  assert.equal(value.flights[0].altitudeMeters, 9100);
  assert.equal(value.flights[0].lastContact, new Date((EPOCH - 1) * 1000).toISOString());
  assert.equal(value.flights[0].positionSource, 'ADS-B');
  assert.equal(value.flights[2].altitudeMeters, 8500);
  for (const flight of value.flights.slice(1)) {
    assert.equal(flight.latitude, null);
    assert.equal(flight.longitude, null);
    assert.equal(flight.positionUpdatedAt, null);
  }
});

test('parser validates measurements, normalizes identifiers, and keeps the latest contact per aircraft', () => {
  const value = observation([
    vector('ABC123', { 4: EPOCH - 10, 1: ' OLD ' }),
    vector('abc123', { 1: ' NEW ', 2: '', 5: 181, 7: -1000, 9: -1, 10: 360, 13: 31000, 16: 2 }),
    vector('abc124', { 4: EPOCH - 10 }),
    vector('abc124', { 8: true }),
    ['malformed'],
  ]);
  assert.equal(value.stats.totalObserved, 2);
  assert.equal(value.stats.airborne, 1);
  assert.equal(value.stats.withPosition, 0);
  assert.equal(value.stats.countries, 0);
  assert.equal(value.stats.avgAltitudeMeters, null);
  assert.equal(value.stats.avgVelocityMps, null);
  assert.equal(value.flights[0].icao24, 'abc123');
  assert.equal(value.flights[0].callsign, 'NEW');
  assert.equal(value.flights[0].headingDegrees, 0);
  assert.equal(value.flights[0].positionSource, 'MLAT');
});

test('empty OpenSky state sets represent a legitimate zero, while malformed payloads fail explicitly', () => {
  for (const states of [null, []]) {
    const value = parseOpenSky({ time: EPOCH, states });
    assert.deepEqual(value.flights, []);
    assert.deepEqual(value.stats, {
      airborne: 0, totalObserved: 0, withPosition: 0, countries: 0,
      avgAltitudeMeters: null, avgVelocityMps: null,
    });
  }
  for (const payload of [null, {}, { time: 0, states: [] }, { time: 9e12, states: [] }, { time: EPOCH },
    { time: EPOCH, states: {} }, { time: EPOCH, states: [['broken']] }]) {
    assert.throws(() => parseOpenSky(payload), ProviderError);
  }
});

test('SQLite survives reopen and isolates live and demo snapshots, aircraft, and count history', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'flight-monitor-test-'));
  const path = join(directory, 'nested', 'flights.sqlite');
  let database: FlightDatabase | undefined;
  try {
    database = new FlightDatabase(path);
    const live = snapshot('live');
    const demo = snapshot('demo', observation([vector('def456')]));
    database.save(live);
    database.save(demo);
    database.close();
    database = new FlightDatabase(path);
    assert.equal(database.ready(), true);
    assert.deepEqual(database.read('live'), live);
    assert.deepEqual(database.read('demo'), demo);
    assert.deepEqual(database.history('live'), [{ observedAt: live.observedAt!, airborne: 1 }]);
    database.save(snapshot('demo', observation([], EPOCH + 10)));
    assert.deepEqual(database.read('live'), live);
    assert.deepEqual(database.history('live'), [{ observedAt: live.observedAt!, airborne: 1 }]);
    assert.equal(database.read('demo')!.stats.airborne, 0);
    assert.deepEqual(database.history('demo').map(point => point.airborne), [1, 0]);
  } finally {
    database?.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test('SQLite rolls back an invalid replacement instead of losing the saved snapshot', () => {
  const database = new FlightDatabase(':memory:');
  try {
    const saved = snapshot('live');
    database.save(saved);
    const duplicate = { ...saved, flights: [saved.flights[0], saved.flights[0]] };
    assert.throws(() => database.save(duplicate));
    assert.deepEqual(database.read('live'), saved);
    assert.deepEqual(database.history('live'), [{ observedAt: saved.observedAt!, airborne: 1 }]);
  } finally { database.close(); }
});

test('concurrent dashboard and detail requests share one fetch and honor the polling cache', async () => {
  const database = new FlightDatabase(':memory:');
  let now = NOW;
  let calls = 0;
  let release!: (value: Observation) => void;
  const pending = new Promise<Observation>(resolve => { release = resolve; });
  const provider: FlightProvider = { fetchObservation: async () => {
    calls += 1;
    return calls === 1 ? pending : observation([vector('abc123')], Math.floor(now / 1000));
  } };
  const service = new FlightService(database, { provider, now: () => now, pollIntervalSeconds: 60 });
  try {
    const requests = [service.dashboard('live'), service.dashboard('live'), service.detail('live', 'abc123')];
    assert.equal(calls, 1);
    release(observation());
    const [first, second, detail] = await Promise.all(requests);
    assert.equal(first?.mode, 'live');
    assert.equal(second?.mode, 'live');
    assert.ok(detail && 'flight' in detail);
    await service.dashboard('live');
    now += 59000;
    await service.dashboard('live');
    assert.equal(calls, 1);
    now += 1000;
    assert.equal((await service.dashboard('live')).status, 'live');
    assert.equal(calls, 2);
    assert.equal(database.history('live').length, 2);
  } finally { database.close(); }
});

test('a provider failure returns the last persisted live snapshot as stale and observes retry backoff', async () => {
  const database = new FlightDatabase(':memory:');
  const saved = snapshot('live');
  database.save(saved);
  let now = NOW + 60000;
  let calls = 0;
  const provider: FlightProvider = { fetchObservation: async () => {
    calls += 1;
    throw new ProviderError('Test provider unavailable', 180);
  } };
  const service = new FlightService(database, { provider, now: () => now, pollIntervalSeconds: 60 });
  try {
    const result = await service.dashboard('live');
    assert.equal(result.status, 'stale');
    assert.equal(result.message, 'Test provider unavailable');
    assert.equal(result.fetchedAt, saved.fetchedAt);
    assert.equal(result.stats.airborne, 1);
    assert.deepEqual(result.flights, saved.flights);
    assert.equal(result.nextRefreshAt, new Date(now + 180000).toISOString());
    assert.deepEqual(database.read('live'), saved);
    now += 179000;
    await service.dashboard('live');
    assert.equal(calls, 1);
    now += 1000;
    await service.dashboard('live');
    assert.equal(calls, 2);
  } finally { database.close(); }
});

test('a missing live snapshot is unavailable on failure and never substitutes demo aircraft', async () => {
  const database = new FlightDatabase(':memory:');
  const service = new FlightService(database, {
    now: () => NOW, pollIntervalSeconds: 60,
    provider: { fetchObservation: async () => { throw new ProviderError('Offline'); } },
  });
  try {
    const demo = await service.dashboard('demo');
    assert.ok(demo.flights.length > 0);
    const live = await service.dashboard('live');
    assert.equal(live.status, 'unavailable');
    assert.deepEqual(live.flights, []);
    assert.equal(live.stats.airborne, 0);
    assert.equal(live.fetchedAt, null);
    assert.deepEqual(live.history, []);
    assert.equal(database.read('live'), null);
  } finally { database.close(); }
});

test('restarting the service reuses the persisted polling deadline instead of fetching immediately', async () => {
  const database = new FlightDatabase(':memory:');
  let now = NOW + 10000;
  let calls = 0;
  database.save(snapshot('live'));
  const service = new FlightService(database, {
    now: () => now, pollIntervalSeconds: 60,
    provider: { fetchObservation: async () => {
      calls += 1;
      return observation([], Math.floor(now / 1000));
    } },
  });
  try {
    const persisted = await service.dashboard('live');
    assert.equal(persisted.status, 'stale');
    assert.equal(persisted.stats.airborne, 1);
    assert.equal(persisted.nextRefreshAt, new Date(NOW + 60000).toISOString());
    assert.equal(calls, 0);
    now = NOW + 60000;
    const updated = await service.dashboard('live');
    assert.equal(calls, 1);
    assert.equal(updated.status, 'live');
    assert.equal(updated.stats.airborne, 0);
  } finally { database.close(); }
});

test('a successful observation becomes stale after 120 seconds while still respecting a longer API polling interval', async () => {
  const database = new FlightDatabase(':memory:');
  let now = NOW;
  let calls = 0;
  const service = new FlightService(database, {
    now: () => now, pollIntervalSeconds: 900,
    provider: { fetchObservation: async () => { calls += 1; return observation(); } },
  });
  try {
    const current = await service.dashboard('live');
    assert.equal(current.status, 'live');
    now += 120000;
    assert.equal((await service.dashboard('live')).status, 'live');
    now += 1000;
    const aged = await service.dashboard('live');
    assert.equal(aged.status, 'stale');
    assert.ok(aged.message);
    assert.equal(aged.fetchedAt, current.fetchedAt);
    assert.deepEqual(aged.flights, current.flights);
    assert.equal(aged.nextRefreshAt, new Date(NOW + 900000).toISOString());
    assert.equal(service.health().live.status, 'stale');
    assert.equal(calls, 1);
  } finally { database.close(); }
});

test('outdated upstream observation timestamps cannot overwrite a good stored snapshot', async () => {
  const database = new FlightDatabase(':memory:');
  const saved = snapshot('live');
  database.save(saved);
  const service = new FlightService(database, {
    now: () => NOW + 121000, pollIntervalSeconds: 60,
    provider: { fetchObservation: async () => observation([]) },
  });
  try {
    const result = await service.dashboard('live');
    assert.equal(result.status, 'stale');
    assert.equal(result.stats.airborne, 1);
    assert.match(result.message!, /観測時刻/);
    assert.deepEqual(database.read('live'), saved);
  } finally { database.close(); }
});

test('API health, demo dashboard and details work locally with validation and without live requests', async () => {
  const database = new FlightDatabase(':memory:');
  let liveCalls = 0;
  const service = new FlightService(database, {
    now: () => NOW, pollIntervalSeconds: 60,
    provider: { fetchObservation: async () => { liveCalls += 1; throw new Error('Unexpected live request'); } },
  });
  const server = createApp({ service, staticDirectory: '/tmp/flight-monitor-missing-dist' }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    const health = await fetch(`${base}/api/health`);
    assert.equal(health.status, 200);
    assert.equal(health.headers.get('cache-control'), 'no-store');
    assert.equal(health.headers.get('x-powered-by'), null);
    assert.equal((await health.json() as { database: string }).database, 'ready');

    const response = await fetch(`${base}/api/dashboard?mode=demo`);
    assert.equal(response.status, 200);
    const dashboard = await response.json() as DashboardResponse;
    assert.equal(dashboard.mode, 'demo');
    assert.equal(dashboard.status, 'demo');
    assert.ok(dashboard.stats.airborne > 0);
    const selected = dashboard.flights[0];
    const detailResponse = await fetch(`${base}/api/flights/${selected.icao24.toUpperCase()}?mode=demo`);
    assert.equal(detailResponse.status, 200);
    const detail = await detailResponse.json() as FlightDetailResponse;
    assert.equal(detail.mode, 'demo');
    assert.deepEqual(detail.flight, selected);

    for (const path of ['/api/dashboard?mode=bad', '/api/dashboard?mode=demo&mode=live',
      '/api/flights/not-an-icao?mode=demo', '/api/flights/abc123?mode=bad']) {
      assert.equal((await fetch(`${base}${path}`)).status, 400, path);
    }
    assert.equal((await fetch(`${base}/api/flights/ffffff?mode=demo`)).status, 404);
    assert.equal((await fetch(`${base}/api/not-found`)).status, 404);
    assert.equal(liveCalls, 0);
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    database.close();
  }
});

test('OpenSky rate-limit response headers impose a cooldown before another upstream request', async t => {
  for (const [header, value, delay] of [
    ['x-rate-limit-retry-after-seconds', '120', 120],
    ['retry-after', '180', 180],
    ['retry-after', new Date(NOW + 240000).toUTCString(), 240],
  ] as const) {
    await t.test(header + ': ' + value, async () => {
      let now = NOW;
      let calls = 0;
      const fetcher: typeof fetch = async () => {
        calls += 1;
        return calls === 1
          ? new Response('', { status: 429, headers: { [header]: value } })
          : Response.json({ time: Math.floor(now / 1000), states: [] });
      };
      const provider = new OpenSkyProvider({ fetch: fetcher, now: () => now, clientId: '', clientSecret: '' });
      await assert.rejects(provider.fetchObservation(), (error: unknown) =>
        error instanceof ProviderError && error.retryAfterSeconds === delay);
      now += 10000;
      await assert.rejects(provider.fetchObservation(), (error: unknown) =>
        error instanceof ProviderError && error.retryAfterSeconds === delay - 10);
      assert.equal(calls, 1);
      now += (delay - 10) * 1000;
      const result = await provider.fetchObservation();
      assert.equal(result.stats.airborne, 0);
      assert.equal(calls, 2);
    });
  }
});

test('OAuth credentials use the token endpoint and cache an expiring token without exposing it in responses', async () => {
  let now = NOW;
  let tokenCalls = 0;
  let stateCalls = 0;
  const fetcher: typeof fetch = async (input, init) => {
    if (String(input).includes('/token')) {
      tokenCalls += 1;
      assert.equal(init?.method, 'POST');
      const body = init?.body as URLSearchParams;
      assert.equal(body.get('grant_type'), 'client_credentials');
      assert.equal(body.get('client_id'), 'fake-client');
      return Response.json({ access_token: `fake-token-${tokenCalls}`, expires_in: 300 });
    }
    stateCalls += 1;
    assert.equal(new Headers(init?.headers).get('authorization'), `Bearer fake-token-${tokenCalls}`);
    return Response.json({ time: Math.floor(now / 1000), states: [] });
  };
  const provider = new OpenSkyProvider({ fetch: fetcher, now: () => now,
    clientId: 'fake-client', clientSecret: 'fake-secret' });
  await provider.fetchObservation();
  now += 60000;
  await provider.fetchObservation();
  assert.equal(tokenCalls, 1);
  now += 240000;
  const result = await provider.fetchObservation();
  assert.equal(tokenCalls, 2);
  assert.equal(stateCalls, 3);
  assert.equal(JSON.stringify(result).includes('fake-token'), false);
});

test('an OAuth 401 refreshes the rejected token once, with bounded retries for permanent rejection', async t => {
  for (const permanentRejection of [false, true]) {
    await t.test(permanentRejection ? 'permanently rejected' : 'success after token refresh', async () => {
      let tokenCalls = 0;
      let stateCalls = 0;
      const fetcher: typeof fetch = async (input, init) => {
        if (String(input).includes('/token')) {
          tokenCalls += 1;
          return Response.json({ access_token: `fake-refreshed-token-${tokenCalls}`, expires_in: 300 });
        }
        stateCalls += 1;
        assert.equal(new Headers(init?.headers).get('authorization'), `Bearer fake-refreshed-token-${tokenCalls}`);
        return permanentRejection || stateCalls === 1
          ? new Response('', { status: 401 })
          : Response.json({ time: EPOCH, states: [] });
      };
      const provider = new OpenSkyProvider({ fetch: fetcher, now: () => NOW,
        clientId: 'fake-client', clientSecret: 'fake-secret' });
      if (permanentRejection) {
        await assert.rejects(provider.fetchObservation(), (error: unknown) =>
          error instanceof ProviderError && error.retryAfterSeconds === 300);
      } else {
        assert.equal((await provider.fetchObservation()).stats.airborne, 0);
      }
      assert.equal(tokenCalls, 2);
      assert.equal(stateCalls, 2);
    });
  }
});
