import { expect, type Page, type Route } from '@playwright/test';
import type { DashboardResponse, DashboardSummaryResponse, DataMode, Flight, FlightListResponse, FlightMapResponse, MapFlight } from '../../shared/types';

export function makeFlight(icao24: string, callsign: string, originCountry: string, latitude: number, longitude: number, timestamp: string): Flight {
  return { icao24, callsign, originCountry, latitude, longitude, altitudeMeters: 11_000, velocityMps: 250, headingDegrees: 90, verticalRateMps: 0, onGround: false, lastContact: timestamp, positionUpdatedAt: timestamp, positionSource: 'ADS-B' };
}

export function snapshot(mode: DataMode, status: DashboardResponse['status'] = mode === 'demo' ? 'demo' : 'live', timestamp?: string): DashboardResponse {
  const prefix = mode === 'live' ? 'LIVE' : '';
  const observationTime = status === 'stale' ? '2026-10-07T01:02:03.000Z' : timestamp ?? new Date().toISOString();
  return {
    mode, status, source: mode === 'live' ? 'OpenSky Network' : 'シミュレーションデータ',
    coverageNote: '観測範囲の機体数であり、世界のすべての航空機を網羅しません。',
    observedAt: observationTime, fetchedAt: status === 'stale' ? '2026-10-07T02:03:04.000Z' : observationTime,
    nextRefreshAt: null, pollIntervalSeconds: 60,
    stats: { airborne: 3, totalObserved: 3, withPosition: 3, countries: 3, avgAltitudeMeters: 11_000, avgVelocityMps: 250 },
    flights: [
      makeFlight('aaa111', `${prefix}ANA101`, 'Japan', 36, 138, observationTime),
      makeFlight('bbb222', `${prefix}AFR202`, 'France', 48, 2, observationTime),
      makeFlight('ccc333', `${prefix}UAL303`, 'United States', 39, -98, observationTime),
    ],
    history: [{ observedAt: new Date(Date.parse(observationTime) - 60_000).toISOString(), airborne: 2 }, { observedAt: observationTime, airborne: 3 }],
    message: status === 'stale' ? 'データ提供元の更新が遅れています。' : null,
  };
}

export function unavailable(): DashboardResponse {
  return { ...snapshot('live', 'unavailable'), observedAt: null, fetchedAt: null, stats: { airborne: 0, totalObserved: 0, withPosition: 0, countries: 0, avgAltitudeMeters: null, avgVelocityMps: null }, flights: [], history: [], message: 'データ提供元に接続できませんでした。' };
}

export function summaryResponse(data: DashboardResponse): DashboardSummaryResponse {
  const { flights: _flights, ...summary } = data;
  return summary;
}

export const summary = (page: Page) => page.locator('.primary-stat .stat-number');
export const inspector = (page: Page) => page.getByRole('complementary', { name: 'フライト詳細' });
export const list = (page: Page) => page.getByRole('region', { name: 'フライト一覧', exact: true });

type Endpoint = 'summary' | 'list' | 'map' | 'detail' | 'legacy';
export interface ApiRequest { endpoint: Endpoint; mode: DataMode; url: URL; returnedFlights: number; responseBytes: number }
interface MockOptions {
  live?: DashboardResponse;
  demo?: DashboardResponse;
  /** Return true when an override handled the request; false uses the fixture. */
  intercept?: (route: Route, endpoint: Endpoint, mode: DataMode) => boolean | Promise<boolean>;
}

/** Emulates server filtering, pagination and sampling without sending the full snapshot. */
export async function mockFlightApi(page: Page, options: MockOptions = {}) {
  const live = options.live ?? snapshot('live');
  const demo = options.demo ?? snapshot('demo');
  const requests: ApiRequest[] = [];
  await page.route('**/api/**', async route => {
    const url = new URL(route.request().url());
    const mode = url.searchParams.get('mode') === 'demo' ? 'demo' : 'live';
    const endpoint: Endpoint | null = url.pathname === '/api/summary' ? 'summary' : url.pathname === '/api/flights' ? 'list' : url.pathname === '/api/map' ? 'map' : /^\/api\/flights\/[a-f\d]{6}$/i.test(url.pathname) ? 'detail' : url.pathname === '/api/dashboard' ? 'legacy' : null;
    if (!endpoint) return route.continue();
    const request: ApiRequest = { endpoint, mode, url, returnedFlights: 0, responseBytes: 0 };
    requests.push(request);
    if (options.intercept && await options.intercept(route, endpoint, mode)) return;
    if (endpoint === 'legacy') return route.fulfill({ status: 410, json: { error: 'Use the bounded APIs.' } });
    const data = mode === 'demo' ? demo : live;
    let body: unknown;
    if (endpoint === 'summary') body = summaryResponse(data);
    else if (endpoint === 'detail') {
      const flight = data.flights.find(item => item.icao24 === url.pathname.split('/').at(-1));
      if (!flight) return route.fulfill({ status: 404, json: { error: 'フライトが見つかりません。' } });
      body = { flight, mode, source: data.source, observedAt: data.observedAt, fetchedAt: data.fetchedAt };
    } else {
      const query = (url.searchParams.get('q') ?? '').trim().toLowerCase();
      const filtered = data.flights.filter(flight => !query || `${flight.callsign} ${flight.icao24} ${flight.originCountry}`.toLowerCase().includes(query));
      const limit = Math.max(1, Number(url.searchParams.get('limit')) || (endpoint === 'list' ? 8 : 600));
      if (endpoint === 'list') {
        const sort = url.searchParams.get('sort');
        filtered.sort((a, b) => sort === 'altitude' ? (b.altitudeMeters ?? -1) - (a.altitudeMeters ?? -1) : sort === 'speed' ? (b.velocityMps ?? -1) - (a.velocityMps ?? -1) : (a.callsign || a.icao24).localeCompare(b.callsign || b.icao24));
        const pageNumber = Math.max(1, Number(url.searchParams.get('page')) || 1);
        const flights = filtered.slice((pageNumber - 1) * limit, pageNumber * limit);
        const listData: FlightListResponse = { mode, source: data.source, observedAt: data.observedAt, fetchedAt: data.fetchedAt, flights, total: filtered.length, page: pageNumber, pageSize: limit, pageCount: Math.max(1, Math.ceil(filtered.length / limit)) };
        body = listData;
        request.returnedFlights = flights.length;
      } else {
        const bounds = url.searchParams.get('bounds')?.split(',').map(Number);
        const candidates = filtered.filter(flight => {
          if (flight.latitude === null || flight.longitude === null) return false;
          if (!bounds || bounds.length !== 4 || !bounds.every(Number.isFinite)) return true;
          const [west, south, east, north] = bounds;
          return flight.latitude >= south && flight.latitude <= north && (west <= east ? flight.longitude >= west && flight.longitude <= east : flight.longitude >= west || flight.longitude <= east);
        });
        const stride = Math.max(1, candidates.length / limit);
        const flights: MapFlight[] = Array.from({ length: Math.min(limit, candidates.length) }, (_, index) => {
          const flight = candidates[Math.floor(index * stride)];
          return { icao24: flight.icao24, callsign: flight.callsign, originCountry: flight.originCountry, latitude: flight.latitude!, longitude: flight.longitude!, headingDegrees: flight.headingDegrees };
        });
        const selected = candidates.find(flight => flight.icao24 === url.searchParams.get('selected'));
        if (selected && !flights.some(flight => flight.icao24 === selected.icao24)) flights[0] = { icao24: selected.icao24, callsign: selected.callsign, originCountry: selected.originCountry, latitude: selected.latitude!, longitude: selected.longitude!, headingDegrees: selected.headingDegrees };
        const mapData: FlightMapResponse = { mode, observedAt: data.observedAt, fetchedAt: data.fetchedAt, flights, total: candidates.length, sampled: candidates.length > limit };
        body = mapData;
        request.returnedFlights = flights.length;
      }
    }
    const serialized = JSON.stringify(body);
    request.responseBytes = Buffer.byteLength(serialized);
    return route.fulfill({ contentType: 'application/json', body: serialized }).catch(() => undefined);
  });
  return { requests, live, demo };
}

export async function localMapTiles(page: Page) {
  // Transparent tiles keep the bundled land visible without contacting external services.
  await page.route('https://tile.openstreetmap.org/**', route => route.fulfill({
    contentType: 'image/svg+xml',
    body: '<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"/>',
  }));
}

export async function assertNoHorizontalOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
}

/** Hit the canvas renderer using the geographic bounds requested for the current map. */
export async function selectMapPosition(page: Page, requests: ApiRequest[], latitude: number, longitude: number) {
  await expect(page.locator('.flight-map canvas')).toBeVisible();
  await expect.poll(() => requests.filter(request => request.endpoint === 'map').at(-1)?.url.searchParams.get('bounds')).not.toBe('-180.0000,-90.0000,180.0000,90.0000');
  const bounds = requests.filter(request => request.endpoint === 'map').at(-1)!.url.searchParams.get('bounds')!.split(',').map(Number);
  const [west, south, east, north] = bounds;
  const rectangle = (await page.locator('.flight-map').boundingBox())!;
  const mercator = (degrees: number) => Math.log(Math.tan(Math.PI / 4 + degrees * Math.PI / 360));
  const span = east >= west ? east - west : east + 360 - west;
  const wrappedLongitude = longitude < west ? longitude + 360 : longitude;
  await page.locator('.flight-map').click({ position: {
    x: (wrappedLongitude - west) / span * rectangle.width,
    y: (mercator(north) - mercator(latitude)) / (mercator(north) - mercator(south)) * rectangle.height,
  } });
}
