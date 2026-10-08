import { expect, test, type Page } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import { localMapTiles, mockFlightApi, summary } from './fixtures';

// The update test temporarily changes the generated worker. Other tests must not rebuild dist concurrently.
test.describe.configure({ mode: 'serial' });
test.use({ serviceWorkers: 'allow', viewport: { width: 390, height: 844 } });

async function waitForController(page: Page) {
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller)), {
    timeout: 15_000,
  }).toBe(true);
}

async function cacheContents(page: Page) {
  return page.evaluate(async () => {
    const names = await caches.keys();
    const urls = (await Promise.all(names.map(async (name) => {
      const cache = await caches.open(name);
      return (await cache.keys()).map((request) => request.url);
    }))).flat();
    return { names, urls };
  });
}

test('production headers, manifest and install icons describe a safe standalone app', async ({ request }) => {
  const html = await request.get('/');
  expect(html.ok()).toBe(true);
  expect(html.headers()['content-security-policy']).toContain("worker-src 'self'");
  expect(html.headers()['content-security-policy']).toContain("script-src 'self'");
  expect(html.headers()['content-security-policy']).toContain("frame-ancestors 'none'");
  expect(html.headers()['x-content-type-options']).toBe('nosniff');
  expect(html.headers()['x-frame-options']).toBe('SAMEORIGIN');
  expect(html.headers()['x-powered-by']).toBeUndefined();

  const response = await request.get('/manifest.webmanifest');
  expect(response.ok()).toBe(true);
  expect(response.headers()['content-type']).toMatch(/^application\/manifest\+json/);
  expect(response.headers()['cache-control']).toBe('no-cache');
  const manifest = await response.json();
  expect(manifest).toMatchObject({ id: '/', start_url: '/', scope: '/', display: 'standalone', lang: 'ja' });
  expect(manifest.icons).toEqual(expect.arrayContaining([
    expect.objectContaining({ sizes: '192x192', purpose: 'any' }),
    expect.objectContaining({ sizes: '512x512', purpose: 'any' }),
    expect.objectContaining({ sizes: '512x512', purpose: 'maskable' }),
  ]));
  for (const icon of manifest.icons as { src: string; sizes: string }[]) {
    const iconResponse = await request.get(icon.src);
    expect(iconResponse.ok()).toBe(true);
    const png = await iconResponse.body();
    const [width, height] = icon.sizes.split('x').map(Number);
    expect(png.toString('hex', 0, 8)).toBe('89504e470d0a1a0a');
    expect(png.readUInt32BE(16)).toBe(width);
    expect(png.readUInt32BE(20)).toBe(height);
  }
  const worker = await request.get('/sw.js');
  expect(worker.ok()).toBe(true);
  expect(worker.headers()['cache-control']).toBe('no-cache');
  expect(worker.headers()['content-type']).toMatch(/javascript/);
});

test('offline reload opens the shell with unknown observations and never cached API data', async ({ page, context }) => {
  const errors: string[] = [];
  const initialConsoleErrors: string[] = [];
  let offline = false;
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (!offline && message.type() === 'error') initialConsoleErrors.push(message.text());
  });
  await localMapTiles(page);
  await mockFlightApi(page, {
    intercept: async (route) => {
      if (!offline) return false;
      await route.abort('internetdisconnected');
      return true;
    },
  });
  await page.goto('/');
  await expect(summary(page)).toHaveText('3機');
  await waitForController(page);
  const cached = await cacheContents(page);
  expect(cached.names).toHaveLength(1);
  expect(cached.names[0]).toMatch(/^skytrace-shell-/);
  expect(cached.urls.length).toBeGreaterThan(5);
  for (const item of cached.urls) {
    const url = new URL(item);
    expect(url.origin).toBe(new URL(page.url()).origin);
    expect(url.search).toBe('');
    expect(url.pathname).toMatch(/^\/(?:index\.html|assets\/.+-[A-Za-z0-9_-]{8,}\.(?:js|css)|icons\/[A-Za-z0-9_-]+\.(?:png|svg))$/);
  }
  expect(cached.urls.some((url) => url.includes('/api/') || url.includes('tile.openstreetmap.org'))).toBe(false);
  expect(initialConsoleErrors).toEqual([]);

  offline = true;
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(page.getByRole('complementary', { name: 'アプリと接続の案内' })).toContainText('オフライン');
  await expect(summary(page)).toHaveText('—機');
  await expect(page.locator('.demo-banner')).toHaveCount(0);
  const failures = await page.evaluate(async () => {
    const cannotFetch = async (path: string) => {
      try { await fetch(path); return false; }
      catch { return true; }
    };
    const name = (await caches.keys()).find((key) => key.startsWith('skytrace-shell-'))!;
    const asset = (await (await caches.open(name)).keys()).find((request) => request.url.endsWith('.js'))!;
    return {
      api: await cannotFetch('/api/summary?mode=live'),
      queriedAsset: await cannotFetch(`${new URL(asset.url).pathname}?outside-precache=1`),
      unknownAsset: await cannotFetch('/not-part-of-the-app.txt'),
    };
  });
  expect(failures).toEqual({ api: true, queriedAsset: true, unknownAsset: true });
  expect(errors).toEqual([]);
});

test('the install action uses the browser prompt and waits for installation confirmation', async ({ page }) => {
  await localMapTiles(page);
  await mockFlightApi(page);
  await page.goto('/');
  await waitForController(page);
  await page.evaluate(() => {
    const localWindow = window as Window & { pwaPromptCount?: number };
    localWindow.pwaPromptCount = 0;
    const event = new Event('beforeinstallprompt', { cancelable: true });
    Object.assign(event, {
      prompt: async () => { localWindow.pwaPromptCount = (localWindow.pwaPromptCount ?? 0) + 1; },
      userChoice: Promise.resolve({ outcome: 'accepted', platform: 'web' }),
    });
    window.dispatchEvent(event);
  });
  await page.getByRole('button', { name: 'ホーム画面に追加', exact: true }).click();
  expect(await page.evaluate(() => (window as Window & { pwaPromptCount?: number }).pwaPromptCount)).toBe(1);
  await expect(page.getByText('スマートフォンでアプリとして使う', { exact: true })).toBeVisible();
  await page.evaluate(() => window.dispatchEvent(new Event('appinstalled')));
  await expect(page.getByRole('button', { name: 'ホーム画面に追加', exact: true })).toHaveCount(0);
  await expect(page.getByText('スマートフォンでアプリとして使う', { exact: true })).toHaveCount(0);
});

test('a waiting worker updates only after the button and cleans up only SKYTRACE caches', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await localMapTiles(page);
  await mockFlightApi(page);
  await page.goto('/');
  await expect(summary(page)).toHaveText('3機');
  await waitForController(page);
  const originalCache = (await cacheContents(page)).names[0];
  await page.evaluate(async () => {
    await (await caches.open('unrelated-project-cache')).put('/unrelated', new Response('keep'));
    await (await caches.open('skytrace-shell-abandoned')).put('/abandoned', new Response('remove'));
  });

  const workerPath = new URL('../../dist/sw.js', import.meta.url);
  const original = await readFile(workerPath, 'utf8');
  const updatedCache = 'skytrace-shell-e2e-verification-update';
  const changed = original.replace(/const CACHE_NAME = .+;/, 'const CACHE_NAME = `${CACHE_PREFIX}e2e-verification-update`;');
  expect(changed).not.toBe(original);
  try {
    await writeFile(workerPath, changed, 'utf8');
    await page.evaluate(async () => { await (await navigator.serviceWorker.getRegistration())!.update(); });
    await expect.poll(() => page.evaluate(async () => Boolean((await navigator.serviceWorker.getRegistration())?.waiting)), {
      timeout: 15_000,
    }).toBe(true);
    const state = await page.evaluate(async () => {
      const registration = (await navigator.serviceWorker.getRegistration())!;
      return { active: registration.active?.state, waiting: registration.waiting?.state, caches: await caches.keys() };
    });
    expect(state.active).toBe('activated');
    expect(state.waiting).toBe('installed');
    expect(state.caches).toEqual(expect.arrayContaining([originalCache, updatedCache, 'skytrace-shell-abandoned', 'unrelated-project-cache']));

    const navigation = page.waitForEvent('framenavigated', { predicate: (frame) => frame === page.mainFrame() });
    await page.getByRole('button', { name: '更新して再読み込み', exact: true }).click();
    await navigation;
    await expect(summary(page)).toHaveText('3機');
    await waitForController(page);
    await expect.poll(() => page.evaluate(() => caches.keys())).toEqual(expect.arrayContaining([updatedCache, 'unrelated-project-cache']));
    await expect.poll(() => page.evaluate(async () => (await caches.keys()).filter((key) => key.startsWith('skytrace-shell-')))).toEqual([updatedCache]);
    expect(errors).toEqual([]);
  } finally {
    await writeFile(workerPath, original, 'utf8');
  }
});
