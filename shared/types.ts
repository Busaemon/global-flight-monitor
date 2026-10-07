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
