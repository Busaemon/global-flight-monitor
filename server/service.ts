import type { DashboardResponse, DashboardSummaryResponse, DataMode, DataStatus, FlightDetailResponse, FlightListResponse, FlightMapResponse, FlightStats } from '../shared/types.ts';
import { FlightDatabase, type StoredSnapshot } from './database.ts';
import { DEMO_COVERAGE, DEMO_SOURCE, makeDemoHistory, makeDemoObservation } from './demo.ts';
import { LIVE_COVERAGE, LIVE_SOURCE, OpenSkyProvider, ProviderError, type FlightProvider } from './opensky.ts';
import { inBounds, matchesSearch, sampleMapFlights, sortFlights, type FlightListQuery, type FlightMapQuery } from './query.ts';

const EMPTY_STATS: FlightStats = {
  airborne: 0, totalObserved: 0, withPosition: 0, countries: 0,
  avgAltitudeMeters: null, avgVelocityMps: null,
};

export function pollIntervalFromEnvironment(): number {
  const configured = process.env.POLL_INTERVAL_SECONDS;
  if (configured !== undefined && configured.trim()) {
    const parsed = Number(configured);
    if (!Number.isFinite(parsed) || parsed < 10 || parsed > 86400) {
      throw new Error('POLL_INTERVAL_SECONDS must be a number from 10 to 86400.');
    }
    return Math.ceil(parsed);
  }
  return process.env.OPENSKY_CLIENT_ID && process.env.OPENSKY_CLIENT_SECRET ? 120 : 900;
}

interface ServiceOptions {
  provider?: FlightProvider;
  now?: () => number;
  pollIntervalSeconds?: number;
}

export class FlightService {
  private readonly provider: FlightProvider;
  private readonly now: () => number;
  readonly pollIntervalSeconds: number;
  private nextLiveAttempt = 0;
  private inFlight: Promise<void> | null = null;
  private liveSnapshot: StoredSnapshot | null;
  private demoSnapshot: StoredSnapshot | null;
  private liveStatus: DataStatus = 'unavailable';
  private liveMessage: string | null = null;
  private demoUpdatedAt = 0;
  private backgroundActive = false;
  private backgroundTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(readonly database: FlightDatabase, options: ServiceOptions = {}) {
    this.provider = options.provider ?? new OpenSkyProvider();
    this.now = options.now ?? Date.now;
    this.pollIntervalSeconds = options.pollIntervalSeconds ?? pollIntervalFromEnvironment();
    if (this.pollIntervalSeconds < 10 || this.pollIntervalSeconds > 86400 || !Number.isFinite(this.pollIntervalSeconds)) {
      throw new Error('The polling interval must be between 10 and 86400 seconds.');
    }
    this.liveSnapshot = database.read('live');
    this.demoSnapshot = database.read('demo');
    if (this.liveSnapshot) {
      this.liveStatus = 'stale';
      this.liveMessage = '前回保存したデータです。ライブ取得の成功後に更新します。';
      const fetchedAt = Date.parse(this.liveSnapshot.fetchedAt ?? '');
      if (Number.isFinite(fetchedAt) && fetchedAt <= this.now() + 30000) {
        this.nextLiveAttempt = fetchedAt + this.pollIntervalSeconds * 1000;
        if (this.nextLiveAttempt > this.now()) {
          this.liveMessage = '前回保存した観測データです。次回の更新時刻まで保存済みデータを表示します。';
        }
      }
    }
    const providerState = database.providerState();
    if (providerState && providerState.nextAttemptAt > this.nextLiveAttempt) {
      this.nextLiveAttempt = providerState.nextAttemptAt;
      if (providerState.lastError) this.liveMessage = providerState.lastError;
    }
  }

  /** Start optional collection without waiting for a browser request. Calls still share the same quota gate. */
  start() {
    if (this.backgroundActive) return;
    this.backgroundActive = true;
    void this.runBackground();
  }

  private async runBackground() {
    try { await this.ensureLive(); }
    finally {
      if (this.backgroundActive) {
        const delay = Math.max(1000, this.nextLiveAttempt - this.now());
        this.backgroundTimer = setTimeout(() => { void this.runBackground(); }, delay);
        this.backgroundTimer.unref();
      }
    }
  }

  async stop() {
    this.backgroundActive = false;
    if (this.backgroundTimer) clearTimeout(this.backgroundTimer);
    this.backgroundTimer = null;
    if (this.inFlight) await this.inFlight;
  }

  private async ensureLive() {
    if (this.inFlight) await this.inFlight;
    else if (this.now() >= this.nextLiveAttempt) {
      this.inFlight = this.refreshLive();
      try { await this.inFlight; } finally { this.inFlight = null; }
    }
  }

  private async refreshLive() {
    try {
      // Reserve the normal interval before the upstream call, including a process restart during a request.
      this.nextLiveAttempt = this.now() + this.pollIntervalSeconds * 1000;
      this.database.saveProviderState({ nextAttemptAt: this.nextLiveAttempt, lastError: this.liveMessage });
      const observation = await this.provider.fetchObservation();
      const fetchedAt = new Date(this.now()).toISOString();
      const observedMillis = Date.parse(observation.observedAt);
      if (!Number.isFinite(observedMillis) || this.now() - observedMillis > 120000 || observedMillis - this.now() > 30000) {
        throw new ProviderError('OpenSky の観測時刻が古いか不正です。最新のデータを取得できませんでした。');
      }
      if (this.liveSnapshot?.observedAt && observedMillis < Date.parse(this.liveSnapshot.observedAt)) {
        throw new ProviderError('OpenSky の観測データが保存済みデータより古いため、前回の観測データを保持します。');
      }
      const snapshot: StoredSnapshot = { ...observation, mode: 'live', source: LIVE_SOURCE, coverageNote: LIVE_COVERAGE, fetchedAt };
      this.database.save(snapshot);
      this.liveSnapshot = snapshot;
      this.liveStatus = 'live';
      this.liveMessage = null;
      this.nextLiveAttempt = this.now() + this.pollIntervalSeconds * 1000;
    } catch (error) {
      this.liveStatus = this.liveSnapshot ? 'stale' : 'unavailable';
      this.liveMessage = error instanceof ProviderError ? error.message : 'ライブデータの取得または保存に失敗しました。時間を空けて再試行します。';
      const retry = error instanceof ProviderError ? error.retryAfterSeconds : 60;
      this.nextLiveAttempt = this.now() + Math.max(this.pollIntervalSeconds, retry) * 1000;
    }
    try { this.database.saveProviderState({ nextAttemptAt: this.nextLiveAttempt, lastError: this.liveMessage }); }
    catch {
      this.liveStatus = this.liveSnapshot ? 'stale' : 'unavailable';
      this.liveMessage = '更新時刻をデータベースに保存できませんでした。運用環境を確認してください。';
    }
  }

  async dashboard(mode: DataMode): Promise<DashboardResponse> {
    if (mode === 'demo') {
      if (!this.demoSnapshot || this.now() - this.demoUpdatedAt >= 10000) {
        const observation = makeDemoObservation(this.now());
        this.database.seedDemoHistory(makeDemoHistory(this.now()));
        this.demoSnapshot = { ...observation, mode: 'demo', source: DEMO_SOURCE, coverageNote: DEMO_COVERAGE,
          fetchedAt: new Date(this.now()).toISOString() };
        this.database.save(this.demoSnapshot);
        this.demoUpdatedAt = this.now();
      }
      return {
        ...this.demoSnapshot, mode: 'demo', status: 'demo', pollIntervalSeconds: 10,
        nextRefreshAt: new Date(this.demoUpdatedAt + 10000).toISOString(),
        history: this.database.history('demo'), message: 'デモモード：すべての機体・履歴は架空のシミュレーションです。',
      };
    }
    await this.ensureLive();
    const observedAt = this.liveSnapshot?.observedAt;
    const expired = this.liveStatus === 'live' && observedAt !== null && observedAt !== undefined &&
      this.now() - Date.parse(observedAt) > 120000;
    return {
      mode: 'live', status: expired ? 'stale' : this.liveStatus, source: LIVE_SOURCE, coverageNote: LIVE_COVERAGE,
      fetchedAt: this.liveSnapshot?.fetchedAt ?? null, observedAt: this.liveSnapshot?.observedAt ?? null,
      nextRefreshAt: new Date(this.nextLiveAttempt).toISOString(), pollIntervalSeconds: this.pollIntervalSeconds,
      stats: this.liveSnapshot?.stats ?? { ...EMPTY_STATS }, flights: this.liveSnapshot?.flights ?? [],
      history: this.database.history('live'), message: expired
        ? '前回取得した観測データです。API の利用枠を守るため、次回の更新時刻まで保存済みデータを表示します。'
        : this.liveMessage,
    };
  }

  async summary(mode: DataMode): Promise<DashboardSummaryResponse> {
    const dashboard = await this.dashboard(mode);
    return {
      mode: dashboard.mode, status: dashboard.status, source: dashboard.source, coverageNote: dashboard.coverageNote,
      fetchedAt: dashboard.fetchedAt, observedAt: dashboard.observedAt, nextRefreshAt: dashboard.nextRefreshAt,
      pollIntervalSeconds: dashboard.pollIntervalSeconds, stats: dashboard.stats, history: dashboard.history, message: dashboard.message,
    };
  }

  async list(query: FlightListQuery): Promise<FlightListResponse> {
    const dashboard = await this.dashboard(query.mode);
    const flights = sortFlights(dashboard.flights.filter(flight => matchesSearch(flight, query.q)), query.sort);
    const pageCount = Math.ceil(flights.length / query.limit);
    const page = Math.min(query.page, Math.max(1, pageCount));
    return {
      mode: query.mode, source: dashboard.source, observedAt: dashboard.observedAt, fetchedAt: dashboard.fetchedAt,
      flights: flights.slice((page - 1) * query.limit, page * query.limit), total: flights.length,
      page, pageSize: query.limit, pageCount,
    };
  }

  async map(query: FlightMapQuery): Promise<FlightMapResponse> {
    const dashboard = await this.dashboard(query.mode);
    const flights = dashboard.flights.filter(flight => matchesSearch(flight, query.q)).filter(flight => inBounds(flight, query.bounds));
    return {
      mode: query.mode, observedAt: dashboard.observedAt, fetchedAt: dashboard.fetchedAt,
      flights: sampleMapFlights(flights, query.limit, query.selected), total: flights.length, sampled: flights.length > query.limit,
    };
  }

  async detail(mode: DataMode, icao24: string): Promise<FlightDetailResponse | null> {
    const dashboard = await this.dashboard(mode);
    const flight = dashboard.flights.find(item => item.icao24 === icao24);
    return flight ? { flight, mode, source: dashboard.source, fetchedAt: dashboard.fetchedAt, observedAt: dashboard.observedAt } : null;
  }

  health() {
    const observedAt = this.liveSnapshot?.observedAt;
    const status = this.liveStatus === 'live' && observedAt && this.now() - Date.parse(observedAt) > 120000
      ? 'stale' : this.liveStatus;
    return {
      status: this.database.ready() ? 'ok' : 'error', database: 'ready',
      live: { status, fetchedAt: this.liveSnapshot?.fetchedAt ?? null,
        pollIntervalSeconds: this.pollIntervalSeconds,
        authenticationConfigured: Boolean(process.env.OPENSKY_CLIENT_ID && process.env.OPENSKY_CLIENT_SECRET) },
    };
  }
}
