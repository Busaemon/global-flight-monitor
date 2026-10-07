import { expect, test, type Page, type Route } from '@playwright/test';
import type { DashboardResponse, DataMode, Flight } from '../../shared/types';

const observedAt = '2026-10-07T01:02:03.000Z';
const fetchedAt = '2026-10-07T02:03:04.000Z';
const browserErrors = new WeakMap<Page, string[]>();

function makeFlight(icao24: string, callsign: string, originCountry: string, latitude: number, longitude: number, timestamp: string): Flight {
  return {
    icao24, callsign, originCountry, latitude, longitude,
    altitudeMeters: 11_000, velocityMps: 250, headingDegrees: 90,
    verticalRateMps: 0, onGround: false, lastContact: timestamp,
    positionUpdatedAt: timestamp, positionSource: 'ADS-B',
  };
}

function snapshot(mode: DataMode, status: DashboardResponse['status'] = mode === 'demo' ? 'demo' : 'live', timestamp?: string): DashboardResponse {
  const prefix = mode === 'live' ? 'LIVE' : '';
  const observationTime = status === 'stale' ? observedAt : timestamp ?? new Date().toISOString();
  return {
    mode, status, source: mode === 'live' ? 'OpenSky Network' : 'シミュレーションデータ',
    coverageNote: '観測範囲の機体数であり、世界のすべての航空機を網羅しません。',
    observedAt: observationTime, fetchedAt: status === 'stale' ? fetchedAt : observationTime,
    nextRefreshAt: null, pollIntervalSeconds: 60,
    stats: { airborne: 3, totalObserved: 3, withPosition: 3, countries: 3, avgAltitudeMeters: 11_000, avgVelocityMps: 250 },
    flights: [
      makeFlight('aaa111', `${prefix}ANA101`, 'Japan', 36, 138, observationTime),
      makeFlight('bbb222', `${prefix}AFR202`, 'France', 48, 2, observationTime),
      makeFlight('ccc333', `${prefix}UAL303`, 'United States', 39, -98, observationTime),
    ],
    history: [
      { observedAt: new Date(Date.parse(observationTime) - 60_000).toISOString(), airborne: 2 },
      { observedAt: observationTime, airborne: 3 },
    ],
    message: status === 'stale' ? 'データ提供元の更新が遅れています。' : null,
  };
}

function unavailable(): DashboardResponse {
  return {
    ...snapshot('live', 'unavailable'), observedAt: null, fetchedAt: null,
    stats: { airborne: 0, totalObserved: 0, withPosition: 0, countries: 0, avgAltitudeMeters: null, avgVelocityMps: null },
    flights: [], history: [], message: 'データ提供元に接続できませんでした。',
  };
}

async function useMode(page: Page, mode: DataMode) {
  await page.addInitScript(value => localStorage.setItem('skytrace-mode', value), mode);
}

async function mockDashboard(page: Page, live = snapshot('live'), demo = snapshot('demo')) {
  await page.route('**/api/dashboard?mode=*', route => {
    const mode = new URL(route.request().url()).searchParams.get('mode');
    return route.fulfill({ json: mode === 'demo' ? demo : live });
  });
}

const summary = (page: Page) => page.locator('.primary-stat .stat-number');
const inspector = (page: Page) => page.getByRole('complementary', { name: 'フライト詳細' });
const list = (page: Page) => page.getByRole('region', { name: 'フライト一覧', exact: true });

test.beforeEach(async ({ page }) => {
  const errors: string[] = [];
  browserErrors.set(page, errors);
  page.on('pageerror', error => errors.push(error.message));
  // Browser tests use local tile fixtures and do not contact an external map service.
  await page.route('https://basemaps.cartocdn.com/**', route => route.fulfill({
    contentType: 'image/png',
    body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j3ioAAAAASUVORK5CYII=', 'base64'),
  }));
});

test.afterEach(async ({ page }) => {
  expect(browserErrors.get(page), 'the application should not throw browser errors').toEqual([]);
});

test('real demo API renders the same aircraft count and supports detail selection', async ({ page }) => {
  await useMode(page, 'live');
  await page.route('**/api/dashboard?mode=live', route => route.fulfill({ json: unavailable() }));
  await page.goto('/');
  const responsePromise = page.waitForResponse(response => response.url().includes('/api/dashboard?mode=demo') && response.ok());
  await page.getByRole('button', { name: 'デモを体験', exact: true }).click();
  const response = await responsePromise;
  const data = await response.json() as DashboardResponse;
  expect(data.mode).toBe('demo');
  expect(data.status).toBe('demo');
  expect(data.flights.length).toBeGreaterThan(0);
  await expect(summary(page)).toHaveText(`${new Intl.NumberFormat('ja-JP').format(data.stats.airborne)}機`);
  await expect(page.locator('.demo-banner')).toContainText('実際の航空状況ではありません');
  const firstRow = list(page).getByRole('button', { name: /の詳細を表示$/ }).first();
  const callsign = (await firstRow.getAttribute('aria-label'))!.replace(' の詳細を表示', '');
  await firstRow.click();
  await expect(inspector(page).getByRole('heading', { name: callsign, exact: true })).toBeVisible();
  await expect(inspector(page)).toContainText('DEMO · サンプルフライト');
});

test('map and list selection show aircraft details; search covers callsign, ICAO and country', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await useMode(page, 'demo');
  await mockDashboard(page);
  await page.goto('/');
  await expect(summary(page)).toHaveText('3機');
  await page.getByTitle('AFR202 · France', { exact: true }).click();
  await expect(inspector(page).getByRole('heading', { name: 'AFR202', exact: true })).toBeVisible();
  await expect(inspector(page)).toContainText('BBB222');
  await expect(inspector(page)).toContainText('11,000');
  await expect(inspector(page)).toContainText('900');
  await page.getByRole('button', { name: '地図で位置を確認' }).click();
  await page.getByRole('button', { name: 'フライト詳細を閉じる' }).click();
  await expect(inspector(page)).toContainText('フライトを選択してください。');

  const search = page.getByRole('textbox', { name: 'フライトを検索' });
  for (const [query, callsign] of [['ana', 'ANA101'], ['BBB222', 'AFR202'], ['united states', 'UAL303']]) {
    await search.fill(query);
    await expect(list(page).locator('tbody tr')).toHaveCount(1);
    await list(page).getByRole('button', { name: `${callsign} の詳細を表示`, exact: true }).click();
    await expect(inspector(page).getByRole('heading', { name: callsign, exact: true })).toBeVisible();
  }
  await search.fill('ZZZ-no-such-aircraft');
  await expect(list(page).locator('tbody tr')).toHaveCount(0);
  await expect(list(page)).toContainText('一致するフライトがありません');
  await expect(page.locator('.map-message')).toContainText('一致する機体がありません');
  await page.getByRole('button', { name: '検索をクリア' }).click();
  await expect(list(page).locator('tbody tr')).toHaveCount(3);
});

test('390px mobile layout stays within the page width and supports search and details', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await useMode(page, 'demo');
  await mockDashboard(page);
  await page.goto('/');
  await expect(summary(page)).toHaveText('3機');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.getByRole('textbox', { name: 'フライトを検索' }).fill('Japan');
  await list(page).getByRole('button', { name: 'ANA101 の詳細を表示', exact: true }).click();
  await expect(inspector(page).getByRole('heading', { name: 'ANA101', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.getByRole('button', { name: 'フライト詳細を閉じる' }).click();
  await expect(inspector(page)).toContainText('フライトを選択してください。');
});

test('unavailable live data shows an unknown count and requires explicit demo selection', async ({ page }) => {
  await useMode(page, 'live');
  await mockDashboard(page, unavailable());
  await page.goto('/');
  await expect(page.locator('.error-banner')).toContainText('ライブデータを取得できませんでした');
  await expect(summary(page)).toHaveText('—機');
  await expect(page.locator('.demo-banner')).toHaveCount(0);
  await expect(list(page).locator('tbody tr')).toHaveCount(0);
  await page.getByRole('button', { name: 'デモを体験', exact: true }).click();
  await expect(page.getByRole('button', { name: 'デモ', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(summary(page)).toHaveText('3機');
  await expect(page.locator('.demo-banner')).toBeVisible();
  await expect(page.locator('.stat-caption').first()).toHaveText('サンプルの飛行中機数');
  await page.getByRole('button', { name: 'ライブ', exact: true }).click();
  await expect(page.locator('.error-banner')).toBeVisible();
  await expect(summary(page)).toHaveText('—機');
  await expect(page.locator('.demo-banner')).toHaveCount(0);
  await expect(list(page).locator('tbody tr')).toHaveCount(0);
});

test('rapid mode switching cannot display delayed responses under the wrong mode', async ({ page }) => {
  await useMode(page, 'live');
  const pending: Promise<void>[] = [];
  await page.route('**/api/dashboard?mode=*', route => {
    const mode = new URL(route.request().url()).searchParams.get('mode') as DataMode;
    const work = (async () => {
      await new Promise(resolve => setTimeout(resolve, mode === 'live' ? 350 : 200));
      await route.fulfill({ json: snapshot(mode) }).catch(() => undefined);
    })();
    pending.push(work);
    return work;
  });
  await page.goto('/');
  await expect(list(page).getByRole('button', { name: 'LIVEANA101 の詳細を表示', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'デモ', exact: true }).click();
  await expect(list(page).getByRole('button', { name: /LIVE.*の詳細を表示/ })).toHaveCount(0);
  await page.getByRole('button', { name: 'ライブ', exact: true }).click();
  await page.getByRole('button', { name: 'デモ', exact: true }).click();
  await expect(list(page).getByRole('button', { name: 'ANA101 の詳細を表示', exact: true })).toBeVisible();
  await Promise.all(pending);
  await expect(page.getByRole('button', { name: 'デモ', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.connection-status')).toHaveText('デモデータ');
  await expect(page.locator('.demo-banner')).toBeVisible();
  await expect(list(page).getByRole('button', { name: /LIVE.*の詳細を表示/ })).toHaveCount(0);
  await expect(page.locator('.detail-note')).toHaveCount(0);
});

test('stale live observations retain their observation time separately from fetch time', async ({ page }) => {
  await useMode(page, 'live');
  await mockDashboard(page, snapshot('live', 'stale'));
  await page.goto('/');
  await expect(page.locator('.connection-status')).toHaveText('最終取得データ');
  await expect(page.locator('.stale-banner')).toContainText('01:02:03 UTC の観測データ');
  await expect(page.locator('.map-bottom')).toContainText('観測時刻 01:02:03 UTC');
  await expect(page.locator('.map-bottom')).toContainText('取得 02:03:04 UTC');
  await expect(summary(page)).toHaveText('3機');
  await expect(page.locator('.demo-banner')).toHaveCount(0);
});

test('a live observation expires locally while the next API request is still pending', async ({ page }) => {
  const startingTime = new Date('2026-10-07T03:00:00.000Z');
  await page.clock.setFixedTime(startingTime);
  await useMode(page, 'live');
  const data = snapshot('live', 'live', startingTime.toISOString());
  let holdNextRequest = false;
  let heldRequest: Route | undefined;
  await page.route('**/api/dashboard?mode=live', route => {
    if (!holdNextRequest) return route.fulfill({ json: data });
    // A pending request must not keep an old observation labeled as live.
    heldRequest = route;
  });
  await page.goto('/');
  await expect(page.locator('.connection-status')).toHaveText('ライブ受信中');
  await expect(summary(page)).toHaveText('3機');
  holdNextRequest = true;
  await page.getByRole('button', { name: 'データを更新', exact: true }).click();
  await expect.poll(() => heldRequest !== undefined).toBe(true);
  await page.clock.setFixedTime(new Date(startingTime.getTime() + 121_000));
  await expect(page.locator('.connection-status')).toHaveText('最終取得データ');
  await expect(page.locator('.stale-banner')).toContainText('03:00:00 UTC の観測データ');
  await expect(page.locator('.stale-banner')).not.toContainText('タイムアウト');
  await expect(summary(page)).toHaveText('3機');
  await expect(page.getByRole('button', { name: 'ライブ', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(list(page).getByRole('button', { name: 'LIVEANA101 の詳細を表示', exact: true })).toBeVisible();
  await expect(page.locator('.demo-banner')).toHaveCount(0);
  await heldRequest?.abort().catch(() => undefined);
});

for (const mode of ['live', 'demo'] as const) {
  test(`${mode} mode retains its own last observation when the API disconnects`, async ({ page }) => {
    await useMode(page, mode);
    let fail = false;
    const data = snapshot(mode);
    await page.route('**/api/dashboard?mode=*', route => fail
      ? route.abort('failed')
      : route.fulfill({ json: data }));
    await page.goto('/');
    await expect(summary(page)).toHaveText('3機');
    fail = true;
    await page.getByRole('button', { name: 'データを更新', exact: true }).click();
    await expect(page.locator('.connection-status')).toHaveText('最終取得データ');
    await expect(page.locator('.stale-banner')).toContainText(`${data.observedAt!.slice(11, 19)} UTC の観測データ`);
    await expect(summary(page)).toHaveText('3機');
    await expect(page.getByRole('button', { name: mode === 'live' ? 'ライブ' : 'デモ', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(list(page).getByRole('button', { name: `${mode === 'live' ? 'LIVE' : ''}ANA101 の詳細を表示`, exact: true })).toBeVisible();
    await expect(page.locator('.demo-banner')).toHaveCount(mode === 'demo' ? 1 : 0);
  });
}
