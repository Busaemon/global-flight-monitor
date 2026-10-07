import { createHash } from 'node:crypto';
import type { Express, Request, Response } from 'express';
import helmet from 'helmet';
import compression from 'compression';
import { rateLimit } from 'express-rate-limit';

const API_CACHE_CONTROL = 'private, no-cache, must-revalidate';

function integerSetting(name: string, fallback: number, minimum: number, maximum: number): number {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  if (!/^\d+$/.test(raw)) throw new Error(`${name} must be an integer from ${minimum} to ${maximum}.`);
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be an integer from ${minimum} to ${maximum}.`);
  }
  return value;
}

function publicOrigin(): URL | null {
  const raw = process.env.PUBLIC_ORIGIN;
  if (raw === undefined || raw === '') return null;
  let url: URL;
  try { url = new URL(raw); }
  catch { throw new Error('PUBLIC_ORIGIN must be an exact http:// or https:// origin without a path.'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.origin !== raw || url.username || url.password) {
    throw new Error('PUBLIC_ORIGIN must be an exact http:// or https:// origin without a path.');
  }
  return url;
}

/** Install before API routes and static files. The public API has no write methods or cross-origin access. */
export function configureHttp(app: Express): void {
  const origin = publicOrigin();
  const hops = integerSetting('TRUST_PROXY_HOPS', 0, 0, 3);
  const requestsPerMinute = integerSetting('API_RATE_LIMIT_PER_MINUTE', 180, 10, 10_000);
  const isLocal = origin !== null && (['localhost', '[::1]'].includes(origin.hostname)
    || origin.hostname.endsWith('.localhost') || /^127(?:\.\d{1,3}){3}$/.test(origin.hostname));
  const httpsProduction = process.env.NODE_ENV === 'production' && origin?.protocol === 'https:' && !isLocal;

  app.disable('x-powered-by');
  app.set('trust proxy', hops);
  app.set('etag', false);
  app.use(helmet({
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        defaultSrc: ["'self'"],
        baseUri: ["'self'"],
        scriptSrc: ["'self'"],
        scriptSrcAttr: ["'none'"],
        styleSrc: ["'self'", "'unsafe-inline'"], // Leaflet positions tiles and markers using inline styles.
        imgSrc: ["'self'", 'data:', 'blob:', 'https://basemaps.cartocdn.com'],
        fontSrc: ["'self'"],
        connectSrc: ["'self'"],
        workerSrc: ["'self'"],
        manifestSrc: ["'self'"],
        objectSrc: ["'none'"],
        frameSrc: ["'none'"],
        frameAncestors: ["'none'"],
        formAction: ["'self'"],
        upgradeInsecureRequests: httpsProduction ? [] : null,
      },
    },
    strictTransportSecurity: httpsProduction ? { maxAge: 31_536_000, includeSubDomains: false } : false,
    referrerPolicy: { policy: 'no-referrer' },
  }));
  app.use((_request, response, next) => {
    response.set('Permissions-Policy', 'geolocation=(), camera=(), microphone=()');
    next();
  });
  app.use(compression());

  app.use((request, response, next) => {
    const queryStart = request.originalUrl.indexOf('?');
    if (queryStart >= 0 && request.originalUrl.length - queryStart - 1 > 2048) {
      response.set('Cache-Control', API_CACHE_CONTROL);
      response.status(414).json({ error: 'クエリ文字列が長すぎます。' });
      return;
    }
    next();
  });
  app.use('/api', (request, response, next) => {
    response.set('Cache-Control', API_CACHE_CONTROL);
    const requestOrigin = request.get('Origin');
    if (origin && requestOrigin !== undefined && requestOrigin !== origin.origin) {
      response.status(403).json({ error: 'このオリジンからの API アクセスは許可されていません。' });
      return;
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      response.set('Allow', 'GET, HEAD');
      response.status(405).json({ error: 'API は GET または HEAD のみ受け付けます。' });
      return;
    }
    next();
  });
  app.use('/api', rateLimit({
    windowMs: 60_000,
    limit: requestsPerMinute,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    // Health probes do not fetch upstream data and must not exhaust the browser's request budget.
    skip: request => /^\/health\/?$/.test(request.path),
    handler: (_request, response) => {
      response.status(429).json({ error: 'リクエストが多すぎます。しばらく待ってから再試行してください。' });
    },
  }));
}

function matchesEntityTag(header: string | undefined, etag: string): boolean {
  if (!header) return false;
  if (header.trim() === '*') return true;
  // A comma may be part of an opaque quoted tag. Parse the complete list before accepting a match.
  const token = /(?:W\/)?"[\x21\x23-\x7e\x80-\xff]*"/y;
  let cursor = 0;
  let matched = false;
  while (cursor < header.length) {
    while (header[cursor] === ' ' || header[cursor] === '\t') cursor++;
    token.lastIndex = cursor;
    const candidate = token.exec(header);
    if (!candidate) return false;
    matched ||= candidate[0].replace(/^W\//, '') === etag.replace(/^W\//, '');
    cursor = token.lastIndex;
    while (header[cursor] === ' ' || header[cursor] === '\t') cursor++;
    if (cursor === header.length) return matched;
    if (header[cursor] !== ',') return false;
    cursor++;
  }
  return false;
}

/** Browser revalidation saves transfer bytes; a matching ETag never skips the service's freshness checks. */
export async function sendJson(request: Request, response: Response, payload: unknown): Promise<void> {
  const json = JSON.stringify(payload);
  if (json === undefined) throw new TypeError('A JSON response must have a serializable value.');
  const body = Buffer.from(json);
  // Weak validators describe the same JSON across identity and gzip transfer encodings.
  const etag = `W/"${createHash('sha256').update(body).digest('base64url')}"`;
  response.set('Cache-Control', API_CACHE_CONTROL);
  response.set('ETag', etag);
  if ((request.method === 'GET' || request.method === 'HEAD') && response.statusCode >= 200 &&
      response.statusCode < 300 && matchesEntityTag(request.get('If-None-Match'), etag)) {
    response.status(304).end();
    return;
  }
  response.set('Content-Type', 'application/json; charset=utf-8');
  response.set('Content-Length', String(body.length));
  if (request.method === 'HEAD') response.end();
  else response.end(body);
}
