import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Route } from '@playwright/test';
import { assertNoHorizontalOverflow, inspector, list, localMapTiles, makeFlight, mockFlightApi, snapshot, summary, summaryResponse, unavailable } from './fixtures';

test.beforeEach(async ({ page }) => {
  page.on('pageerror', error => { throw error; });
  await localMapTiles(page);
});

test('the normal URL defaults to live even when an old installation remembered demo', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('skytrace-mode', 'demo'));
  const api = await mockFlightApi(page);
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'ライブ', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(list(page).getByRole('button', { name: 'LIVEANA101 の詳細を表示', exact: true })).toBeVisible();
  await expect(page.locator('.demo-banner')).toHaveCount(0);
  expect(api.requests.every(request => request.mode === 'live')).toBe(true);
});

for (const viewport of [{ width: 1440, height: 1000, cap: 600 }, { width: 390, height: 844, cap: 200 }]) {
  test(`${viewport.width}px: 10,000 observed flights use bounded list and map requests`, async ({ page }) => {
    await page.setViewportSize(viewport);
    const data = snapshot('live');
    // All positions lie in the initial map view, so the map must sample rather than render all 10,000.
    data.flights = Array.from({ length: 10_000 }, (_, index) => makeFlight(
      index.toString(16).padStart(6, '0'), `FLT${index.toString().padStart(5, '0')}`,
      ['Japan', 'France', 'United States'][index % 3], 35 + (index % 40) * .05, 5 + (index % 50) * .05, data.observedAt!,
    ));
    data.stats = { ...data.stats, airborne: 10_000, totalObserved: 10_000, withPosition: 10_000 };
    data.history = [{ observedAt: data.observedAt!, airborne: 10_000 }];
    const api = await mockFlightApi(page, { live: data });
    await page.goto('/');
    await expect(summary(page)).toHaveText('10,000機');
    await expect(list(page).locator('tbody tr')).toHaveCount(8);
    await expect(page.locator('.map-label strong')).toHaveText(`${viewport.cap} 機を表示`);
    await expect(page.locator('.flight-map canvas')).toBeVisible();
    // Canvas rendering avoids creating one DOM element for each aircraft.
    expect(await page.locator('.aircraft-marker').count()).toBe(0);
    await assertNoHorizontalOverflow(page);
    expect(api.requests.filter(request => request.endpoint === 'legacy')).toEqual([]);
    const mapRequests = api.requests.filter(request => request.endpoint === 'map');
    expect(mapRequests.length).toBeGreaterThan(0);
    for (const request of mapRequests) {
      expect(Number(request.url.searchParams.get('limit'))).toBeLessThanOrEqual(viewport.cap);
      expect(request.returnedFlights).toBeLessThanOrEqual(viewport.cap);
      expect(request.responseBytes).toBeLessThan(120_000);
    }
    for (const request of api.requests.filter(item => item.endpoint === 'list')) {
      expect(Number(request.url.searchParams.get('limit'))).toBeLessThanOrEqual(8);
      expect(request.returnedFlights).toBeLessThanOrEqual(8);
    }
    expect(api.requests.find(request => request.endpoint === 'summary')!.responseBytes).toBeLessThan(10_000);
    await page.getByRole('button', { name: '次のページ' }).click();
    await expect(list(page).getByRole('button', { name: 'FLT00008 の詳細を表示', exact: true })).toBeVisible();
    expect(api.requests.some(request => request.endpoint === 'list' && request.url.searchParams.get('page') === '2')).toBe(true);
    // Find a flight absent from the initial list and sample, using the server search.
    await page.getByRole('textbox', { name: 'フライトを検索' }).fill('FLT09999');
    const row = list(page).getByRole('button', { name: 'FLT09999 の詳細を表示', exact: true });
    await expect(row).toBeVisible();
    await expect(list(page).locator('tbody tr')).toHaveCount(1);
    await row.click();
    await expect(inspector(page).getByRole('heading', { name: 'FLT09999', exact: true })).toBeVisible();
    expect(api.requests.some(request => request.endpoint === 'detail' && request.url.pathname === '/api/flights/00270f')).toBe(true);
    await expect(summary(page)).toHaveText('10,000機');
  });
}

test('keyboard selection, Escape and close return focus to the aircraft row', async ({ page }) => {
  await mockFlightApi(page);
  await page.goto('/?mode=demo');
  const row = list(page).getByRole('button', { name: 'ANA101 の詳細を表示', exact: true });
  await row.focus();
  await page.keyboard.press('Enter');
  await expect(inspector(page).getByRole('heading', { name: 'ANA101', exact: true })).toBeVisible();
  const close = page.getByRole('button', { name: 'フライト詳細を閉じる' });
  await close.focus();
  await page.keyboard.press('Escape');
  await expect(inspector(page)).toContainText('フライトを選択してください。');
  await expect(row).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(inspector(page).getByRole('heading', { name: 'ANA101', exact: true })).toBeVisible();
  await close.click();
  await expect(row).toBeFocused();
});

test('unchanged summaries reuse ETag responses without losing the observed count', async ({ page }) => {
  const data = snapshot('live');
  let conditionalRequests = 0;
  await mockFlightApi(page, { live: data, intercept: async (route, endpoint) => {
    if (endpoint !== 'summary') return false;
    if (route.request().headers()['if-none-match'] === '"summary-v1"') {
      conditionalRequests++;
      await route.fulfill({ status: 304, headers: { ETag: '"summary-v1"' } });
    } else await route.fulfill({ json: summaryResponse(data), headers: { ETag: '"summary-v1"' } });
    return true;
  } });
  await page.goto('/');
  await expect(summary(page)).toHaveText('3機');
  await expect(page.getByRole('button', { name: 'データを更新', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'データを更新', exact: true }).click();
  await expect.poll(() => conditionalRequests).toBe(1);
  await expect(summary(page)).toHaveText('3機');
  await expect(page.locator('.connection-status')).toHaveText('ライブ受信中');
  await expect(page.locator('.error-banner')).toHaveCount(0);
});

test('hidden pages pause polling and refresh when visible again', async ({ page }) => {
  await page.clock.install();
  const api = await mockFlightApi(page);
  await page.goto('/');
  await expect(summary(page)).toHaveText('3機');
  await expect(list(page).locator('tbody tr')).toHaveCount(3);
  await expect.poll(() => api.requests.some(request => request.endpoint === 'map')).toBe(true);
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  const countWhenHidden = api.requests.length;
  await page.clock.runFor(65_000);
  expect(api.requests.length).toBe(countWhenHidden);
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect.poll(() => api.requests.length).toBeGreaterThan(countWhenHidden);
});

test('a pending list request resumes after hide and show in the same event-loop turn', async ({ page }) => {
  let hold = true;
  let heldRequest: Route | undefined;
  let cancelledQueries = 0;
  page.on('requestfailed', request => {
    const url = new URL(request.url());
    if (url.pathname === '/api/flights' && url.searchParams.get('q') === 'Japan') cancelledQueries++;
  });
  const api = await mockFlightApi(page, { intercept: (route, endpoint) => {
    if (endpoint !== 'list' || new URL(route.request().url()).searchParams.get('q') !== 'Japan' || !hold) return false;
    heldRequest = route;
    return true;
  } });
  await page.goto('/');
  await expect(list(page).locator('tbody tr')).toHaveCount(3);
  await page.getByRole('textbox', { name: 'フライトを検索' }).fill('Japan');
  await expect.poll(() => heldRequest !== undefined).toBe(true);
  hold = false;
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    document.dispatchEvent(new Event('visibilitychange'));
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect(list(page).locator('tbody tr')).toHaveCount(1);
  await expect(list(page).getByRole('button', { name: 'LIVEANA101 の詳細を表示', exact: true })).toBeVisible();
  expect(api.requests.filter(request => request.endpoint === 'list' && request.url.searchParams.get('q') === 'Japan').length).toBeGreaterThanOrEqual(2);
  expect(cancelledQueries).toBeGreaterThan(0);
  await heldRequest?.abort().catch(() => undefined);
});

for (const scenario of [
  { label: 'desktop live', width: 1440, url: '/', unavailable: false, detail: false },
  { label: 'mobile demo detail', width: 390, url: '/?mode=demo', unavailable: false, detail: true },
  { label: 'live connection error', width: 390, url: '/', unavailable: true, detail: false },
]) {
  test(`${scenario.label} has no axe WCAG A/AA or best-practice violations`, async ({ page }) => {
    await page.setViewportSize({ width: scenario.width, height: 1000 });
    await mockFlightApi(page, scenario.unavailable ? { live: unavailable() } : {});
    await page.goto(scenario.url);
    await expect(summary(page)).toHaveText(scenario.unavailable ? '—機' : '3機');
    if (scenario.detail) {
      await list(page).getByRole('button', { name: 'ANA101 の詳細を表示', exact: true }).click();
      await expect(inspector(page).getByRole('heading', { name: 'ANA101', exact: true })).toBeVisible();
    }
    await assertNoHorizontalOverflow(page);
    const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa', 'best-practice']).analyze();
    expect(results.violations.map(violation => ({ id: violation.id, impact: violation.impact, nodes: violation.nodes.map(node => ({ target: node.target, summary: node.failureSummary })) }))).toEqual([]);
  });
}
