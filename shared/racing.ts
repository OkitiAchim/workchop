import type { Office, OfficeItem } from './types';

export const RACE_MS = 120_000;
export const COUNTDOWN_MS = 3_000;
export const FINISH_DISTANCE = 5_800;
export const TOP_SPEED = 56;
export const NITRO_SPEED = 84;
export const NITRO_MS = 4_000;
export const CRASH_MS = 2_500;
export const BASH_MS = 2_000;
export const CAR_COLORS = ['#ef243e', '#65ef36'] as const;
export const DEFAULT_RACING_ID = 'racing-default-';
export type RacePhase = 'waiting' | 'ready' | 'countdown' | 'racing' | 'finished';
export interface RaceDriver { id: string; name: string; seat: number; number: 1 | 2 }
export interface RaceCar {
  distance: number; lane: number; speed: number; nitro: number; boostUntil: number;
  slowUntil: number; crashUntil: number; crashVehicle: number | null; immuneUntil: number;
}
export interface RaceInput { gas: boolean; steer: -1 | 0 | 1; brake?: boolean; nitro?: boolean }
export interface RaceTraffic { id: number; distance: number; lane: number; baseLane: number; speed: number; phase: number; color: string }
export interface RacePickup { id: number; distance: number; lane: number; available: boolean }
export interface RaceState {
  tvId: string;
  couchId: string;
  phase: RacePhase;
  drivers: RaceDriver[];
  cars: [RaceCar, RaceCar];
  startAt: number;
  endAt: number;
  serverAt: number;
  traffic: RaceTraffic[];
  pickups: RacePickup[];
  split: boolean; // Legacy race snapshot field; every viewer now has one dedicated chase camera.
  seed: number;
  winner: { number: 1 | 2; name: string } | null;
  reason: 'finish' | 'time' | 'forfeit' | 'draw' | null;
}
export interface RacingRig { tv: OfficeItem; couch: OfficeItem; table: OfficeItem }

/** Compatibility furniture for the unchanged startup games corner; never writes saved data. */
export function racingItems(office: Pick<Office, 'items'> & Partial<Pick<Office, 'settings'>>): OfficeItem[] {
  const { items, settings } = office;
  if (settings && (settings.width !== 32 || settings.depth !== 24)) return items;
  if (!items.some((i) => i.type === 'ping-pong' && i.x === 17.5 && i.z === 16)
    || ![13.5, 18.5].every((x) => items.some((i) => i.type === 'tall-plant' && i.x === x && i.z === 23.5))) return items;
  const defaults: OfficeItem[] = [
    { id: `${DEFAULT_RACING_ID}tv`, type: 'racing-tv', x: 16, z: 23.94, rot: 2 },
    { id: `${DEFAULT_RACING_ID}couch`, type: 'gaming-couch', x: 16, z: 19.5, rot: 0, color: '#334963' },
    { id: `${DEFAULT_RACING_ID}table`, type: 'gaming-table', x: 16, z: 22, rot: 0 },
  ];
  const extra = defaults.filter((d) => !items.some((i) => i.type === d.type));
  return extra.length ? [...items, ...extra] : items;
}

/** Pair a TV with nearby gaming furniture, once each; ordinary sofas and tables are untouched. */
export function racingRigs(office: Pick<Office, 'items'> & Partial<Pick<Office, 'settings'>>): RacingRig[] {
  const items = racingItems(office);
  const rigs: RacingRig[] = [];
  const used = new Set<string>();
  for (const tv of items.filter((i) => i.type === 'racing-tv')) {
    const nearest = (type: string, from: OfficeItem, max: number) => items
      .filter((i) => i.type === type && (type !== 'gaming-couch' || i.rot === (tv.rot + 2) % 4) && !used.has(i.id) && Math.hypot(i.x - from.x, i.z - from.z) < max)
      .sort((a, b) => Math.hypot(a.x - from.x, a.z - from.z) - Math.hypot(b.x - from.x, b.z - from.z))[0];
    const couch = nearest('gaming-couch', tv, 6);
    const table = couch && nearest('gaming-table', couch, 3);
    if (!couch || !table) continue;
    rigs.push({ tv, couch, table });
    used.add(couch.id);
    used.add(table.id);
  }
  return rigs;
}

export function roadCenter(distance: number): number {
  return Math.sin(distance / 290) * 0.22 + Math.sin(distance / 760) * 0.14;
}

export function validRaceInput(raw: unknown): raw is RaceInput {
  if (!raw || typeof raw !== 'object') return false;
  const input = raw as RaceInput;
  return typeof input.gas === 'boolean' && [-1, 0, 1].includes(input.steer)
    && (input.brake === undefined || typeof input.brake === 'boolean')
    && (input.nitro === undefined || typeof input.nitro === 'boolean');
}

/** Retained for older race snapshots; current clients use dedicated cameras. */
export function raceSplit(wasSplit: boolean, gap: number): boolean {
  return wasSplit ? gap > 42 : gap > 72;
}

declare module './types' {
  interface ClientToServerEvents {
    'race:start': (tvId: string) => void;
    'race:input': (tvId: string, input: RaceInput) => void;
    'race:sync': () => void;
  }
  interface ServerToClientEvents {
    'race:state': (states: RaceState[]) => void;
    'race:seat-rejected': (couchId: string) => void;
  }
}
