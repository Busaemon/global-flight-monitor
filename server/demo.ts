import type { Flight, HistoryPoint } from '../shared/types.ts';
import { summarize, type Observation } from './opensky.ts';

export const DEMO_SOURCE = 'シミュレーションデータ';
export const DEMO_COVERAGE = '画面の動作確認用に生成した架空の機体・機体数です。実際の航空機、路線、現在の運航状況を示しません。ライブ履歴とは別に保存します。';

const regions = [
  { lat: 36, lon: 138, country: 'Japan', callsign: 'ANA' },
  { lat: 35, lon: 133, country: 'Japan', callsign: 'JAL' },
  { lat: 49, lon: 8, country: 'Germany', callsign: 'DLH' },
  { lat: 48, lon: 2, country: 'France', callsign: 'AFR' },
  { lat: 52, lon: -1, country: 'United Kingdom', callsign: 'BAW' },
  { lat: 38, lon: -99, country: 'United States', callsign: 'UAL' },
  { lat: 34, lon: -116, country: 'United States', callsign: 'DAL' },
  { lat: 42, lon: -77, country: 'United States', callsign: 'AAL' },
  { lat: 25, lon: 55, country: 'United Arab Emirates', callsign: 'UAE' },
  { lat: 23, lon: 80, country: 'India', callsign: 'AIC' },
  { lat: 5, lon: 105, country: 'Singapore', callsign: 'SIA' },
  { lat: -29, lon: 145, country: 'Australia', callsign: 'QFA' },
  { lat: 39, lon: 116, country: 'China', callsign: 'CCA' },
  { lat: -17, lon: -48, country: 'Brazil', callsign: 'TAM' },
  { lat: -24, lon: 25, country: 'South Africa', callsign: 'SAA' },
  { lat: 49, lon: -107, country: 'Canada', callsign: 'ACA' },
  { lat: 17, lon: -102, country: 'Mexico', callsign: 'AMX' },
  { lat: 42, lon: 31, country: 'Türkiye', callsign: 'THY' },
  { lat: 1, lon: 33, country: 'Kenya', callsign: 'KQA' },
  { lat: -37, lon: 173, country: 'New Zealand', callsign: 'ANZ' },
];
const demoCount = (now: number) => 140 + Math.round(8 * Math.sin(now / 600000));

export function makeDemoObservation(now: number): Observation {
  const time = Math.floor(now / 10000) * 10000;
  const timestamp = new Date(time).toISOString();
  const flights: Flight[] = Array.from({ length: demoCount(time) }, (_, index) => {
    const region = regions[index % regions.length];
    const phase = index * 2.399963 + time / 1200000;
    const angle = phase + index % 3;
    const latitude = Math.max(-75, Math.min(75, region.lat + Math.sin(phase) * (2 + index % 7)));
    const rawLongitude = region.lon + Math.cos(phase) * (4 + index % 11);
    const longitude = ((rawLongitude + 540) % 360) - 180;
    return {
      icao24: (0xd00000 + index).toString(16), callsign: `${region.callsign}${101 + index * 3}`,
      originCountry: region.country, longitude, latitude,
      altitudeMeters: 8500 + (index % 13) * 210 + Math.sin(angle) * 120,
      velocityMps: 210 + index % 43, headingDegrees: ((angle * 180 / Math.PI + 90) % 360 + 360) % 360,
      verticalRateMps: Math.sin(angle) * 1.5, onGround: false,
      lastContact: timestamp, positionUpdatedAt: timestamp, positionSource: 'Simulation',
    };
  });
  return { observedAt: timestamp, flights, stats: summarize(flights, flights.length) };
}

export function makeDemoHistory(now: number): HistoryPoint[] {
  const minute = Math.floor(now / 60000) * 60000;
  return Array.from({ length: 120 }, (_, index) => {
    const time = minute - (120 - index) * 60000;
    return { observedAt: new Date(time).toISOString(), airborne: demoCount(time) };
  });
}
