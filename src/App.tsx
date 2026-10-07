import { useEffect, useMemo, useRef, useState } from 'react';
import { GeoJSON, MapContainer, Marker, Pane, TileLayer, ZoomControl, useMap } from 'react-leaflet';
import L from 'leaflet';
import {
  Activity, ArrowDown, ArrowRight, ArrowUp, ArrowUpRight, Check,
  ChevronLeft, ChevronRight, Clock3, Globe2, LocateFixed, MapPin,
  Maximize2, Plane, Radio, RefreshCw, Search, ShieldCheck, Signal,
  SlidersHorizontal, Wind, X,
} from 'lucide-react';
import type { DashboardResponse, DataMode, Flight, HistoryPoint } from '../shared/types';
import worldLand from './components/world-land';

const number = new Intl.NumberFormat('ja-JP');
const MAP_LIMIT = 1200;
const PAGE_SIZE = 8;
const planeSvg = '<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M21 15v-2l-8-5V2.5a1.5 1.5 0 0 0-3 0V8l-8 5v2l8-2.5V18l-2 1.5V21l3.5-1 3.5 1v-1.5L13 18v-5.5z" fill="currentColor"/></svg>';

function utcTime(value: string | number | null, seconds = true) {
  if (value === null) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleTimeString('en-GB', {
    timeZone: 'UTC', hour: '2-digit', minute: '2-digit', ...(seconds ? { second: '2-digit' } : {}),
  });
}
function flightName(flight: Flight) { return flight.callsign || flight.icao24.toUpperCase(); }
function meters(value: number | null) { return value === null ? '—' : number.format(Math.round(value)); }
function speed(value: number | null) { return value === null ? '—' : number.format(Math.round(value * 3.6)); }
function age(value: string | null, now: number) {
  if (!value) return '—';
  const seconds = Math.max(0, Math.round((now - new Date(value).getTime()) / 1000));
  if (!Number.isFinite(seconds)) return '—';
  if (seconds < 60) return `${seconds}秒前`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}分前`;
  return `${Math.floor(seconds / 3600)}時間前`;
}
function initialMode(): DataMode {
  try { return localStorage.getItem('skytrace-mode') === 'demo' ? 'demo' : 'live'; }
  catch { return 'live'; }
}

function useDashboard(mode: DataMode, revision: number) {
  const [snapshot, setSnapshot] = useState<DashboardResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let alive = true;
    setLoading(true);
    setError(null);
    async function poll() {
      try {
        const response = await fetch(`/api/dashboard?mode=${mode}`, {
          signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10_000)]),
        });
        if (!response.ok) throw new Error(`データの取得に失敗しました (HTTP ${response.status})`);
        const data = await response.json() as DashboardResponse;
        if (data.mode !== mode) throw new Error('データモードが一致しません。再取得してください。');
        if (!alive) return;
        setSnapshot(data);
        setError(null);
        // The backend owns upstream rate limiting; frequent local reads expose stale cache state.
        timer = setTimeout(poll, Math.max(5, Math.min(30, data.pollIntervalSeconds || 60)) * 1000);
      } catch (caught) {
        if (!alive || controller.signal.aborted) return;
        setError(caught instanceof Error && caught.name === 'TimeoutError'
          ? 'データ取得がタイムアウトしました。接続状況を確認してください。'
          : caught instanceof Error ? caught.message : 'サーバーに接続できません。');
        timer = setTimeout(poll, mode === 'live' ? 60_000 : 10_000);
      } finally { if (alive) setLoading(false); }
    }
    void poll();
    return () => { alive = false; controller.abort(); if (timer) clearTimeout(timer); };
  }, [mode, revision]);
  return { data: snapshot?.mode === mode ? snapshot : null, loading, error };
}

function MapFocus({ flight, token }: { flight: Flight | null; token: number }) {
  const map = useMap();
  useEffect(() => {
    if (token > 0 && flight?.latitude !== null && flight?.longitude !== null && flight) {
      map.flyTo([flight.latitude, flight.longitude], 6, { duration: 1.3 });
    }
    // Recenter is explicit; selecting another flight keeps the global view.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, map]);
  return null;
}

function MapSizeSync() {
  const map = useMap();
  useEffect(() => {
    let previousCompact: boolean | undefined;
    const observer = new ResizeObserver(() => {
      map.invalidateSize();
      const compact = map.getSize().x < 620;
      if (compact !== previousCompact && map.getZoom() <= 2) {
        map.setView([28, 10], compact ? .5 : 2, { animate: false });
      }
      previousCompact = compact;
    });
    observer.observe(map.getContainer());
    return () => observer.disconnect();
  }, [map]);
  return null;
}

function HistoryChart({ points, demo }: { points: HistoryPoint[]; demo: boolean }) {
  const width = 600;
  const height = 92;
  const hasTrend = points.length >= 2;
  const values = points.map(point => point.airborne);
  const minimum = Math.min(...values);
  const maximum = Math.max(...values);
  const range = Math.max(1, maximum - minimum);
  const firstTime = points.length ? new Date(points[0].observedAt).getTime() : 0;
  const lastTime = points.length ? new Date(points[points.length - 1].observedAt).getTime() : 0;
  const plot = points.map((point, index) => [
    (lastTime > firstTime ? (new Date(point.observedAt).getTime() - firstTime) / (lastTime - firstTime) : index / Math.max(1, points.length - 1)) * width,
    12 + (1 - (point.airborne - minimum) / range) * (height - 25),
  ]);
  const path = plot.map(([x, y], index) => `${index === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  return <div className="history-chart">
    {hasTrend ? <>
      <svg role="img" aria-label={`${demo ? 'デモ' : '取得した'}飛行中の機数の推移`} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none">
        <defs><linearGradient id="chart-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#67d9ef" stopOpacity=".18" /><stop offset="100%" stopColor="#67d9ef" stopOpacity="0" /></linearGradient></defs>
        <path d={`${path} L${width},${height} L0,${height} Z`} fill="url(#chart-fill)" />
        <path d={path} fill="none" stroke="#67d9ef" strokeWidth="2" vectorEffect="non-scaling-stroke" />
        {plot.length > 0 && <circle cx={plot[plot.length - 1][0]} cy={plot[plot.length - 1][1]} r="3.5" fill="#b6f1fa" />}
      </svg>
      <div className="chart-times"><span>{utcTime(points[0].observedAt, false)} UTC</span><span>{utcTime(points[points.length - 1].observedAt, false)} UTC</span></div>
    </> : <div className="history-empty"><Activity size={22} /><span>観測を蓄積すると、機数の推移が表示されます</span></div>}
  </div>;
}

function DetailCard({ flight, data, now, onClose, onLocate }: {
  flight: Flight | null; data: DashboardResponse | null; now: number; onClose: () => void; onLocate: () => void;
}) {
  if (!flight) return <aside className="detail-card empty-detail" aria-label="フライト詳細">
    <div className="detail-eyebrow"><span className="tiny-dot" /> FLIGHT INSPECTOR</div>
    <div className="empty-plane"><Plane size={38} strokeWidth={1.2} /></div>
    <h3>空の旅を、もっと近くに。</h3>
    <p>地図の飛行機、または一覧から<br />フライトを選択してください。</p>
    <div className="empty-detail-bottom"><MapPin size={14} /> 位置・高度・速度を確認できます</div>
  </aside>;
  const climbing = flight.verticalRateMps !== null && flight.verticalRateMps > .5;
  const descending = flight.verticalRateMps !== null && flight.verticalRateMps < -.5;
  return <aside className="detail-card" aria-label="フライト詳細">
    <div className="detail-topline"><span className="detail-eyebrow"><span className="tiny-dot" /> FLIGHT INSPECTOR</span><button className="icon-button" onClick={onClose} aria-label="フライト詳細を閉じる"><X size={16} /></button></div>
    <div className="flight-title"><div className="flight-symbol"><Plane size={24} /></div><div><h3>{flightName(flight)}</h3><span>{flight.icao24.toUpperCase()} · ICAO24</span></div></div>
    <div className="detail-country"><Globe2 size={14} /><span>{flight.originCountry}</span><span className="flight-state">{flight.onGround ? '地上' : '飛行中'}</span></div>
    <div className="detail-metrics"><div><span>高度</span><strong>{meters(flight.altitudeMeters)} <small>m</small></strong></div><div><span>対地速度</span><strong>{speed(flight.velocityMps)} <small>km/h</small></strong></div></div>
    <dl className="detail-facts">
      <div><dt>地上航跡</dt><dd>{flight.headingDegrees === null ? '—' : `${Math.round(flight.headingDegrees)}°`} <ArrowUpRight size={13} style={{ transform: `rotate(${(flight.headingDegrees ?? 0) - 45}deg)` }} /></dd></div>
      <div><dt>垂直速度</dt><dd>{climbing ? <ArrowUp size={13} /> : descending ? <ArrowDown size={13} /> : <ArrowRight size={13} />}{flight.verticalRateMps === null ? '—' : `${flight.verticalRateMps.toFixed(1)} m/s`}</dd></div>
      <div><dt>緯度 / 経度</dt><dd>{flight.latitude === null || flight.longitude === null ? '未取得' : `${flight.latitude.toFixed(3)} / ${flight.longitude.toFixed(3)}`}</dd></div>
      <div><dt>最終受信</dt><dd>{utcTime(flight.lastContact)} UTC</dd></div>
      <div><dt>受信からの経過</dt><dd>{age(flight.lastContact, now)}</dd></div>
      <div><dt>位置の取得方法</dt><dd>{flight.positionSource}</dd></div>
    </dl>
    <button className="locate-button" onClick={onLocate} disabled={flight.latitude === null || flight.longitude === null}><LocateFixed size={15} /> 地図で位置を確認 <ArrowUpRight size={15} /></button>
    <div className="detail-note"><Radio size={12} /><span>{data?.mode === 'demo' ? 'DEMO · サンプルフライト' : data?.source || 'OpenSky Network'}</span></div>
  </aside>;
}

export default function App() {
  const [mode, setMode] = useState<DataMode>(initialMode);
  const [revision, setRevision] = useState(0);
  const [now, setNow] = useState(Date.now());
  const [query, setQuery] = useState('');
  const [airborneOnly, setAirborneOnly] = useState(true);
  const [sort, setSort] = useState('callsign');
  const [page, setPage] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [focusToken, setFocusToken] = useState(0);
  const [tileError, setTileError] = useState(false);
  const { data, loading, error } = useDashboard(mode, revision);
  const detailRef = useRef<HTMLDivElement>(null);
  const observedAge = data?.observedAt ? now - Date.parse(data.observedAt) : 0;
  const observationExpired = mode === 'live' && data?.status === 'live' && observedAge > 120_000;
  const status = error ? (data && data.status !== 'unavailable' ? 'stale' : 'unavailable') : observationExpired ? 'stale' : data?.status || 'unavailable';
  const usable = data !== null && data.status !== 'unavailable';
  const flights = useMemo(() => usable ? data.flights : [], [data, usable]);
  const selected = flights.find(flight => flight.icao24 === selectedId) || null;
  const searchTerm = query.trim().toLowerCase();
  const filtered = useMemo(() => flights.filter(flight => (!airborneOnly || !flight.onGround) && (!searchTerm || `${flight.callsign} ${flight.icao24} ${flight.originCountry}`.toLowerCase().includes(searchTerm))).sort((a, b) => sort === 'altitude' ? (b.altitudeMeters ?? -1) - (a.altitudeMeters ?? -1) : sort === 'speed' ? (b.velocityMps ?? -1) - (a.velocityMps ?? -1) : flightName(a).localeCompare(flightName(b))), [flights, searchTerm, airborneOnly, sort]);
  const positioned = useMemo(() => filtered.filter(flight => flight.latitude !== null && flight.longitude !== null), [filtered]);
  const mapFlights = useMemo(() => {
    if (positioned.length <= MAP_LIMIT) return positioned;
    const stride = positioned.length / MAP_LIMIT;
    const sample = Array.from({ length: MAP_LIMIT }, (_, index) => positioned[Math.floor(index * stride)]);
    if (selected && !sample.some(flight => flight.icao24 === selected.icao24) && selected.latitude !== null && selected.longitude !== null && positioned.some(flight => flight.icao24 === selected.icao24)) sample[0] = selected;
    return sample;
  }, [positioned, selected]);
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount - 1);
  const rows = filtered.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE);
  const icons = useMemo(() => new Map(mapFlights.map(flight => [flight.icao24, L.divIcon({
    className: `aircraft-marker ${flight.icao24 === selectedId ? 'is-selected' : ''} ${mode === 'demo' ? 'demo-marker' : ''}`,
    html: `<div style="transform:rotate(${flight.headingDegrees ?? 0}deg)">${planeSvg}</div>`,
    iconSize: [23, 23], iconAnchor: [11.5, 11.5],
  })])), [mapFlights, selectedId, mode]);
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, []);
  useEffect(() => { setPage(0); }, [query, airborneOnly, sort, mode]);
  useEffect(() => { setSelectedId(null); try { localStorage.setItem('skytrace-mode', mode); } catch { /* Storage may be restricted. */ } }, [mode]);
  function selectFlight(id: string) {
    setSelectedId(id);
    if (window.innerWidth <= 900) setTimeout(() => detailRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 20);
  }
  function changeMode(next: DataMode) { if (next !== mode) { setMode(next); setQuery(''); } }
  const statusLabel = loading && !data ? '接続中' : status === 'live' ? 'ライブ受信中' : status === 'demo' ? 'デモデータ' : status === 'stale' ? '最終取得データ' : '受信できません';
  const statValue = (value: number | null | undefined) => usable && value !== undefined && value !== null ? number.format(value) : '—';
  const refreshIn = data?.nextRefreshAt ? Math.max(0, Math.ceil((new Date(data.nextRefreshAt).getTime() - now) / 1000)) : null;

  return <div className="app-shell">
    <header className="site-header"><a className="brand" href="#" aria-label="SKYTRACE ホーム"><span className="brand-mark"><Plane size={22} strokeWidth={2.2} /></span><span>SKY<span className="brand-light">TRACE</span></span><span className="brand-beta">BETA</span></a>
      <nav aria-label="メインナビゲーション"><a href="#live-map" className="nav-active">ライブマップ</a><a href="#flight-list">フライト一覧 <ArrowUpRight size={12} /></a></nav>
      <div className="header-right"><div className="utc-clock"><Clock3 size={13} /><span>{utcTime(now)}</span><small>UTC</small></div><span className="header-divider" /><a className="about-link" href="https://opensky-network.org" target="_blank" rel="noreferrer">DATA BY OPENSKY <ArrowUpRight size={12} /></a></div>
    </header>

    <main>
      <section className="page-heading"><div><div className="eyebrow"><span className="tiny-dot" /> THE WORLD, IN FLIGHT</div><h1>世界の空を、いま。</h1><p>飛行中の航空機を観測して、世界の動きをひと目で。</p></div>
        <div className="heading-controls"><div className="mode-switch" role="group" aria-label="データモード"><button aria-pressed={mode === 'live'} className={mode === 'live' ? 'active' : ''} onClick={() => changeMode('live')}><Radio size={14} /> ライブ</button><button aria-pressed={mode === 'demo'} className={mode === 'demo' ? 'active' : ''} onClick={() => changeMode('demo')}>デモ</button></div><div className={`connection-status ${status}`} role="status"><span className="status-dot" />{statusLabel}</div></div>
      </section>

      {mode === 'demo' && <div className="demo-banner"><span><ShieldCheck size={16} /><strong>デモモード</strong> 表示中の機数・位置・機体情報はサンプルです。実際の航空状況ではありません。</span><button onClick={() => changeMode('live')}>ライブに切り替え <ArrowRight size={14} /></button></div>}
      {!loading && status === 'unavailable' && <div className="error-banner" role="status"><div><Signal size={19} /><span><strong>{mode === 'live' ? 'ライブ' : 'デモ'}データを取得できませんでした</strong><small>{error || data?.message || '接続状況を確認して、再取得してください。'}</small></span></div><div className="banner-actions"><button className="text-button" onClick={() => setRevision(value => value + 1)}><RefreshCw size={14} /> 再取得</button>{mode === 'live' && <button className="small-primary" onClick={() => changeMode('demo')}>デモを体験 <ArrowRight size={14} /></button>}</div></div>}
      {status === 'stale' && <div className="stale-banner" role="status"><Clock3 size={16} /><span>{data?.observedAt ? `${utcTime(data.observedAt)} UTC の` : '最後に取得した'}観測データを表示しています。{error || data?.message || '次回更新まで保存済みの観測データを表示しています。'}</span><button className="text-button" onClick={() => setRevision(value => value + 1)}>再取得</button></div>}

      <section className="stats-grid" aria-label="観測統計">
        <article className="stat-card primary-stat"><div className="stat-label"><span>観測中の航空機</span><Plane size={16} /></div><div className="stat-number">{statValue(data?.stats.airborne)}<span>機</span></div><div className="stat-caption"><span className="tiny-dot" />{mode === 'demo' ? 'サンプルの飛行中機数' : 'データソースが観測した飛行中の機数'}</div><div className="stat-decoration"><Plane size={76} strokeWidth={.6} /></div></article>
        <article className="stat-card"><div className="stat-label"><span>位置を取得した機体</span><MapPin size={16} /></div><div className="stat-number">{statValue(data?.stats.withPosition)}<span>機</span></div><div className="stat-caption">位置情報のある観測機体</div></article>
        <article className="stat-card"><div className="stat-label"><span>機体の登録国（推定）</span><Globe2 size={16} /></div><div className="stat-number">{statValue(data?.stats.countries)}<span>か国</span></div><div className="stat-caption">飛行中の機体の登録国数</div></article>
        <article className="stat-card"><div className="stat-label"><span>平均高度</span><Wind size={16} /></div><div className="stat-number">{usable ? meters(data?.stats.avgAltitudeMeters ?? null) : '—'}<span>m</span></div><div className="stat-caption">高度情報のある飛行中機体の平均</div></article>
      </section>

      <section className="map-section" id="live-map" aria-label="世界のフライトマップ">
        <div className="panel-heading"><div className="section-title"><Globe2 size={17} /><h2>グローバル・フライトマップ</h2><span className="section-tag">{mode === 'demo' ? 'DEMO' : 'LIVE MAP'}</span></div><button className="text-button refresh-button" onClick={() => setRevision(value => value + 1)} disabled={loading}><RefreshCw size={13} className={loading ? 'spinning' : ''} /><span>{loading ? '取得中' : 'データを更新'}</span></button></div>
        <div className="map-and-detail"><div className="map-frame">
          <MapContainer center={[28, 10]} zoom={2} minZoom={0} maxZoom={12} zoomSnap={.5} zoomControl={false} scrollWheelZoom={false} worldCopyJump attributionControl className="flight-map">
            <Pane name="offline-land" style={{ zIndex: 190 }}>
              <GeoJSON data={worldLand} pane="offline-land" interactive={false} style={{ color: '#2c475a', weight: .7, fillColor: '#182e40', fillOpacity: .8 }} attribution='<a href="https://www.naturalearthdata.com/">Natural Earth</a>' />
            </Pane>
            <TileLayer url="https://basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png" attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>' eventHandlers={{ tileerror: () => setTileError(true) }} />
            <ZoomControl position="bottomleft" /><MapSizeSync /><MapFocus flight={selected} token={focusToken} />
            {mapFlights.map(flight => <Marker key={flight.icao24} position={[flight.latitude!, flight.longitude!]} icon={icons.get(flight.icao24)} title={`${flightName(flight)} · ${flight.originCountry}`} alt={flightName(flight)} eventHandlers={{ click: () => selectFlight(flight.icao24) }} />)}
          </MapContainer>
          <div className="map-label"><span className="status-dot" /><span>{mode === 'demo' ? 'DEMO AIRSPACE' : 'GLOBAL AIRSPACE'}</span><strong>{number.format(mapFlights.length)} <small>機を表示</small></strong></div>
          {loading && !usable && <div className="map-message"><div className="radar-loader"><Radio size={27} /></div><strong>空の状況を取得しています</strong><span>世界の航空機データに接続中</span></div>}
          {!loading && !usable && <div className="map-message"><div className="radar-loader offline"><Globe2 size={30} /></div><strong>世界の空へ、接続待ち。</strong><span>データを受信すると、飛行機がここに表示されます。</span>{mode === 'live' && <button className="small-primary" onClick={() => changeMode('demo')}>デモでマップを見る <ArrowRight size={14} /></button>}</div>}
          {usable && filtered.length === 0 && <div className="map-message compact"><Search size={23} /><strong>一致する機体がありません</strong><span>検索条件を変更してください</span></div>}
          {tileError && <div className="tile-error"><MapPin size={12} />詳細な地図を取得できません。簡易地図で表示しています。</div>}
          <div className="map-legend"><span className="legend-plane"><Plane size={13} /></span> 飛行機<span className="legend-dot" /> 選択中<span className="map-scroll-hint"><Maximize2 size={12} /> ドラッグで移動 / ＋−で拡大</span></div>
        </div><div ref={detailRef} className="detail-wrapper"><DetailCard flight={selected} data={data} now={now} onClose={() => setSelectedId(null)} onLocate={() => setFocusToken(value => value + 1)} /></div></div>
        <div className="map-bottom"><div><span className="tiny-dot" /><span>{data?.observedAt ? `観測時刻 ${utcTime(data.observedAt)} UTC` : '観測データ未取得'}</span><span className="bottom-divider">/</span><span>取得 {data?.fetchedAt ? utcTime(data.fetchedAt) : '—'} UTC</span></div><span>{positioned.length > MAP_LIMIT ? `地図は最大 ${number.format(MAP_LIMIT)} 機を間引いて表示` : '飛行機をクリックして詳細を表示'}{refreshIn !== null && status !== 'unavailable' ? ` · 次回更新 ${refreshIn}秒` : ''}</span></div>
      </section>

      <section className="lower-grid">
        <article className="trend-panel"><div className="panel-heading"><div><span className="mini-eyebrow">AIR TRAFFIC TREND</span><h2>飛行中の機数の推移</h2></div><span className="subtle-tag">{mode === 'demo' ? 'DEMO HISTORY' : 'OBSERVED HISTORY'}</span></div><HistoryChart points={usable ? data.history : []} demo={mode === 'demo'} /><div className="trend-footnote">{mode === 'demo' ? 'デモの観測履歴を表示しています。' : '取得した観測の値を線で結んでいます。'}</div></article>
        <article className="coverage-panel"><div className="coverage-icon"><Globe2 size={22} strokeWidth={1.3} /></div><div><span className="mini-eyebrow">A CLEAR VIEW OF THE SKY</span><h2>見えている空を、正しく。</h2><p>{data?.coverageNote || '表示する機数はデータソースが受信した機体の数です。世界中のすべての航空機を網羅するものではありません。'}</p><span className="coverage-source"><Check size={12} />{mode === 'demo' ? '生成サンプル / 実測値ではありません' : 'OpenSky Network / 受信範囲に依存'}</span></div></article>
      </section>

      <section className="flights-panel" id="flight-list" aria-label="フライト一覧"><div className="panel-heading list-heading"><div className="section-title"><Plane size={17} /><h2>フライト一覧</h2><span className="list-count">{number.format(filtered.length)}</span></div><span className="list-subtitle">気になるフライトを見つけよう</span></div>
        <div className="list-toolbar"><div className="search-field"><Search size={16} /><input aria-label="フライトを検索" placeholder="便名・ICAO・登録国で検索" value={query} onChange={event => setQuery(event.target.value)} />{query && <button className="icon-button" onClick={() => setQuery('')} aria-label="検索をクリア"><X size={14} /></button>}</div><div className="list-filters"><div className="filter-switch" role="group" aria-label="飛行状態の絞り込み"><button className={airborneOnly ? 'active' : ''} aria-pressed={airborneOnly} onClick={() => setAirborneOnly(true)}>飛行中</button><button className={!airborneOnly ? 'active' : ''} aria-pressed={!airborneOnly} onClick={() => setAirborneOnly(false)}>すべて</button></div><label className="sort-select"><SlidersHorizontal size={14} /><select aria-label="並び順" value={sort} onChange={event => setSort(event.target.value)}><option value="callsign">便名順</option><option value="altitude">高度が高い順</option><option value="speed">速度が速い順</option></select></label></div></div>
        <div className="table-wrap"><table><thead><tr><th>フライト / ICAO24</th><th>登録国（推定）</th><th>高度 <span>m</span></th><th>対地速度 <span>km/h</span></th><th>地上航跡</th><th>受信状況</th><th><span className="sr-only">詳細</span></th></tr></thead><tbody>{rows.map(flight => <tr key={flight.icao24} className={selectedId === flight.icao24 ? 'selected-row' : ''} onClick={() => selectFlight(flight.icao24)}><td><button className="flight-row-button" onClick={() => selectFlight(flight.icao24)} aria-label={`${flightName(flight)} の詳細を表示`}><span className="row-plane"><Plane size={16} /></span><span><strong>{flightName(flight)}</strong><small>{flight.icao24.toUpperCase()}</small></span></button></td><td><span className="country-label">{flight.originCountry}</span></td><td className="numeric">{meters(flight.altitudeMeters)}</td><td className="numeric">{speed(flight.velocityMps)}</td><td className="numeric heading-value">{flight.headingDegrees === null ? '—' : `${Math.round(flight.headingDegrees)}°`}<ArrowUpRight size={12} style={{ transform: `rotate(${(flight.headingDegrees ?? 0) - 45}deg)` }} /></td><td><span className={`contact-status ${flight.onGround ? 'ground' : ''}`}><span />{age(flight.lastContact, now)}</span></td><td><ChevronRight size={15} className="row-chevron" /></td></tr>)}</tbody></table>
          {rows.length === 0 && <div className="table-empty"><Search size={24} /><strong>{loading ? 'フライトを取得しています' : usable ? '一致するフライトがありません' : 'まだフライトデータがありません'}</strong><span>{usable ? '便名や登録国で検索してみてください。' : 'ライブデータの接続を確認するか、デモモードをお試しください。'}</span></div>}
        </div>
        <div className="table-footer"><span>{filtered.length ? `${number.format(currentPage * PAGE_SIZE + 1)}–${number.format(Math.min((currentPage + 1) * PAGE_SIZE, filtered.length))} / ${number.format(filtered.length)} 機` : '0 機'}<span className="table-mode-note">{mode === 'demo' ? 'デモデータ' : '観測データ'}</span></span><div className="pagination"><button aria-label="前のページ" onClick={() => setPage(currentPage - 1)} disabled={currentPage === 0}><ChevronLeft size={16} /></button><span>{currentPage + 1} <small>/ {pageCount}</small></span><button aria-label="次のページ" onClick={() => setPage(currentPage + 1)} disabled={currentPage >= pageCount - 1}><ChevronRight size={16} /></button></div></div>
      </section>
    </main>
    <footer><div className="footer-brand"><Plane size={14} /><span>SKYTRACE</span><span className="footer-divider" /> <span>空を知る、新しい視点。</span></div><span>観測データ： <a href="https://opensky-network.org" target="_blank" rel="noreferrer">OpenSky Network <ArrowUpRight size={11} /></a></span></footer>
  </div>;
}
