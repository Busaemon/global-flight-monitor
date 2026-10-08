import { memo, useEffect, useMemo, useState } from 'react';
import { CircleMarker, GeoJSON, MapContainer, Pane, TileLayer, Tooltip, ZoomControl, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { Globe2, MapPin, Radio, RefreshCw } from 'lucide-react';
import type { DataMode, Flight, FlightMapResponse, MapBounds, MapFlight } from '../../shared/types';
import { useApiResource } from '../hooks/useApiResource';
import worldLand from './world-land';

const LAND_STYLE = { color: '#38566b', weight: .7, fillColor: '#182e40', fillOpacity: .85 };
const number = new Intl.NumberFormat('ja-JP');
const normalizeLongitude = (value: number) => ((value + 180) % 360 + 360) % 360 - 180;

function MapView({ onBounds, onLimit, flight, token }: {
  onBounds: (bounds: MapBounds) => void;
  onLimit: (limit: number) => void;
  flight: Flight | null;
  token: number;
}) {
  const map = useMap();
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let previousCompact: boolean | undefined;
    function update() {
      const bounds = map.getBounds();
      const west = bounds.getWest();
      const east = bounds.getEast();
      onBounds([east - west >= 360 ? -180 : normalizeLongitude(west),
        Math.max(-90, bounds.getSouth()), east - west >= 360 ? 180 : normalizeLongitude(east),
        Math.min(90, bounds.getNorth())]);
    }
    function moved() { if (timer) clearTimeout(timer); timer = setTimeout(update, 200); }
    const observer = new ResizeObserver(() => {
      map.invalidateSize({ animate: false });
      const compact = map.getSize().x < 620;
      onLimit(compact ? 200 : 600);
      if (compact !== previousCompact && map.getZoom() <= 2) {
        map.setView([28, 10], compact ? .5 : 2, { animate: false });
      }
      previousCompact = compact;
      moved();
    });
    observer.observe(map.getContainer());
    map.on('moveend', moved);
    map.getContainer().querySelector<HTMLElement>('.leaflet-control-zoom-in')?.setAttribute('aria-label', '地図を拡大');
    map.getContainer().querySelector<HTMLElement>('.leaflet-control-zoom-out')?.setAttribute('aria-label', '地図を縮小');
    update();
    return () => { observer.disconnect(); map.off('moveend', moved); if (timer) clearTimeout(timer); };
  }, [map, onBounds, onLimit]);
  useEffect(() => {
    if (token > 0 && flight?.latitude !== null && flight?.longitude !== null && flight) {
      map.setView([flight.latitude, flight.longitude], 6, {
        animate: !window.matchMedia('(prefers-reduced-motion: reduce)').matches,
      });
    }
    // The recenter command is explicit; subsequent data updates preserve the viewport.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, token]);
  return null;
}

const Aircraft = memo(function Aircraft({ flights, selectedId, onSelect }: {
  flights: MapFlight[]; selectedId: string | null; onSelect: (id: string) => void;
}) {
  const map = useMap();
  const renderer = useMemo(() => L.canvas({ padding: .25 }), []);
  const centerLongitude = map.getCenter().lng;
  return <>{flights.map(flight => <CircleMarker key={flight.icao24}
    center={[flight.latitude, flight.longitude + 360 * Math.round((centerLongitude - flight.longitude) / 360)]} renderer={renderer}
    radius={flight.icao24 === selectedId ? 8 : 4}
    pathOptions={{ color: '#102a43',
      fillColor: flight.icao24 === selectedId ? '#f4c87e' : '#74ddeb', fillOpacity: .95, weight: 1.5 }}
    eventHandlers={{ click: () => onSelect(flight.icao24) }}>
    <Tooltip direction="top">{flight.callsign || flight.icao24.toUpperCase()} · {flight.originCountry}</Tooltip>
  </CircleMarker>)}</>;
});

interface Props {
  mode: DataMode; query: string; revision: string; selectedId: string | null;
  selected: Flight | null; focusToken: number; onSelect: (id: string) => void;
}

export default memo(function FlightMap({ mode, query, revision, selectedId, selected, focusToken, onSelect }: Props) {
  const [bounds, setBounds] = useState<MapBounds>([-180, -90, 180, 90]);
  const [limit, setLimit] = useState(() => window.innerWidth <= 620 ? 200 : 600);
  const [tileError, setTileError] = useState(false);
  const [retry, setRetry] = useState(0);
  const params = new URLSearchParams({ mode, q: query, bounds: bounds.map(value => value.toFixed(4)).join(','), limit: String(limit) });
  if (selectedId) params.set('selected', selectedId);
  const { data, loading, error } = useApiResource<FlightMapResponse>(`/api/map?${params}`, mode, `${revision}:${retry}`);
  const flights = data?.flights ?? [];
  const hasObservation = data?.observedAt !== null && data?.observedAt !== undefined;
  return <div className="map-frame" role="region" aria-label="航空機の位置を表示する地図" aria-describedby="map-description">
    <p id="map-description" className="sr-only">地図はドラッグまたは矢印キーで移動し、拡大縮小ボタンで操作できます。表示範囲内の機体を最大{limit}機表示します。フライト一覧のボタンでも機体を選択できます。</p>
    <MapContainer center={[28, 10]} zoom={2} minZoom={0} maxZoom={12} zoomSnap={.5} zoomControl={false}
      scrollWheelZoom={false} worldCopyJump className="flight-map" aria-label="世界地図">
      <Pane name="offline-land" style={{ zIndex: 190 }}><GeoJSON data={worldLand} pane="offline-land" interactive={false}
        style={LAND_STYLE} attribution='<a href="https://www.naturalearthdata.com/">Natural Earth</a>' /></Pane>
      <TileLayer url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
        referrerPolicy="strict-origin-when-cross-origin"
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        eventHandlers={{ tileerror: () => setTileError(true) }} />
      <ZoomControl position="bottomleft" /><MapView onBounds={setBounds} onLimit={setLimit} flight={selected} token={focusToken} />
      <Aircraft flights={flights} selectedId={selectedId} onSelect={onSelect} />
    </MapContainer>
    <div className="map-label"><span className="status-dot" /><span>{mode === 'demo' ? 'DEMO AIRSPACE' : 'OBSERVED AIRSPACE'}</span>
      <strong>{hasObservation ? number.format(flights.length) : '—'} <small>{hasObservation ? '機を表示' : '位置未受信'}</small></strong></div>
    {(!data || !hasObservation && error) && <div className="map-message" role="status" aria-label="航空機の位置の取得状態">
      <strong><Radio size={18} />{loading ? '航空機の位置を取得しています' : '航空機の位置を取得できません'}</strong>
      <span>{error || '地図はこのまま操作できます。'}</span>
      {!loading && <button className="secondary-button" onClick={() => setRetry(value => value + 1)}><RefreshCw size={16} /> 航空機の位置を再取得</button>}
    </div>}
    {data && !hasObservation && !loading && !error && <div className="map-message compact" role="status" aria-label="航空機の位置の取得状態">
      <strong><Radio size={18} />航空機の位置は未受信です</strong><span>ライブデータの受信を待っています。地図は操作できます。</span></div>}
    {data && hasObservation && flights.length === 0 && !loading && !error && <div className="map-message compact" role="status" aria-label="航空機の位置の取得状態">
      <strong><Globe2 size={18} />表示範囲に一致する機体がありません</strong><span>地図を移動するか、検索条件を変更してください。</span></div>}
    {data && hasObservation && error && <div className="map-message map-error" role="status" aria-label="航空機の位置の取得状態"><strong>最後に取得した位置を表示しています。</strong>
      <button className="secondary-button" onClick={() => setRetry(value => value + 1)}><RefreshCw size={16} /> 航空機の位置を再取得</button></div>}
    {tileError && <div className="tile-error"><MapPin size={14} />背景地図を取得できないため、簡易地図を表示しています。</div>}
    <div className="map-legend"><span className="legend-dot" />航空機<span className="legend-dot selected" />選択中
      <span>{data?.sampled ? `範囲内${number.format(data.total)}機から間引き表示` : '一覧でも選択できます'}</span></div>
  </div>;
});
