import assert from 'node:assert/strict';
import { once } from 'node:events';
import { request as httpRequest, type IncomingHttpHeaders } from 'node:http';
import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import test from 'node:test';
import express from 'express';
import { createApp } from '../server/app.ts';
import { FlightDatabase } from '../server/database.ts';
import { FlightService } from '../server/service.ts';
import { configureHttp, sendJson } from '../server/security.ts';

const SETTINGS = ['PUBLIC_ORIGIN', 'NODE_ENV', 'TRUST_PROXY_HOPS', 'API_RATE_LIMIT_PER_MINUTE'] as const;

function configuredApp(overrides: Record<string, string | undefined> = {}) {
  const saved = Object.fromEntries(SETTINGS.map(name => [name, process.env[name]]));
  try {
    for (const name of SETTINGS) {
      const value = overrides[name];
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    const app = express();
    configureHttp(app);
    return app;
  } finally {
    for (const name of SETTINGS) {
      if (saved[name] === undefined) delete process.env[name];
      else process.env[name] = saved[name];
    }
  }
}

async function serve(app: ReturnType<typeof express>, run: (base: string) => Promise<void>) {
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try { await run(base); }
  finally {
    const closed = once(server, 'close');
    server.close();
    server.closeAllConnections();
    await closed;
  }
}

function rawGet(url: string, headers: Record<string, string>) {
  return new Promise<{ status: number; headers: IncomingHttpHeaders; body: Buffer }>((resolve, reject) => {
    const request = httpRequest(url, { headers }, response => {
      const chunks: Buffer[] = [];
      response.on('data', (chunk: Buffer) => chunks.push(chunk));
      response.on('error', reject);
      response.on('end', () => resolve({
        status: response.statusCode ?? 0, headers: response.headers, body: Buffer.concat(chunks),
      }));
    });
    request.on('error', reject);
    request.end();
  });
}

test('security headers restrict scripts, frames, browser permissions and referrer disclosure in local development', async () => {
  const app = configuredApp();
  app.get('/api/example', (request, response) => sendJson(request, response, { ready: true }));
  await serve(app, async base => {
    const response = await fetch(`${base}/api/example`);
    assert.equal(response.status, 200);
    const csp = response.headers.get('content-security-policy')!;
    assert.match(csp, /script-src 'self'(?:;|$)/);
    assert.match(csp, /script-src-attr 'none'/);
    assert.match(csp, /worker-src 'self'/);
    assert.match(csp, /manifest-src 'self'/);
    assert.match(csp, /object-src 'none'/);
    assert.match(csp, /frame-ancestors 'none'/);
    assert.match(csp, /img-src 'self' data: blob: https:\/\/basemaps\.cartocdn\.com/);
    assert.match(csp, /style-src 'self' 'unsafe-inline'/);
    assert.doesNotMatch(csp, /unsafe-eval|upgrade-insecure-requests/);
    assert.equal(response.headers.get('strict-transport-security'), null);
    assert.equal(response.headers.get('x-powered-by'), null);
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
    assert.equal(response.headers.get('permissions-policy'), 'geolocation=(), camera=(), microphone=()');
    assert.equal(response.headers.get('cache-control'), 'private, no-cache, must-revalidate');
    assert.equal(response.headers.get('access-control-allow-origin'), null);
    assert.equal(app.get('trust proxy'), 0);
  });
});

test('HSTS and insecure-request upgrades apply only to the configured HTTPS production site', async () => {
  for (const [settings, secured] of [
    [{ NODE_ENV: 'production', PUBLIC_ORIGIN: 'https://flights.example' }, true],
    [{ NODE_ENV: 'development', PUBLIC_ORIGIN: 'https://flights.example' }, false],
    [{ NODE_ENV: 'production', PUBLIC_ORIGIN: 'http://flights.example' }, false],
    [{ NODE_ENV: 'production', PUBLIC_ORIGIN: 'https://localhost' }, false],
    [{ NODE_ENV: 'production', PUBLIC_ORIGIN: 'https://app.localhost' }, false],
    [{ NODE_ENV: 'production', PUBLIC_ORIGIN: 'https://127.0.0.1' }, false],
    [{ NODE_ENV: 'production', PUBLIC_ORIGIN: 'https://[::1]' }, false],
  ] as const) {
    const app = configuredApp(settings);
    app.get('/', (_request, response) => response.send('ready'));
    await serve(app, async base => {
      const response = await fetch(base);
      assert.equal(response.headers.has('strict-transport-security'), secured);
      assert.equal(response.headers.get('content-security-policy')!.includes('upgrade-insecure-requests'), secured);
      if (secured) assert.equal(response.headers.get('strict-transport-security'), 'max-age=31536000');
    });
  }
});

test('invalid proxy, quota and public-origin configuration fails before serving requests', () => {
  for (const value of ['-1', '4', 'true', '', '1.5', '1e0']) {
    assert.throws(() => configuredApp({ TRUST_PROXY_HOPS: value }), /TRUST_PROXY_HOPS/);
  }
  for (const value of ['9', '10001', '-1', 'Infinity', '180.5', '']) {
    assert.throws(() => configuredApp({ API_RATE_LIMIT_PER_MINUTE: value }), /API_RATE_LIMIT_PER_MINUTE/);
  }
  for (const value of ['null', 'ftp://flights.example', 'https://flights.example/', 'https://user:password@flights.example',
    'https://flights.example/path', 'https://flights.example?x=1', 'https://flights.example#hash']) {
    assert.throws(() => configuredApp({ PUBLIC_ORIGIN: value }), /PUBLIC_ORIGIN/);
  }
  assert.equal(configuredApp({ TRUST_PROXY_HOPS: '3', API_RATE_LIMIT_PER_MINUTE: '10000' }).get('trust proxy'), 3);
});

test('API rejects write methods, foreign origins and oversized queries without invoking route handlers', async () => {
  const app = configuredApp({ PUBLIC_ORIGIN: 'https://flights.example' });
  let calls = 0;
  app.all('/api/example', (request, response) => {
    calls++;
    return sendJson(request, response, { ready: true });
  });
  await serve(app, async base => {
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']) {
      const response = await fetch(`${base}/api/example`, { method });
      assert.equal(response.status, 405);
      assert.equal(response.headers.get('allow'), 'GET, HEAD');
    }
    for (const origin of ['https://elsewhere.example', 'null', 'https://flights.example.evil']) {
      assert.equal((await fetch(`${base}/api/example`, { headers: { Origin: origin } })).status, 403);
    }
    assert.equal((await fetch(`${base}/api/example?${'x'.repeat(2049)}`)).status, 414);
    assert.equal(calls, 0);
    assert.equal((await fetch(`${base}/api/example`, { headers: { Origin: 'https://flights.example' } })).status, 200);
    assert.equal((await fetch(`${base}/api/example`)).status, 200);
    const head = await fetch(`${base}/api/example`, { method: 'HEAD' });
    assert.equal(head.status, 200);
    assert.equal(await head.text(), '');
    assert.equal(calls, 3);
  });
});

test('API rate limits client reads with retry guidance while health checks remain available', async () => {
  const app = configuredApp({ API_RATE_LIMIT_PER_MINUTE: '10' });
  let calls = 0;
  app.get('/api/example', (request, response) => { calls++; return sendJson(request, response, { ready: true }); });
  app.get('/api/health', (request, response) => sendJson(request, response, { status: 'ok' }));
  await serve(app, async base => {
    for (let index = 0; index < 11; index++) {
      assert.equal((await fetch(`${base}/api/health`)).status, 200);
    }
    for (let index = 0; index < 10; index++) {
      assert.equal((await fetch(`${base}/api/example`)).status, 200);
    }
    const limited = await fetch(`${base}/api/example`);
    assert.equal(limited.status, 429);
    assert.ok(Number(limited.headers.get('retry-after')) > 0);
    assert.ok(limited.headers.get('ratelimit'));
    assert.equal(calls, 10);
    assert.equal((await fetch(`${base}/api/health`)).status, 200);
  });
});

test('JSON ETags revalidate identical bytes, weak/list validators, HEAD and changed representations', async () => {
  const app = configuredApp();
  let sequence = 1;
  let calls = 0;
  app.get('/api/example', (request, response) => {
    calls++;
    return sendJson(request, response, { sequence, aircraft: 'abc123' });
  });
  app.get('/api/error', (request, response) => sendJson(request, response.status(503), { sequence: 1, aircraft: 'abc123' }));
  await serve(app, async base => {
    const initial = await fetch(`${base}/api/example`);
    const etag = initial.headers.get('etag')!;
    assert.match(etag, /^W\/"[a-zA-Z0-9_-]{43}"$/);
    for (const validator of [etag, etag.replace(/^W\//, ''), `"other,tag", ${etag}`, '*']) {
      const response = await fetch(`${base}/api/example`, { headers: { 'If-None-Match': validator } });
      assert.equal(response.status, 304);
      assert.equal(response.headers.get('etag'), etag);
      assert.equal(response.headers.get('cache-control'), 'private, no-cache, must-revalidate');
      assert.equal(await response.text(), '');
    }
    for (const validator of ['"unknown"', `"invalid,${etag},tag"`, `${etag},junk`, `${etag},`]) {
      assert.equal((await fetch(`${base}/api/example`, { headers: { 'If-None-Match': validator } })).status, 200);
    }
    assert.equal((await fetch(`${base}/api/example`, { method: 'HEAD', headers: { 'If-None-Match': etag } })).status, 304);
    sequence = 2;
    const updated = await fetch(`${base}/api/example`, { headers: { 'If-None-Match': etag } });
    assert.equal(updated.status, 200);
    assert.notEqual(updated.headers.get('etag'), etag);
    assert.equal((await updated.json()).sequence, 2);
    assert.equal(calls, 11, 'Conditional requests must still execute freshness-aware handlers.');
    assert.equal((await fetch(`${base}/api/error`, { headers: { 'If-None-Match': etag } })).status, 503);
  });
});

test('large public JSON is gzip compressed without changing its representation validator', async () => {
  const app = configuredApp();
  const payload = { aircraft: Array.from({ length: 200 }, (_, index) => ({ icao24: `ab${index}`, callsign: 'SAMPLE', country: 'Japan' })) };
  app.get('/api/example', (request, response) => sendJson(request, response, payload));
  await serve(app, async base => {
    const plain = await rawGet(`${base}/api/example`, { 'Accept-Encoding': 'identity' });
    const compressed = await rawGet(`${base}/api/example`, { 'Accept-Encoding': 'gzip' });
    assert.equal(plain.status, 200);
    assert.equal(compressed.status, 200);
    assert.equal(compressed.headers['content-encoding'], 'gzip');
    assert.match(String(compressed.headers.vary), /Accept-Encoding/);
    assert.equal(plain.headers.etag, compressed.headers.etag);
    assert.ok(compressed.body.length < plain.body.length / 2);
    assert.deepEqual(gunzipSync(compressed.body), plain.body);
    assert.deepEqual(JSON.parse(gunzipSync(compressed.body).toString()), payload);
  });
});

test('malformed percent-encoded API paths return a safe client error before requesting upstream data', async () => {
  const database = new FlightDatabase(':memory:');
  let providerCalls = 0;
  const service = new FlightService(database, {
    provider: { async fetchObservation() { providerCalls++; throw new Error('Unexpected upstream request'); } },
  });
  const app = createApp({ service, staticDirectory: fileURLToPath(new URL('../.tmp/missing-security-build', import.meta.url)) });
  try {
    await serve(app, async base => {
      assert.equal((await fetch(`${base}/api/health`)).status, 200);
      for (const path of ['/api/flights/%', '/api/flights/%ZZ', '/api/flights/%E0%A4%A']) {
        const response = await fetch(`${base}${path}`);
        assert.equal(response.status, 400);
        assert.equal(response.headers.get('cache-control'), 'private, no-cache, must-revalidate');
        const payload = await response.json();
        assert.deepEqual(payload, { error: 'URL の形式が正しくありません。' });
        assert.equal(providerCalls, 0);
      }
    });
  } finally { database.close(); }
});
