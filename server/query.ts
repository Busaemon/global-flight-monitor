import type { DataMode, Flight, FlightSort, MapBounds, MapFlight } from '../shared/types.ts';

export class QueryError extends Error {}
type Query = Record<string, unknown>;

export interface FlightListQuery { mode: DataMode; q: string; sort: FlightSort; page: number; limit: number }
export interface FlightMapQuery { mode: DataMode; q: string; bounds: MapBounds; limit: number; selected?: string }

function validateKeys(query: Query, allowed: string[]) {
  for (const key of Object.keys(query)) {
    if (!allowed.includes(key)) throw new QueryError(`未対応のクエリ項目です: ${key}`);
    if (typeof query[key] !== 'string') throw new QueryError(`${key} は 1 回だけ指定してください。`);
  }
}

export function readMode(query: Query, allowed = ['mode']): DataMode {
  validateKeys(query, allowed);
  if (query.mode === undefined || query.mode === 'live') return 'live';
  if (query.mode === 'demo') return 'demo';
  throw new QueryError('mode は live または demo を指定してください。');
}

function readSearch(value: unknown): string {
  if (value === undefined) return '';
  if (typeof value !== 'string' || value.length > 80 || /[\u0000-\u001f\u007f]/u.test(value)) {
    throw new QueryError('q は制御文字を含まない 80 文字以内の文字列を指定してください。');
  }
  return value.trim().toLowerCase();
}

function readInteger(value: unknown, fallback: number, maximum: number, name: string): number {
  if (value === undefined) return fallback;
  if (typeof value !== 'string' || !/^[1-9]\d*$/u.test(value) || Number(value) > maximum) {
    throw new QueryError(`${name} は 1 から ${maximum} の整数を指定してください。`);
  }
  return Number(value);
}

export function readListQuery(query: Query): FlightListQuery {
  const mode = readMode(query, ['mode', 'q', 'sort', 'page', 'limit']);
  if (query.sort !== undefined && query.sort !== 'callsign' && query.sort !== 'altitude' && query.sort !== 'speed') {
    throw new QueryError('sort は callsign、altitude または speed を指定してください。');
  }
  return {
    mode, q: readSearch(query.q), sort: query.sort === undefined ? 'callsign' : query.sort as FlightSort,
    page: readInteger(query.page, 1, 1_000_000, 'page'), limit: readInteger(query.limit, 8, 50, 'limit'),
  };
}

export function readMapQuery(query: Query): FlightMapQuery {
  const mode = readMode(query, ['mode', 'q', 'bounds', 'limit', 'selected']);
  let bounds: MapBounds = [-180, -90, 180, 90];
  if (query.bounds !== undefined) {
    const parts = (query.bounds as string).split(',');
    const values = parts.map(part => Number(part));
    if (parts.length !== 4 || parts.some(part => !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/u.test(part.trim())) ||
        values.some(value => !Number.isFinite(value)) ||
        Math.abs(values[0]) > 180 || Math.abs(values[2]) > 180 || Math.abs(values[1]) > 90 ||
        Math.abs(values[3]) > 90 || values[1] > values[3]) {
      throw new QueryError('bounds は west,south,east,north の順で経度 ±180、緯度 ±90 の範囲を指定してください。');
    }
    bounds = values as MapBounds;
  }
  let selected: string | undefined;
  if (query.selected !== undefined) {
    if (!/^[a-f0-9]{6}$/iu.test(query.selected as string)) throw new QueryError('selected は 6 桁の 16 進数を指定してください。');
    selected = (query.selected as string).toLowerCase();
  }
  return { mode, q: readSearch(query.q), bounds, limit: readInteger(query.limit, 500, 1000, 'limit'), selected };
}

export function matchesSearch(flight: Flight, query: string): boolean {
  if (!query) return true;
  const normalized = query.toLowerCase();
  return flight.icao24.includes(normalized) || flight.callsign.toLowerCase().includes(normalized) ||
    flight.originCountry.toLowerCase().includes(normalized);
}

const collator = new Intl.Collator('en', { sensitivity: 'base' });
const compareIdentifier = (a: Flight, b: Flight) => collator.compare(a.icao24, b.icao24);
function descendingNullable(a: number | null, b: number | null): number {
  if (a === null) return b === null ? 0 : 1;
  if (b === null) return -1;
  return b - a;
}

export function sortFlights(flights: Flight[], sort: FlightSort): Flight[] {
  return [...flights].sort((a, b) => {
    const difference = sort === 'altitude' ? descendingNullable(a.altitudeMeters, b.altitudeMeters)
      : sort === 'speed' ? descendingNullable(a.velocityMps, b.velocityMps)
        : collator.compare(a.callsign, b.callsign);
    return difference || compareIdentifier(a, b);
  });
}

export function inBounds(flight: Flight, [west, south, east, north]: MapBounds): flight is Flight & { latitude: number; longitude: number } {
  if (flight.latitude === null || flight.longitude === null) return false;
  const longitude = flight.longitude;
  return flight.latitude >= south && flight.latitude <= north &&
    (west <= east ? longitude >= west && longitude <= east : longitude >= west || longitude <= east);
}

export function sampleMapFlights(flights: Array<Flight & { latitude: number; longitude: number }>, limit: number, selected?: string): MapFlight[] {
  const ordered = [...flights].sort(compareIdentifier);
  const sample = ordered.length <= limit ? ordered : Array.from({ length: limit }, (_, index) => ordered[Math.floor(index * ordered.length / limit)]);
  if (selected && !sample.some(flight => flight.icao24 === selected)) {
    const chosen = ordered.find(flight => flight.icao24 === selected);
    if (chosen && sample.length) sample[sample.length - 1] = chosen;
  }
  return sample.sort(compareIdentifier).map(flight => ({
    icao24: flight.icao24, callsign: flight.callsign, originCountry: flight.originCountry,
    latitude: flight.latitude, longitude: flight.longitude, headingDegrees: flight.headingDegrees,
  }));
}
