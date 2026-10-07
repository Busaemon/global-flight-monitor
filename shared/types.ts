export type DataMode = 'live' | 'demo';
export type DataStatus = 'live' | 'stale' | 'unavailable' | 'demo';
export interface Flight {
  icao24: string;
  callsign: string;
  originCountry: string;
  longitude: number | null;
  latitude: number | null;
  altitudeMeters: number | null;
  velocityMps: number | null;
  headingDegrees: number | null;
  verticalRateMps: number | null;
  onGround: boolean;
  lastContact: string;
  positionUpdatedAt: string | null;
  positionSource: string;
}
export interface FlightStats {
  airborne: number;
  totalObserved: number;
  withPosition: number;
  countries: number;
  avgAltitudeMeters: number | null;
  avgVelocityMps: number | null;
}
export interface HistoryPoint { observedAt: string; airborne: number }
export interface DashboardResponse {
  mode: DataMode;
  status: DataStatus;
  source: string;
  coverageNote: string;
  fetchedAt: string | null;
  observedAt: string | null;
  nextRefreshAt: string | null;
  pollIntervalSeconds: number;
  stats: FlightStats;
  flights: Flight[];
  history: HistoryPoint[];
  message: string | null;
}
export interface FlightDetailResponse {
  flight: Flight;
  mode: DataMode;
  source: string;
  fetchedAt: string | null;
  observedAt: string | null;
}
/** Summary counts always cover the complete observation, independent of search or map bounds. */
export type DashboardSummaryResponse = Omit<DashboardResponse, 'flights'>;
export type FlightSort = 'callsign' | 'altitude' | 'speed';
export type MapBounds = [west: number, south: number, east: number, north: number];
export interface FlightListResponse {
  mode: DataMode;
  source: string;
  observedAt: string | null;
  fetchedAt: string | null;
  flights: Flight[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
}
export interface MapFlight {
  icao24: string;
  callsign: string;
  originCountry: string;
  latitude: number;
  longitude: number;
  headingDegrees: number | null;
}
export interface FlightMapResponse {
  mode: DataMode;
  observedAt: string | null;
  fetchedAt: string | null;
  flights: MapFlight[];
  total: number;
  sampled: boolean;
}
