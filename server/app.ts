import express, { type ErrorRequestHandler, type RequestHandler } from 'express';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { DataMode } from '../shared/types.ts';
import { FlightService } from './service.ts';

interface AppOptions { service: FlightService; staticDirectory?: string }

function modeFromQuery(value: unknown): DataMode | null {
  return value === undefined || value === 'live' ? 'live' : value === 'demo' ? 'demo' : null;
}

export function createApp({ service, staticDirectory = resolve('dist') }: AppOptions) {
  const app = express();
  app.disable('x-powered-by');
  app.use('/api', (_request, response, next) => {
    response.set('Cache-Control', 'no-store');
    next();
  });
  app.get('/api/health', (_request, response) => {
    try { response.json(service.health()); }
    catch { response.status(503).json({ status: 'error', database: 'unavailable' }); }
  });
  app.get('/api/dashboard', async (request, response) => {
    const mode = modeFromQuery(request.query.mode);
    if (!mode) { response.status(400).json({ error: 'mode は live または demo を指定してください。' }); return; }
    response.json(await service.dashboard(mode));
  });
  app.get('/api/flights/:icao24', async (request, response) => {
    const mode = modeFromQuery(request.query.mode);
    if (!mode) { response.status(400).json({ error: 'mode は live または demo を指定してください。' }); return; }
    if (!/^[a-f0-9]{6}$/i.test(request.params.icao24)) {
      response.status(400).json({ error: 'icao24 は 6 桁の 16 進数を指定してください。' }); return;
    }
    const detail = await service.detail(mode, request.params.icao24.toLowerCase());
    if (!detail) { response.status(404).json({ error: '現在の観測データに該当する機体が見つかりません。' }); return; }
    response.json(detail);
  });
  app.use('/api', (_request, response) => { response.status(404).json({ error: 'API エンドポイントが見つかりません。' }); });
  if (existsSync(resolve(staticDirectory, 'index.html'))) {
    app.use(express.static(staticDirectory));
    const fallback: RequestHandler = (request, response, next) => {
      if (!request.accepts('html')) { next(); return; }
      response.sendFile(resolve(staticDirectory, 'index.html'));
    };
    app.get('/{*splat}', fallback);
  }
  const errorHandler: ErrorRequestHandler = (_error, _request, response, _next) => {
    response.status(500).json({ error: 'サーバーでエラーが発生しました。' });
  };
  app.use(errorHandler);
  return app;
}
