import express, { type ErrorRequestHandler, type Request, type RequestHandler, type Response } from 'express';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { FlightService } from './service.ts';
import { QueryError, readListQuery, readMapQuery, readMode } from './query.ts';
import { configureHttp, sendJson } from './security.ts';

interface AppOptions { service: FlightService; staticDirectory?: string }

function apiHandler(handler: (request: Request, response: Response) => Promise<void>): RequestHandler {
  return async (request, response) => {
    try { await handler(request, response); }
    catch (error) {
      if (!(error instanceof QueryError)) throw error;
      response.status(400);
      await sendJson(request, response, { error: error.message });
    }
  };
}

export function createApp({ service, staticDirectory = resolve('dist') }: AppOptions) {
  const app = express();
  configureHttp(app);
  app.get('/api/health', apiHandler(async (request, response) => {
    if (Object.keys(request.query).length) throw new QueryError('health にクエリ項目は指定できません。');
    let payload;
    try { payload = service.health(); }
    catch { response.status(503); payload = { status: 'error', database: 'unavailable' }; }
    await sendJson(request, response, payload);
  }));
  app.get('/api/dashboard', apiHandler(async (request, response) => {
    await sendJson(request, response, await service.dashboard(readMode(request.query)));
  }));
  app.get('/api/summary', apiHandler(async (request, response) => {
    await sendJson(request, response, await service.summary(readMode(request.query)));
  }));
  app.get('/api/flights', apiHandler(async (request, response) => {
    await sendJson(request, response, await service.list(readListQuery(request.query)));
  }));
  app.get('/api/map', apiHandler(async (request, response) => {
    await sendJson(request, response, await service.map(readMapQuery(request.query)));
  }));
  app.get('/api/flights/:icao24', apiHandler(async (request, response) => {
    const mode = readMode(request.query);
    const icao24 = request.params.icao24;
    if (typeof icao24 !== 'string' || !/^[a-f0-9]{6}$/i.test(icao24)) {
      throw new QueryError('icao24 は 6 桁の 16 進数を指定してください。');
    }
    const detail = await service.detail(mode, icao24.toLowerCase());
    if (!detail) {
      response.status(404);
      await sendJson(request, response, { error: '現在の観測データに該当する機体が見つかりません。' });
      return;
    }
    await sendJson(request, response, detail);
  }));
  app.use('/api', apiHandler(async (request, response) => {
    response.status(404);
    await sendJson(request, response, { error: 'API エンドポイントが見つかりません。' });
  }));
  if (existsSync(resolve(staticDirectory, 'index.html'))) {
    app.use(express.static(staticDirectory, {
      setHeaders: (response, path) => {
        response.setHeader('Cache-Control', /[/\\]assets[/\\][^/\\]+-[a-zA-Z0-9_-]{8,}\.[^/\\]+$/u.test(path)
          ? 'public, max-age=31536000, immutable' : 'no-cache');
      },
    }));
    const fallback: RequestHandler = (request, response, next) => {
      if (!request.accepts('html') || /\.[^/]+$/u.test(request.path) || /^\/(?:assets|icons)(?:\/|$)/u.test(request.path)) { next(); return; }
      response.set('Cache-Control', 'no-cache');
      response.sendFile(resolve(staticDirectory, 'index.html'));
    };
    app.get('/{*splat}', fallback);
  }
  const errorHandler: ErrorRequestHandler = async (error, request, response, next) => {
    if (response.headersSent) { next(error); return; }
    response.status(error instanceof URIError ? 400 : 500);
    await sendJson(request, response, { error: error instanceof URIError
      ? 'URL の形式が正しくありません。' : 'サーバーでエラーが発生しました。' });
  };
  app.use(errorHandler);
  return app;
}
