import { expect, test, type Page, type Route } from '@playwright/test';
import type { DashboardSummaryResponse, FlightListResponse } from '../../shared/types';
import { assertNoHorizontalOverflow, inspector, list, localMapTiles, mockFlightApi, selectMapPosition, snapshot, summary, summaryResponse, unavailable } from './fixtures';

const browserErrors = new WeakMap<Page, string[]>();

test.beforeEach(async ({ page }) => {
  const errors: string[] = [];
  browserErrors.set(page, errors);
  page.on('pageerror', error => errors.push(error.message));
  await localMapTiles(page);
});

test.afterEach(async ({ page }) => {
  expect(browserErrors.get(page), 'the application should not throw browser errors').toEqual([]);
});

test('real demo API renders the same aircraft count and supports independent detail selection', async ({ page }) => {
  await mockFlightApi(page, {
    live: unavailable(),
    intercept: async (route, _endpoint, mode) => {
      if (mode !== 'demo') return false;
      await route.continue();
      return true;
    },
  });
  await page.goto('/');
  const responsePromise = page.waitForResponse(response => response.url().includes('/api/summary?mode=demo') && response.ok());
  const listPromise = page.waitForResponse(response => new URL(response.url()).pathname === '/api/flights' && new URL(response.url()).searchParams.get('mode') === 'demo' && response.ok());
  await page.getByRole('button', { name: 'デモを体験', exact: true }).click();
  const data = await (await responsePromise).json() as DashboardSummaryResponse;
  const rows = await (await listPromise).json() as FlightListResponse;
  expect(data.mode).toBe('demo');
  expect(data.status).toBe('demo');
  expect(rows.flights.length).toBeGreaterThan(0);
  expect(rows.flights.length).toBeLessThanOrEqual(8);
  await expect(summary(page)).toHaveText(`${new Intl.NumberFormat('ja-JP').format(data.stats.airborne)}機`);
  await expect(page.locator('.demo-banner')).toContainText('実際の航空状況ではありません');
  const firstRow = list(page).getByRole('button', { name: /の詳細を表示$/ }).first();
  const callsign = (await firstRow.getAttribute('aria-label'))!.replace(' の詳細を表示', '');
  const detailResponse = page.waitForResponse(response => /^\/api\/flights\/[a-f\d]{6}$/i.test(new URL(response.url()).pathname) && response.ok());
  await firstRow.click();
  await detailResponse;
  await expect(inspector(page).getByRole('heading', { name: callsign, exact: true })).toBeVisible();
  await expect(inspector(page)).toContainText('DEMO · サンプルフライト');
});

test('map and list selection show aircraft details; server search covers callsign, ICAO and country', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const api = await mockFlightApi(page);
  await page.goto('/?mode=demo');
  await expect(summary(page)).toHaveText('3機');
  await expect(page.locator('.map-label strong')).toContainText('3');
  await selectMapPosition(page, api.requests, 48, 2);
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
  await mockFlightApi(page);
  await page.goto('/?mode=demo');
  await expect(summary(page)).toHaveText('3機');
  await assertNoHorizontalOverflow(page);
  await page.getByRole('textbox', { name: 'フライトを検索' }).fill('Japan');
  await list(page).getByRole('button', { name: 'ANA101 の詳細を表示', exact: true }).click();
  await expect(inspector(page).getByRole('heading', { name: 'ANA101', exact: true })).toBeVisible();
  await assertNoHorizontalOverflow(page);
  await page.getByRole('button', { name: 'フライト詳細を閉じる' }).click();
  await expect(inspector(page)).toContainText('フライトを選択してください。');
});

test('unavailable live data shows an unknown count and requires explicit demo selection', async ({ page }) => {
  await mockFlightApi(page, { live: unavailable() });
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
  const pending: Promise<void>[] = [];
  await mockFlightApi(page, { intercept: async (route, endpoint, mode) => {
    if (endpoint !== 'summary') return false;
    const work = (async () => {
      await new Promise(resolve => setTimeout(resolve, mode === 'live' ? 350 : 200));
      await route.fulfill({ json: summaryResponse(snapshot(mode)) }).catch(() => undefined);
    })();
    pending.push(work);
    await work;
    return true;
  } });
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
  await mockFlightApi(page, { live: snapshot('live', 'stale') });
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
  await page.clock.install({ time: startingTime });
  const data = snapshot('live', 'live', startingTime.toISOString());
  let holdNextRequest = false;
  let heldRequest: Route | undefined;
  await mockFlightApi(page, { live: data, intercept: (route, endpoint, mode) => {
    if (!holdNextRequest || endpoint !== 'summary' || mode !== 'live') return false;
    heldRequest = route;
    return true;
  } });
  await page.goto('/');
  await expect(page.locator('.connection-status')).toHaveText('ライブ受信中');
  await expect(summary(page)).toHaveText('3機');
  holdNextRequest = true;
  await page.getByRole('button', { name: 'データを更新', exact: true }).click();
  await expect.poll(() => heldRequest !== undefined).toBe(true);
  await page.clock.setFixedTime(new Date(startingTime.getTime() + 121_000));
  await page.clock.runFor(5_000);
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
    let fail = false;
    const data = snapshot(mode);
    await mockFlightApi(page, { [mode]: data, intercept: async route => {
      if (!fail) return false;
      await route.abort('failed');
      return true;
    } });
    await page.goto(mode === 'demo' ? '/?mode=demo' : '/');
    await expect(summary(page)).toHaveText('3機');
    await expect(list(page).getByRole('button', { name: `${mode === 'live' ? 'LIVE' : ''}ANA101 の詳細を表示`, exact: true })).toBeVisible();
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
