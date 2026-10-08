import { expect, test, type Page, type Route } from '@playwright/test';
import { assertNoHorizontalOverflow, list, localMapTiles, mockFlightApi, snapshot, summary, unavailable, type ApiRequest } from './fixtures';

test.beforeEach(async ({ page }) => {
  page.on('pageerror', error => { throw error; });
  await localMapTiles(page);
});

async function assertUsableBaseMap(page: Page) {
  // The map loads when it enters the viewport on a small screen.
  await page.locator('.map-host').scrollIntoViewIfNeeded();
  const map = page.locator('.flight-map');
  await expect(map).toBeVisible();
  await map.scrollIntoViewIfNeeded();
  await expect(map.locator('.leaflet-offline-land-pane svg')).toBeVisible();
  expect(await map.locator('.leaflet-offline-land-pane path').count()).toBeGreaterThan(100);
  const message = page.locator('.map-message');
  await expect(message).toBeVisible();
  const mapBounds = (await map.boundingBox())!;
  const messageBounds = (await message.boundingBox())!;
  expect(messageBounds.width * messageBounds.height / (mapBounds.width * mapBounds.height),
    'position guidance must leave at least half of the base map uncovered').toBeLessThan(.5);

  // Visibility alone does not catch a dark full-map status overlay. Hit-test the
  // lower part of the map, away from its title, and require most points to remain usable.
  await expect.poll(() => map.evaluate(element => {
    const bounds = element.getBoundingClientRect();
    return [.2, .5, .8].flatMap(x => [.45, .6, .75].map(y => {
      const target = document.elementFromPoint(bounds.left + bounds.width * x, bounds.top + bounds.height * y);
      return target?.closest('.flight-map') ? 1 : 0;
    })).reduce<number>((total, value) => total + value, 0);
  })).toBeGreaterThanOrEqual(5);
  await assertNoHorizontalOverflow(page);
}

async function zoomAndObserveNewBounds(page: Page, requests: ApiRequest[]) {
  await expect.poll(() => {
    const bounds = requests.filter(request => request.endpoint === 'map').at(-1)?.url.searchParams.get('bounds');
    return Boolean(bounds && bounds !== '-180.0000,-90.0000,180.0000,90.0000');
  }).toBe(true);
  const previousBounds = requests.filter(request => request.endpoint === 'map').at(-1)?.url.searchParams.get('bounds');
  expect(previousBounds).toBeTruthy();
  await page.getByRole('button', { name: '地図を拡大', exact: true }).click();
  await expect.poll(() => requests.filter(request => request.endpoint === 'map').at(-1)?.url.searchParams.get('bounds'))
    .not.toBe(previousBounds);
}

test('320px: pending aircraft positions leave the base map visible and zoomable', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 1000 });
  const held: Route[] = [];
  const api = await mockFlightApi(page, { intercept: (route, endpoint) => {
    if (endpoint !== 'map') return false;
    held.push(route);
    return true;
  } });
  try {
    await page.goto('/');
    await expect(summary(page)).toHaveText('3機');
    await assertUsableBaseMap(page);
    await expect(page.locator('.map-message')).toContainText('航空機の位置を取得しています');
    await expect(page.locator('.map-label strong')).toHaveText('— 位置未受信');
    await zoomAndObserveNewBounds(page, api.requests);
    await expect(page.locator('.map-message')).toContainText('航空機の位置を取得しています');
  } finally {
    await Promise.all(held.map(route => route.abort().catch(() => undefined)));
  }
});

test('390px: failed position and tile requests preserve the fallback map and allow retry', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 1000 });
  await page.route('https://tile.openstreetmap.org/**', route => route.abort('failed'));
  let failPositions = true;
  const api = await mockFlightApi(page, { intercept: async (route, endpoint) => {
    if (endpoint !== 'map' || !failPositions) return false;
    await route.fulfill({ status: 503, json: { error: 'Temporary provider error' } });
    return true;
  } });
  await page.goto('/');
  await assertUsableBaseMap(page);
  await expect(page.locator('.map-message')).toContainText('航空機の位置を取得できません');
  await expect(page.locator('.tile-error')).toContainText('簡易地図を表示しています');
  await zoomAndObserveNewBounds(page, api.requests);
  await expect(page.getByRole('button', { name: '航空機の位置を再取得', exact: true })).toBeVisible();
  const failedRequests = api.requests.filter(request => request.endpoint === 'map').length;
  failPositions = false;
  await page.getByRole('button', { name: '航空機の位置を再取得', exact: true }).click();
  await expect.poll(() => api.requests.filter(request => request.endpoint === 'map').length).toBeGreaterThan(failedRequests);
  await expect(page.locator('.map-message')).toHaveCount(0);
  await expect(page.locator('.map-label strong')).toHaveText(/\d+ 機を表示/);
  await expect(page.locator('.flight-map canvas')).toBeVisible();
  await assertNoHorizontalOverflow(page);
});

test('320px: an unreceived observation shows an unknown position count and keeps the map usable', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 1000 });
  const api = await mockFlightApi(page, { live: unavailable() });
  await page.goto('/');
  await expect(summary(page)).toHaveText('—機');
  await assertUsableBaseMap(page);
  await expect(page.locator('.map-message')).toContainText('航空機の位置は未受信です');
  await expect(page.locator('.map-label strong')).toHaveText('— 位置未受信');
  await expect(page.locator('.map-message')).not.toContainText('一致する機体がありません');
  await zoomAndObserveNewBounds(page, api.requests);
  await expect(page.locator('.map-label strong')).toHaveText('— 位置未受信');
});

test('390px: an observed empty map differs from an unknown count and supports search and zoom', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 1000 });
  const data = snapshot('live');
  data.flights = data.flights.map(flight => ({ ...flight, latitude: null, longitude: null }));
  data.stats.withPosition = 0;
  const api = await mockFlightApi(page, { live: data });
  await page.goto('/');
  await expect(summary(page)).toHaveText('3機');
  await assertUsableBaseMap(page);
  await expect(page.locator('.map-label strong')).toHaveText('0 機を表示');
  await expect(page.locator('.map-message')).toContainText('表示範囲に一致する機体がありません');
  await zoomAndObserveNewBounds(page, api.requests);
  await page.getByRole('textbox', { name: 'フライトを検索' }).fill('Japan');
  await expect(list(page).locator('tbody tr')).toHaveCount(1);
  await expect(summary(page)).toHaveText('3機');
  await expect(page.locator('.map-label strong')).toHaveText('0 機を表示');
  await assertNoHorizontalOverflow(page);
});
