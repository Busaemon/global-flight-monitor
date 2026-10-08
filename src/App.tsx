import { Component, lazy, Suspense, useCallback, useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { Activity, ArrowDown, ArrowRight, ArrowUp, ArrowUpRight, Check, ChevronLeft, ChevronRight, Clock3, Globe2, LocateFixed, MapPin, Plane, Radio, RefreshCw, Search, ShieldCheck, Signal, SlidersHorizontal, Wind, X } from 'lucide-react';
import type { DashboardSummaryResponse, DataMode, Flight, FlightDetailResponse, FlightListResponse, FlightSort, HistoryPoint } from '../shared/types';
import AppExperience from './components/AppExperience';
import { useApiResource, useDebouncedValue } from './hooks/useApiResource';

const FlightMap = lazy(() => import('./components/FlightMap'));
const number = new Intl.NumberFormat('ja-JP');
const PAGE_SIZE = 8;
function utcTime(value: string | number | null, seconds = true) {
  if (value === null) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleTimeString('en-GB', { timeZone: 'UTC', hour: '2-digit', minute: '2-digit', ...(seconds ? { second: '2-digit' } : {}) });
}
function flightName(flight: Flight) { return flight.callsign || flight.icao24.toUpperCase(); }
function meters(value: number | null) { return value === null ? '—' : number.format(Math.round(value)); }
function speed(value: number | null) { return value === null ? '—' : number.format(Math.round(value * 3.6)); }
function age(value: string | null, now: number) {
  if (!value) return '—';
  const seconds = Math.max(0, Math.round((now - new Date(value).getTime()) / 1000));
  if (!Number.isFinite(seconds)) return '—';
  return seconds < 60 ? `${seconds}秒前` : seconds < 3600 ? `${Math.floor(seconds / 60)}分前` : `${Math.floor(seconds / 3600)}時間前`;
}
function initialMode(): DataMode { return new URLSearchParams(window.location.search).get('mode') === 'demo' ? 'demo' : 'live'; }

function UtcClock() {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    function tick() { if (!document.hidden) setNow(Date.now()); }
    const timer = setInterval(tick, 1000);
    document.addEventListener('visibilitychange', tick);
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', tick); };
  }, []);
  return <div className="utc-clock" aria-label="協定世界時"><Clock3 size={15} /><span>{utcTime(now)}</span><small>UTC</small></div>;
}

class MapBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    return this.state.failed ? <div className="map-frame map-fallback"><Globe2 size={28} /><h3>地図を読み込めませんでした</h3><p>フライト一覧は引き続き使えます。接続を確認してページを再読み込みしてください。</p><button className="secondary-button" onClick={() => window.location.reload()}>ページを再読み込み</button></div> : this.props.children;
  }
}

function HistoryChart({ points, demo }: { points: HistoryPoint[]; demo: boolean }) {
  const width = 600, height = 92;
  const values = points.map(point => point.airborne);
  const minimum = Math.min(...values), maximum = Math.max(...values), range = Math.max(1, maximum - minimum);
  const firstTime = points.length ? Date.parse(points[0].observedAt) : 0;
  const lastTime = points.length ? Date.parse(points[points.length - 1].observedAt) : 0;
  const plot = points.map((point, index) => [(lastTime > firstTime ? (Date.parse(point.observedAt) - firstTime) / (lastTime - firstTime) : index / Math.max(1, points.length - 1)) * width, 12 + (1 - (point.airborne - minimum) / range) * (height - 25)]);
  const path = plot.map(([x, y], index) => `${index === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  return <div className="history-chart">{points.length >= 2 ? <><svg role="img" aria-label={`${demo ? 'デモ' : '取得した'}飛行中の機数の推移。最少${number.format(minimum)}機、最多${number.format(maximum)}機。`} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none"><defs><linearGradient id="chart-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#67d9ef" stopOpacity=".18" /><stop offset="100%" stopColor="#67d9ef" stopOpacity="0" /></linearGradient></defs><path d={`${path} L${width},${height} L0,${height} Z`} fill="url(#chart-fill)" /><path d={path} fill="none" stroke="#67d9ef" strokeWidth="2" vectorEffect="non-scaling-stroke" /></svg><div className="chart-times"><span>{utcTime(points[0].observedAt, false)} UTC</span><span>{utcTime(points[points.length - 1].observedAt, false)} UTC</span></div></> : <div className="history-empty"><Activity size={22} /><span>観測を蓄積すると、機数の推移が表示されます</span></div>}</div>;
}

function DetailCard({ flight, source, mode, loading, error, selectedId, now, onClose, onLocate, onRetry, headingRef }: {
  flight: Flight | null; source: string | null; mode: DataMode; loading: boolean; error: string | null; selectedId: string | null;
  now: number; onClose: () => void; onLocate: () => void; onRetry: () => void; headingRef: RefObject<HTMLHeadingElement | null>;
}) {
  if (!selectedId) return <aside className="detail-card empty-detail" aria-label="フライト詳細"><div className="detail-eyebrow"><span className="tiny-dot" /> FLIGHT INSPECTOR</div><div className="empty-plane"><Plane size={38} strokeWidth={1.2} /></div><h3>空の旅を、もっと近くに。</h3><p>地図の機体、またはフライト一覧から<br />フライトを選択してください。</p><div className="empty-detail-bottom"><MapPin size={16} /> 位置・高度・速度を確認できます</div></aside>;
  if (!flight) return <aside className="detail-card detail-pending" aria-label="フライト詳細" aria-busy={loading}><div className="detail-topline"><h3 ref={headingRef} tabIndex={-1}>フライト詳細</h3><button className="icon-button" onClick={onClose} aria-label="フライト詳細を閉じる"><X size={20} /></button></div><p role="status">{loading ? '機体の情報を取得しています。' : error || '機体の情報がありません。'}</p>{!loading && <button className="secondary-button" onClick={onRetry}><RefreshCw size={16} /> 詳細を再取得</button>}</aside>;
  const climbing = flight.verticalRateMps !== null && flight.verticalRateMps > .5;
  const descending = flight.verticalRateMps !== null && flight.verticalRateMps < -.5;
  return <aside className="detail-card" aria-label="フライト詳細" aria-busy={loading}>
    <div className="detail-topline"><span className="detail-eyebrow"><span className="tiny-dot" /> FLIGHT INSPECTOR</span><button className="icon-button" onClick={onClose} aria-label="フライト詳細を閉じる"><X size={20} /></button></div>
    <div className="flight-title"><div className="flight-symbol"><Plane size={24} /></div><div><h3 ref={headingRef} tabIndex={-1}>{flightName(flight)}</h3><span>{flight.icao24.toUpperCase()} · ICAO24</span></div></div>
    <div className="detail-country"><Globe2 size={16} /><span>{flight.originCountry}</span><span className="flight-state">{flight.onGround ? '地上' : '飛行中'}</span></div>
    <div className="detail-metrics"><div><span>高度</span><strong>{meters(flight.altitudeMeters)} <small>m</small></strong></div><div><span>対地速度</span><strong>{speed(flight.velocityMps)} <small>km/h</small></strong></div></div>
    <dl className="detail-facts"><div><dt>地上航跡</dt><dd>{flight.headingDegrees === null ? '—' : `${Math.round(flight.headingDegrees)}°`}<ArrowUpRight size={14} style={{ transform: `rotate(${(flight.headingDegrees ?? 0) - 45}deg)` }} /></dd></div><div><dt>垂直速度</dt><dd>{climbing ? <ArrowUp size={14} /> : descending ? <ArrowDown size={14} /> : <ArrowRight size={14} />}{flight.verticalRateMps === null ? '—' : `${flight.verticalRateMps.toFixed(1)} m/s`}</dd></div><div><dt>緯度 / 経度</dt><dd>{flight.latitude === null || flight.longitude === null ? '未取得' : `${flight.latitude.toFixed(3)} / ${flight.longitude.toFixed(3)}`}</dd></div><div><dt>最終受信</dt><dd>{utcTime(flight.lastContact)} UTC</dd></div><div><dt>受信からの経過</dt><dd>{age(flight.lastContact, now)}</dd></div><div><dt>位置の取得方法</dt><dd>{flight.positionSource}</dd></div></dl>
    <button className="locate-button" onClick={onLocate} disabled={flight.latitude === null || flight.longitude === null}><LocateFixed size={18} /> 地図で位置を確認 <ArrowUpRight size={16} /></button><div className="detail-note"><Radio size={14} /><span>{mode === 'demo' ? 'DEMO · サンプルフライト' : source || 'OpenSky Network'}</span></div>
    {error && <p className="detail-error" role="status">最新の詳細を取得できません。前回の情報を表示しています。<button onClick={onRetry}>再取得</button></p>}
  </aside>;
}

export default function App() {
  const [mode, setMode] = useState<DataMode>(initialMode);
  const [revision, setRevision] = useState(0);
  const [now, setNow] = useState(Date.now());
  const [query, setQuery] = useState('');
  const debouncedQuery = useDebouncedValue(query.trim());
  const [sort, setSort] = useState<FlightSort>('callsign');
  const [page, setPage] = useState(1);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detailRevision, setDetailRevision] = useState(0);
  const [focusToken, setFocusToken] = useState(0);
  const [mapVisible, setMapVisible] = useState(false);
  const mapHostRef = useRef<HTMLDivElement>(null);
  const detailRef = useRef<HTMLDivElement>(null);
  const detailHeadingRef = useRef<HTMLHeadingElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const focusedIdRef = useRef<string | null>(null);
  const summary = useApiResource<DashboardSummaryResponse>(`/api/summary?mode=${mode}`, mode, revision, mode === 'demo' ? 10_000 : 30_000);
  const data = summary.data;
  const listParams = new URLSearchParams({ mode, q: debouncedQuery, sort, page: String(page), limit: String(PAGE_SIZE) });
  const dataRevision = `${revision}:${data?.fetchedAt ?? ''}`;
  const list = useApiResource<FlightListResponse>(`/api/flights?${listParams}`, mode, dataRevision);
  const detail = useApiResource<FlightDetailResponse>(selectedId ? `/api/flights/${selectedId}?mode=${mode}` : null, mode, `${dataRevision}:${detailRevision}`);
  const selected = detail.data?.flight ?? null;
  const usable = data !== null && data.status !== 'unavailable';
  const observationExpired = mode === 'live' && data?.status === 'live' && data.observedAt !== null && now - Date.parse(data.observedAt) > 120_000;
  const status = summary.error ? (usable ? 'stale' : 'unavailable') : observationExpired ? 'stale' : data?.status || 'unavailable';
  const rows = list.data?.flights ?? [], total = list.data?.total ?? 0;
  const currentPage = list.data?.page ?? page, pageCount = Math.max(1, list.data?.pageCount ?? 1);
  const statusLabel = summary.loading && !data ? '接続中' : status === 'live' ? 'ライブ受信中' : status === 'demo' ? 'デモデータ' : status === 'stale' ? '最終取得データ' : '受信できません';
  const statValue = (value: number | null | undefined) => usable && value !== undefined && value !== null ? number.format(value) : '—';
  const refreshIn = data?.nextRefreshAt ? Math.max(0, Math.ceil((Date.parse(data.nextRefreshAt) - now) / 1000)) : null;
  useEffect(() => {
    function tick() { if (!document.hidden) setNow(Date.now()); }
    const timer = setInterval(tick, 5_000);
    document.addEventListener('visibilitychange', tick);
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', tick); };
  }, []);
  useEffect(() => {
    const host = mapHostRef.current;
    if (!host) return;
    const observer = new IntersectionObserver(entries => { if (entries.some(entry => entry.isIntersecting)) { setMapVisible(true); observer.disconnect(); } }, { rootMargin: '100px' });
    observer.observe(host);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (selected && selectedId !== focusedIdRef.current) {
      detailHeadingRef.current?.focus({ preventScroll: true });
      focusedIdRef.current = selectedId;
      if (window.innerWidth <= 900) detailRef.current?.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'nearest' });
    }
  }, [selected, selectedId]);
  const closeDetail = useCallback(() => { setSelectedId(null); focusedIdRef.current = null; if (returnFocusRef.current?.isConnected) returnFocusRef.current.focus({ preventScroll: true }); }, []);
  useEffect(() => {
    function closeOnEscape(event: KeyboardEvent) { if (event.key === 'Escape' && detailRef.current?.contains(document.activeElement)) { event.preventDefault(); closeDetail(); } }
    document.addEventListener('keydown', closeOnEscape);
    return () => document.removeEventListener('keydown', closeOnEscape);
  }, [closeDetail]);
  const selectFlight = useCallback((id: string) => { returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null; focusedIdRef.current = null; setSelectedId(id); }, []);
  function changeMode(next: DataMode) {
    if (next === mode) return;
    setSelectedId(null); setQuery(''); setPage(1); setMode(next); focusedIdRef.current = null;
    const url = new URL(window.location.href);
    if (next === 'demo') url.searchParams.set('mode', 'demo'); else url.searchParams.delete('mode');
    window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
  }
  function refresh() { setRevision(value => value + 1); }
  function locate() {
    setMapVisible(true); setFocusToken(value => value + 1);
    mapHostRef.current?.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'center' });
  }
  return <div className="app-shell">
    <a className="skip-link" href="#main-content">メインコンテンツへスキップ</a>
    <header className="site-header"><a className="brand" href="#main-content" aria-label="SKYTRACE ホーム"><span className="brand-mark"><Plane size={24} strokeWidth={2.2} /></span><span>SKY<span className="brand-light">TRACE</span></span></a><nav aria-label="メインナビゲーション"><a href="#live-map">ライブマップ</a><a href="#flight-list">フライト一覧 <ArrowUpRight size={14} /></a></nav><div className="header-right"><UtcClock /><a className="about-link" href="https://opensky-network.org" target="_blank" rel="noreferrer">DATA BY OPENSKY <ArrowUpRight size={14} /></a></div></header>
    <AppExperience />
    <main id="main-content" tabIndex={-1}>
      <section className="page-heading" aria-labelledby="page-title"><div><div className="eyebrow"><span className="tiny-dot" /> THE WORLD, IN FLIGHT</div><h1 id="page-title">世界の空を、いま。</h1><p>観測された航空機の動きを、PCでもスマートフォンでも。</p></div><div className="heading-controls"><div className="mode-switch" role="group" aria-label="データモード"><button aria-pressed={mode === 'live'} className={mode === 'live' ? 'active' : ''} onClick={() => changeMode('live')}><Radio size={16} /> ライブ</button><button aria-pressed={mode === 'demo'} className={mode === 'demo' ? 'active' : ''} onClick={() => changeMode('demo')}>デモ</button></div><div className={`connection-status ${status}`} role="status"><span className="status-dot" />{statusLabel}</div></div></section>
      {mode === 'demo' && <div className="demo-banner"><span><ShieldCheck size={18} /><strong>デモモード</strong>機数・位置・機体情報はサンプルです。実際の航空状況ではありません。</span><button onClick={() => changeMode('live')}>ライブに切り替え <ArrowRight size={16} /></button></div>}
      {!summary.loading && status === 'unavailable' && <div className="error-banner" role="status"><div><Signal size={22} /><span><strong>{mode === 'live' ? 'ライブ' : 'デモ'}データを取得できませんでした</strong><small>{summary.error || data?.message || '接続状況を確認して、再取得してください。'}</small></span></div><div className="banner-actions"><button className="text-button" onClick={refresh}><RefreshCw size={16} /> 再取得</button>{mode === 'live' && <button className="small-primary" onClick={() => changeMode('demo')}>デモを体験 <ArrowRight size={16} /></button>}</div></div>}
      {status === 'stale' && <div className="stale-banner" role="status"><Clock3 size={18} /><span>{data?.observedAt ? `${utcTime(data.observedAt)} UTC の` : '最後に取得した'}観測データを表示しています。{summary.error || data?.message || '更新待ちのため、現在の位置とは異なる可能性があります。'}</span><button className="text-button" onClick={refresh}>再取得</button></div>}
      <section className="stats-grid" aria-label="観測統計">
        <article className="stat-card primary-stat"><div className="stat-label"><span>観測中の航空機</span><Plane size={18} /></div><div className="stat-number">{statValue(data?.stats.airborne)}<span>機</span></div><div className="stat-caption"><span className="tiny-dot" />{mode === 'demo' ? 'サンプルの飛行中機数' : '受信範囲内の飛行中機数'}</div><div className="stat-decoration"><Plane size={76} strokeWidth={.6} /></div></article>
        <article className="stat-card"><div className="stat-label"><span>位置を取得した機体</span><MapPin size={18} /></div><div className="stat-number">{statValue(data?.stats.withPosition)}<span>機</span></div><div className="stat-caption">位置情報のある観測機体</div></article>
        <article className="stat-card"><div className="stat-label"><span>機体の登録国（推定）</span><Globe2 size={18} /></div><div className="stat-number">{statValue(data?.stats.countries)}<span>か国</span></div><div className="stat-caption">飛行中の機体の登録国数</div></article>
        <article className="stat-card"><div className="stat-label"><span>平均高度</span><Wind size={18} /></div><div className="stat-number">{usable ? meters(data?.stats.avgAltitudeMeters ?? null) : '—'}<span>m</span></div><div className="stat-caption">高度情報のある機体の平均</div></article>
      </section>
      <section className="map-section" id="live-map" aria-label="世界のフライトマップ"><div className="panel-heading"><div className="section-title"><Globe2 size={20} /><h2>グローバル・フライトマップ</h2></div><button className="text-button refresh-button" onClick={refresh} disabled={summary.loading}><RefreshCw size={16} className={summary.loading ? 'spinning' : ''} /><span>{summary.loading ? '取得中' : 'データを更新'}</span></button></div>
        <div className="map-and-detail"><div className="map-host" ref={mapHostRef}><MapBoundary><Suspense fallback={<div className="map-frame map-fallback"><Globe2 size={28} /><p>地図を読み込んでいます。</p></div>}>{mapVisible ? <FlightMap mode={mode} query={debouncedQuery} revision={dataRevision} selectedId={selectedId} selected={selected} focusToken={focusToken} onSelect={selectFlight} /> : <div className="map-frame map-fallback"><Globe2 size={28} /><button className="secondary-button" onClick={() => setMapVisible(true)}>地図を開く</button></div>}</Suspense></MapBoundary></div><div ref={detailRef} className="detail-wrapper"><DetailCard flight={selected} source={detail.data?.source ?? null} mode={mode} loading={detail.loading} error={detail.error} selectedId={selectedId} now={now} onClose={closeDetail} onLocate={locate} onRetry={() => setDetailRevision(value => value + 1)} headingRef={detailHeadingRef} /></div></div>
        <div className="map-bottom"><div><span className="tiny-dot" /><span>{data?.observedAt ? `観測時刻 ${utcTime(data.observedAt)} UTC` : '観測データ未取得'}</span><span>取得 {data?.fetchedAt ? utcTime(data.fetchedAt) : '—'} UTC</span></div><span>表示範囲に応じて機体を間引いて表示{refreshIn !== null && status !== 'unavailable' ? ` · 次回取得まで約${refreshIn}秒` : ''}</span></div>
      </section>
      <section className="lower-grid" aria-label="観測履歴とデータの範囲"><article className="trend-panel"><div className="panel-heading"><div><span className="mini-eyebrow">AIR TRAFFIC TREND</span><h2>飛行中の機数の推移</h2></div><span className="subtle-tag">{mode === 'demo' ? 'DEMO' : 'OBSERVED'}</span></div><HistoryChart points={usable ? data.history : []} demo={mode === 'demo'} /><div className="trend-footnote">{mode === 'demo' ? 'デモの観測履歴です。' : '取得した観測値を線で結んでいます。'}</div></article><article className="coverage-panel"><div className="coverage-icon"><Globe2 size={26} strokeWidth={1.3} /></div><div><span className="mini-eyebrow">A CLEAR VIEW OF THE SKY</span><h2>見えている空を、正しく。</h2><p>{data?.coverageNote || '機数はデータソースが受信した機体の数です。世界中のすべての航空機を網羅するものではありません。'}</p><span className="coverage-source"><Check size={16} />{mode === 'demo' ? '生成サンプル / 実測値ではありません' : 'OpenSky Network / 受信範囲に依存'}</span></div></article></section>
      <section className="flights-panel" id="flight-list" aria-label="フライト一覧"><div className="panel-heading list-heading"><div className="section-title"><Plane size={20} /><h2>フライト一覧</h2><span className="list-count">{number.format(total)}</span></div><span className="list-subtitle">一覧のボタンから詳細を確認</span></div>
        <div className="list-toolbar"><div className="search-field"><Search size={18} /><input aria-label="フライトを検索" placeholder="便名・ICAO・登録国で検索" value={query} maxLength={80} onChange={event => { setQuery(event.target.value); setPage(1); }} autoComplete="off" spellCheck={false} />{query && <button className="icon-button" onClick={() => { setQuery(''); setPage(1); }} aria-label="検索をクリア"><X size={18} /></button>}</div><label className="sort-select"><SlidersHorizontal size={16} /><select aria-label="並び順" value={sort} onChange={event => { setSort(event.target.value as FlightSort); setPage(1); }}><option value="callsign">便名順</option><option value="altitude">高度が高い順</option><option value="speed">速度が速い順</option></select></label></div>
        <div className="list-announcement sr-only" role="status">{list.loading || query.trim() !== debouncedQuery ? 'フライトを検索しています。' : `${total}機のフライトが見つかりました。${currentPage}ページ目を表示しています。`}</div>
        {list.error && <div className="list-error" role="status"><span>{list.error}{list.data ? ' 前回の一覧を表示しています。' : ''}</span><button className="text-button" onClick={refresh}>一覧を再取得</button></div>}
        <div className="table-wrap" aria-busy={list.loading}><table><caption className="sr-only">観測されたフライト。便名のボタンを押すと詳細が開きます。</caption><thead><tr><th scope="col">フライト / ICAO24</th><th scope="col" className="country-column">登録国（推定）</th><th scope="col">高度 <span>m</span></th><th scope="col">対地速度 <span>km/h</span></th><th scope="col" className="heading-column">地上航跡</th><th scope="col" className="contact-column">最終受信</th></tr></thead><tbody>{rows.map(flight => <tr key={flight.icao24} className={selectedId === flight.icao24 ? 'selected-row' : ''}><td><button className="flight-row-button" onClick={() => selectFlight(flight.icao24)} aria-label={`${flightName(flight)} の詳細を表示`} aria-pressed={selectedId === flight.icao24}><span className="row-plane"><Plane size={18} /></span><span><strong>{flightName(flight)}</strong><small>{flight.icao24.toUpperCase()}<span className="mobile-country"> · {flight.originCountry}</span></small></span><ChevronRight size={16} className="row-chevron" /></button></td><td className="country-column"><span className="country-label">{flight.originCountry}</span></td><td className="numeric">{meters(flight.altitudeMeters)}</td><td className="numeric">{speed(flight.velocityMps)}</td><td className="numeric heading-column">{flight.headingDegrees === null ? '—' : `${Math.round(flight.headingDegrees)}°`}</td><td className="contact-column">{utcTime(flight.lastContact, false)} UTC</td></tr>)}</tbody></table>{rows.length === 0 && <div className="table-empty"><Search size={26} /><strong>{list.loading ? 'フライトを取得しています' : debouncedQuery ? '一致するフライトがありません' : 'まだフライトデータがありません'}</strong><span>{debouncedQuery ? '便名や登録国を変更してみてください。' : '接続と観測状況を確認してください。'}</span></div>}</div>
        <div className="table-footer"><span>{total ? `${number.format((currentPage - 1) * PAGE_SIZE + 1)}–${number.format(Math.min(currentPage * PAGE_SIZE, total))} / ${number.format(total)} 機` : '0 機'}<span className="table-mode-note">{mode === 'demo' ? 'デモデータ' : '観測データ'}</span></span><nav className="pagination" aria-label="フライト一覧のページ"><button aria-label="前のページ" onClick={() => setPage(currentPage - 1)} disabled={currentPage <= 1 || list.loading}><ChevronLeft size={20} /></button><span>{currentPage} <small>/ {pageCount}</small></span><button aria-label="次のページ" onClick={() => setPage(currentPage + 1)} disabled={currentPage >= pageCount || list.loading}><ChevronRight size={20} /></button></nav></div>
      </section>
    </main>
    <footer><div className="footer-brand"><Plane size={18} /><span>SKYTRACE</span><span>空を知る、新しい視点。</span></div><span>観測データ：<a href="https://opensky-network.org" target="_blank" rel="noreferrer">OpenSky Network <ArrowUpRight size={14} /></a></span></footer>
  </div>;
}
