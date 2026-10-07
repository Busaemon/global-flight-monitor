import type { Flight, FlightStats } from '../shared/types.ts';

export const LIVE_SOURCE = 'OpenSky Network';
export const LIVE_COVERAGE = 'OpenSky が受信した、直近 120 秒以内に通信がある飛行中の機体数です。世界の全機体を網羅する正確な総数ではありません。地図には直近 120 秒以内の有効な位置情報がある機体だけを表示します。登録国は飛行場所を示しません。';

export interface Observation { observedAt: string; stats: FlightStats; flights: Flight[] }
export interface FlightProvider { fetchObservation(): Promise<Observation> }

export class ProviderError extends Error {
  constructor(message: string, readonly retryAfterSeconds = 60) { super(message); }
}

const numberOrNull = (value: unknown): number | null => typeof value === 'number' && Number.isFinite(value) ? value : null;
const average = (values: Array<number | null>) => {
  const valid = values.filter((value): value is number => value !== null);
  return valid.length ? valid.reduce((sum, value) => sum + value, 0) / valid.length : null;
};

export function summarize(flights: Flight[], totalObserved: number): FlightStats {
  return {
    airborne: flights.length, totalObserved,
    withPosition: flights.filter(flight => flight.latitude !== null && flight.longitude !== null).length,
    countries: new Set(flights.map(flight => flight.originCountry).filter(country => country !== 'Unknown')).size,
    avgAltitudeMeters: average(flights.map(flight => flight.altitudeMeters)),
    avgVelocityMps: average(flights.map(flight => flight.velocityMps)),
  };
}

/** OpenSky state vector positions follow the documented /states/all contract. */
export function parseOpenSky(payload: unknown): Observation {
  if (!payload || typeof payload !== 'object') throw new ProviderError('OpenSky の応答形式が正しくありません。');
  const raw = payload as Record<string, unknown>;
  const observed = numberOrNull(raw.time);
  if (observed === null || observed <= 0 || observed * 1000 > 8640000000000000 ||
      (!Array.isArray(raw.states) && raw.states !== null)) {
    throw new ProviderError('OpenSky の応答形式が正しくありません。');
  }
  const states = raw.states ?? [];
  const valid = new Map<string, Flight>();
  let structurallyValid = 0;
  for (const state of states as unknown[]) {
    if (!Array.isArray(state) || state.length < 17 || typeof state[0] !== 'string' ||
        !/^[a-f0-9]{6}$/i.test(state[0]) || typeof state[8] !== 'boolean') continue;
    const contact = numberOrNull(state[4]);
    if (contact === null || contact <= 0) continue;
    structurallyValid += 1;
    if (observed - contact > 120 || contact - observed > 30) continue;
    const positionTime = numberOrNull(state[3]);
    const longitude = numberOrNull(state[5]);
    const latitude = numberOrNull(state[6]);
    const positionFresh = positionTime !== null && positionTime > 0 &&
      observed - positionTime <= 120 && positionTime - observed <= 30 &&
      latitude !== null && Math.abs(latitude) <= 90 && longitude !== null && Math.abs(longitude) <= 180;
    const altitude = numberOrNull(state[13]) ?? numberOrNull(state[7]);
    const velocity = numberOrNull(state[9]);
    const heading = numberOrNull(state[10]);
    const sources = ['ADS-B', 'ASTERIX', 'MLAT', 'FLARM'];
    const flight: Flight = {
      icao24: state[0].toLowerCase(),
      callsign: typeof state[1] === 'string' ? state[1].trim() : '',
      originCountry: typeof state[2] === 'string' && state[2].trim() ? state[2].trim() : 'Unknown',
      longitude: positionFresh ? longitude : null, latitude: positionFresh ? latitude : null,
      altitudeMeters: altitude !== null && altitude >= -500 && altitude <= 30000 ? altitude : null,
      velocityMps: velocity !== null && velocity >= 0 && velocity <= 1500 ? velocity : null,
      headingDegrees: heading !== null && heading >= 0 && heading <= 360 ? heading % 360 : null,
      verticalRateMps: numberOrNull(state[11]), onGround: state[8],
      lastContact: new Date(contact * 1000).toISOString(),
      positionUpdatedAt: positionFresh ? new Date(positionTime * 1000).toISOString() : null,
      positionSource: typeof state[16] === 'number' ? sources[state[16]] ?? 'Unknown' : 'Unknown',
    };
    const existing = valid.get(flight.icao24);
    if (!existing || existing.lastContact < flight.lastContact) valid.set(flight.icao24, flight);
  }
  if ((states as unknown[]).length && !structurallyValid) throw new ProviderError('OpenSky の応答に有効な機体データがありません。');
  const flights = [...valid.values()].filter(flight => !flight.onGround).sort((a, b) => a.icao24.localeCompare(b.icao24));
  return { observedAt: new Date(observed * 1000).toISOString(), stats: summarize(flights, valid.size), flights };
}

interface OpenSkyOptions {
  fetch?: typeof globalThis.fetch;
  now?: () => number;
  clientId?: string;
  clientSecret?: string;
  timeoutMs?: number;
}

export class OpenSkyProvider implements FlightProvider {
  private readonly fetcher: typeof globalThis.fetch;
  private readonly now: () => number;
  private readonly clientId: string | undefined;
  private readonly clientSecret: string | undefined;
  private readonly timeoutMs: number;
  private token: { value: string; expiresAt: number } | null = null;
  private blockedUntil = 0;

  constructor(options: OpenSkyOptions = {}) {
    this.fetcher = options.fetch ?? globalThis.fetch;
    this.now = options.now ?? Date.now;
    this.clientId = options.clientId ?? process.env.OPENSKY_CLIENT_ID;
    this.clientSecret = options.clientSecret ?? process.env.OPENSKY_CLIENT_SECRET;
    this.timeoutMs = options.timeoutMs ?? 8000;
  }

  private retrySeconds(response: Response) {
    const raw = response.headers.get('x-rate-limit-retry-after-seconds') ?? response.headers.get('retry-after');
    if (!raw) return 900;
    const seconds = Number(raw);
    const parsed = Number.isFinite(seconds) ? seconds : (Date.parse(raw) - this.now()) / 1000;
    return Number.isFinite(parsed) ? Math.min(86400, Math.max(60, Math.ceil(parsed))) : 900;
  }

  private async authorization(): Promise<string | null> {
    if (!this.clientId && !this.clientSecret) return null;
    if (!this.clientId || !this.clientSecret) throw new ProviderError('OpenSky の OAuth 設定が不完全です。環境設定で両方の認証情報を設定してください。', 300);
    if (this.token && this.token.expiresAt > this.now() + 30000) return `Bearer ${this.token.value}`;
    const response = await this.fetcher('https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token', {
      method: 'POST', signal: AbortSignal.timeout(this.timeoutMs),
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'client_credentials', client_id: this.clientId, client_secret: this.clientSecret }),
    });
    if (!response.ok) throw new ProviderError('OpenSky の OAuth 認証に失敗しました。環境設定の認証情報を確認してください。', 300);
    const payload: unknown = await response.json();
    if (!payload || typeof payload !== 'object') throw new ProviderError('OpenSky の認証応答形式が正しくありません。', 300);
    const token = payload as { access_token?: unknown; expires_in?: unknown };
    if (typeof token.access_token !== 'string' || !token.access_token) throw new ProviderError('OpenSky の認証応答形式が正しくありません。', 300);
    const expiresIn = typeof token.expires_in === 'number' && token.expires_in > 0 ? token.expires_in : 300;
    this.token = { value: token.access_token, expiresAt: this.now() + expiresIn * 1000 };
    return `Bearer ${token.access_token}`;
  }

  async fetchObservation(): Promise<Observation> {
    if (this.now() < this.blockedUntil) {
      throw new ProviderError('OpenSky のリクエスト制限に達しました。次回の更新までお待ちください。', Math.ceil((this.blockedUntil - this.now()) / 1000));
    }
    try {
      let authorization = await this.authorization();
      let response = await this.fetcher('https://opensky-network.org/api/states/all', {
        signal: AbortSignal.timeout(this.timeoutMs),
        headers: authorization ? { Authorization: authorization } : {},
      });
      if (response.status === 401 && authorization) {
        this.token = null;
        authorization = await this.authorization();
        response = await this.fetcher('https://opensky-network.org/api/states/all', {
          signal: AbortSignal.timeout(this.timeoutMs),
          headers: authorization ? { Authorization: authorization } : {},
        });
      }
      if (response.status === 429) {
        const retry = this.retrySeconds(response);
        this.blockedUntil = this.now() + retry * 1000;
        throw new ProviderError('OpenSky のリクエスト制限に達しました。保存済みデータがあれば表示し、時間を空けて再取得します。', retry);
      }
      if (response.status === 401) { this.token = null; throw new ProviderError('OpenSky の認証が拒否されました。環境設定の認証情報を確認してください。', 300); }
      if (response.status === 403) throw new ProviderError('OpenSky へのアクセスが拒否されました。ネットワーク設定または API の利用条件を確認してください。', 300);
      if (!response.ok) throw new ProviderError(`OpenSky が一時的に利用できません（HTTP ${response.status}）。`);
      let payload: unknown;
      try { payload = await response.json(); }
      catch { throw new ProviderError('OpenSky の応答を読み取れませんでした。'); }
      return parseOpenSky(payload);
    } catch (error) {
      if (error instanceof ProviderError) throw error;
      throw new ProviderError('OpenSky に接続できませんでした。ネットワーク接続と API の稼働状況を確認してください。');
    }
  }
}
