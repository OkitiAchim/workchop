import crypto from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { seatsOf, type Seat } from '../shared/catalog';
import { racingItems, racingRigs, type RaceState } from '../shared/racing';
import type { OfficeItem, ServerToClientEvents, Spot } from '../shared/types';
import { feature as racing } from '../server/features/racing';
import { startServer } from '../server/index';
import { createTestDb } from './helpers/db';
import { createOffice, disconnectAll, join, until, type Client } from './helpers/http';

let server: Awaited<ReturnType<typeof startServer>>;
let base: string;
let dataDir: string;

beforeAll(async () => {
  dataDir = mkdtempSync(path.join(tmpdir(), 'homeoffice-seating-'));
  server = await startServer({ port: 0, host: '127.0.0.1', dataDir, db: await createTestDb(), quiet: true, iceServers: [], features: [racing], auth: { google: null, apple: null, devLogin: true } });
  base = `http://127.0.0.1:${server.port}`;
}, 60_000);

afterEach(disconnectAll);
afterAll(async () => {
  await server?.close();
  if (dataDir) rmSync(dataDir, { recursive: true, force: true });
});

function corrections(socket: Client) {
  const heard: Parameters<ServerToClientEvents['seat:resolved']>[] = [];
  socket.on('seat:resolved', (...args) => { heard.push(args); });
  return heard;
}

const pose = (officeId: string, id: string) => {
  const p = server.realtime.players(officeId).find((p) => p.id === id);
  if (!p) throw new Error(`Player ${id} is no longer in ${officeId}`);
  return { x: p.x, z: p.z, ry: p.ry, anim: p.anim };
};
const sit = (socket: Client, seat: Seat) => socket.emit('move', seat.x, seat.z, seat.ry, 'sit');

async function furniture(...items: OfficeItem[]) {
  const office = await createOffice(base);
  const stored = await server.store.get(office.id);
  if (!stored) throw new Error('Office was not created');
  server.store.update(office.id, { ...stored.office, items });
  return office;
}

describe('server-authoritative seating', () => {
  it.each(['chair', 'stool', 'armchair', 'beanbag'])('keeps an occupied %s exclusive, including nearly identical sit coordinates', async (type) => {
    const item = { id: 'single', type, x: 5, z: 5, rot: 1 };
    const office = await furniture(item);
    const a = await join(base, office.id, 'Alice');
    const b = await join(base, office.id, 'Bob');
    const seat = seatsOf(item)[0];
    const before = pose(office.id, b.res.selfId);
    const rejected = corrections(b.socket);
    sit(a.socket, seat);
    await until(() => pose(office.id, a.res.selfId).anim === 'sit');
    b.socket.emit('move', seat.x + 0.1, seat.z, seat.ry, 'sit');
    await until(() => rejected.length === 1);
    expect(pose(office.id, b.res.selfId)).toEqual(before);
    expect(pose(office.id, a.res.selfId)).toEqual({ ...seat, anim: 'sit' });
    expect(rejected[0]).toEqual([{ x: seat.x + 0.1, z: seat.z }, before, null]);
  });

  it('assigns the spare spot on the same rotated sofa and preserves a previous seat when that sofa is full', async () => {
    const sofa = { id: 'sofa', type: 'sofa', x: 10, z: 8, rot: 3 };
    const chair = { id: 'chair', type: 'chair', x: 5, z: 5, rot: 0 };
    const otherSofa = { id: 'other-sofa', type: 'sofa', x: 15, z: 8, rot: 0 };
    const office = await furniture(sofa, chair, otherSofa);
    const a = await join(base, office.id, 'Alice');
    const b = await join(base, office.id, 'Bob');
    const c = await join(base, office.id, 'Chris');
    const seats = seatsOf(sofa);
    sit(a.socket, seats[0]);
    await until(() => pose(office.id, a.res.selfId).anim === 'sit');
    const changed = corrections(b.socket);
    sit(b.socket, seats[0]);
    await until(() => changed.length === 1);
    expect(changed[0]).toEqual([{ x: seats[0].x, z: seats[0].z }, { ...seats[1], anim: 'sit' }, sofa.id]);
    expect(pose(office.id, b.res.selfId)).toEqual({ ...seats[1], anim: 'sit' });
    const oldSeat = seatsOf(chair)[0];
    sit(c.socket, oldSeat);
    await until(() => pose(office.id, c.res.selfId).anim === 'sit');
    const full = corrections(c.socket);
    sit(c.socket, seats[0]);
    await until(() => full.length === 1);
    expect(full[0][1]).toEqual({ ...oldSeat, anim: 'sit' });
    expect(full[0][2]).toBe(chair.id);
    expect(pose(office.id, c.res.selfId)).toEqual({ ...oldSeat, anim: 'sit' });
    // No fallback into another item, even though its seats are available.
    expect(server.realtime.players(office.id).some((p) => p.x === seatsOf(otherSofa)[0].x && p.z === seatsOf(otherSofa)[0].z)).toBe(false);
  });

  it('resolves simultaneous contenders before any conflicting pose is published', async () => {
    const item = { id: 'chair', type: 'chair', x: 5, z: 5, rot: 0 };
    const office = await furniture(item);
    const a = await join(base, office.id, 'Alice');
    const b = await join(base, office.id, 'Bob');
    const observer = await join(base, office.id, 'Observer');
    const aCorrections = corrections(a.socket);
    const bCorrections = corrections(b.socket);
    const published: Parameters<ServerToClientEvents['player:moved']>[] = [];
    observer.socket.on('player:moved', (...args) => { published.push(args); });
    const seat = seatsOf(item)[0];
    sit(a.socket, seat);
    sit(b.socket, seat);
    await until(() => aCorrections.length + bCorrections.length === 1 && published.length >= 1);
    const occupied = server.realtime.players(office.id).filter((p) => p.anim === 'sit');
    expect(occupied).toHaveLength(1);
    expect(published.filter(([move]) => move[4] === 'sit')).toHaveLength(1);
  });

  it('echoes the sit attempt id so delayed corrections cannot cancel a newer attempt', async () => {
    const item = { id: 'chair', type: 'chair', x: 5, z: 5, rot: 0 };
    const office = await furniture(item);
    const a = await join(base, office.id, 'Alice');
    const b = await join(base, office.id, 'Bob');
    const seat = seatsOf(item)[0];
    sit(a.socket, seat);
    await until(() => pose(office.id, a.res.selfId).anim === 'sit');
    const denied = corrections(b.socket);
    b.socket.emit('move', seat.x, seat.z, seat.ry, 'sit', 42);
    await until(() => denied.length === 1);
    expect(denied[0][3]).toBe(42);
    a.socket.emit('move', 4, 5, 0, 'idle');
    await until(() => pose(office.id, a.res.selfId).anim === 'idle');
    b.socket.emit('move', seat.x, seat.z, seat.ry, 'sit', 44);
    await until(() => pose(office.id, b.res.selfId).anim === 'sit');
    expect(denied).toHaveLength(1);
  });

  it('treats overlapping seats from different furniture items as one occupied physical spot', async () => {
    const chair = { id: 'chair', type: 'chair', x: 5, z: 5, rot: 0 };
    const stool = { id: 'stool', type: 'stool', x: 5, z: 5, rot: 1 };
    const office = await furniture(chair, stool);
    const a = await join(base, office.id, 'Alice');
    const b = await join(base, office.id, 'Bob');
    sit(a.socket, seatsOf(chair)[0]);
    await until(() => pose(office.id, a.res.selfId).anim === 'sit');
    const denied = corrections(b.socket);
    sit(b.socket, seatsOf(stool)[0]);
    await until(() => denied.length === 1);
    expect(pose(office.id, b.res.selfId).anim).toBe('idle');
    expect(server.realtime.players(office.id).filter((p) => p.anim === 'sit')).toHaveLength(1);
  });

  it('releases a seat on standing, disconnecting and changing offices', async () => {
    const item = { id: 'stool', type: 'stool', x: 5, z: 5, rot: 0 };
    const office = await furniture(item);
    const elsewhere = await createOffice(base);
    const a = await join(base, office.id, 'Alice');
    const b = await join(base, office.id, 'Bob');
    const c = await join(base, office.id, 'Chris');
    const seat = seatsOf(item)[0];
    sit(a.socket, seat);
    await until(() => pose(office.id, a.res.selfId).anim === 'sit');
    a.socket.emit('move', 4, 5, 0, 'idle');
    await until(() => pose(office.id, a.res.selfId).anim === 'idle');
    sit(b.socket, seat);
    await until(() => pose(office.id, b.res.selfId).anim === 'sit');
    b.socket.disconnect();
    await until(() => !server.realtime.players(office.id).some((p) => p.id === b.res.selfId));
    sit(c.socket, seat);
    await until(() => pose(office.id, c.res.selfId).anim === 'sit');
    const changed = await c.socket.emitWithAck('join', { officeId: elsewhere.id, name: 'Chris', avatar: c.res.players.find((p) => p.id === c.res.selfId)!.avatar, guest: elsewhere.guest });
    expect(changed.ok).toBe(true);
    sit(a.socket, seat);
    await until(() => pose(office.id, a.res.selfId).anim === 'sit');
  });

  it('does not exchange the staff and visitor sides of a support desk', async () => {
    const desk = { id: 'support', type: 'support-desk', x: 10, z: 8, rot: 1 };
    const office = await furniture(desk);
    const a = await join(base, office.id, 'Alice');
    const b = await join(base, office.id, 'Bob');
    const seats = seatsOf(desk);
    sit(a.socket, seats[1]);
    await until(() => pose(office.id, a.res.selfId).anim === 'sit');
    const denied = corrections(b.socket);
    sit(b.socket, seats[1]);
    await until(() => denied.length === 1);
    expect(pose(office.id, b.res.selfId).anim).toBe('idle');
    expect(pose(office.id, b.res.selfId)).not.toMatchObject(seats[0]);
  });

  it('keeps ordinary floor sitting while preventing a second seated person at the same spot', async () => {
    const office = await furniture();
    const a = await join(base, office.id, 'Alice');
    const b = await join(base, office.id, 'Bob');
    const floor = { x: 6.4, z: 7.2, ry: 0.8 };
    sit(a.socket, floor);
    await until(() => pose(office.id, a.res.selfId).anim === 'sit');
    const denied = corrections(b.socket);
    sit(b.socket, floor);
    await until(() => denied.length === 1);
    expect(pose(office.id, a.res.selfId)).toEqual({ ...floor, anim: 'sit' });
    expect(pose(office.id, b.res.selfId).anim).toBe('idle');
  });

  it('returns a free alternative or standing pose in the join acknowledgement', async () => {
    const sofa = { id: 'sofa', type: 'sofa', x: 10, z: 8, rot: 0 };
    const office = await furniture(sofa);
    const seats = seatsOf(sofa);
    const at: Spot = { ...seats[0], anim: 'sit' };
    const a = await join(base, office.id, 'Alice', { request: { at } });
    const b = await join(base, office.id, 'Bob', { request: { at } });
    const c = await join(base, office.id, 'Chris', { request: { at } });
    expect(a.res.players.find((p) => p.id === a.res.selfId)).toMatchObject(at);
    expect(b.res.players.find((p) => p.id === b.res.selfId)).toMatchObject({ ...seats[1], anim: 'sit' });
    expect(c.res.players.find((p) => p.id === c.res.selfId)?.anim).toBe('idle');
    expect(server.realtime.players(office.id).filter((p) => p.anim === 'sit')).toHaveLength(2);
  });

  it('lets a replaced connection reclaim its seat, but does not overlap a seat taken during a dropped connection', async () => {
    const chair = { id: 'chair', type: 'chair', x: 5, z: 5, rot: 0 };
    const office = await furniture(chair);
    const at: Spot = { ...seatsOf(chair)[0], anim: 'sit' };
    const resume = crypto.randomBytes(24).toString('base64url');
    const old = await join(base, office.id, 'Alice', { request: { resume, at } });
    const replacement = await join(base, office.id, 'Alice', { request: { resume, rejoin: true, at } });
    await until(() => old.socket.disconnected);
    expect(replacement.res.players.find((p) => p.id === replacement.res.selfId)).toMatchObject(at);
    replacement.socket.disconnect();
    await until(() => server.realtime.players(office.id).length === 0);
    const b = await join(base, office.id, 'Bob', { request: { at } });
    const returned = await join(base, office.id, 'Alice', { request: { resume, rejoin: true, at } });
    expect(returned.res.players.find((p) => p.id === returned.res.selfId)?.anim).toBe('idle');
    expect(pose(office.id, b.res.selfId)).toEqual(at);
  });

  it('reserves compatibility gaming-couch slots and enrolls only accepted join positions in the race', async () => {
    const office = await createOffice(base, 'Owner', 'Legacy games', 'startup');
    const stored = (await server.store.get(office.id))!;
    server.store.update(office.id, { ...stored.office, items: stored.office.items.filter((i) => !['racing-tv', 'gaming-couch', 'gaming-table'].includes(i.type)) });
    const legacy = server.store.peek(office.id)!.office;
    const rig = racingRigs(legacy)[0];
    expect(racingItems(legacy)).toContainEqual(rig.couch);
    const seats = seatsOf(rig.couch);
    const at: Spot = { ...seats[0], anim: 'sit' };
    const a = await join(base, office.id, 'Alice', { request: { at } });
    const b = await join(base, office.id, 'Bob', { request: { at } });
    const spectator = await join(base, office.id, 'Spectator', { request: { at } });
    expect(pose(office.id, a.res.selfId)).toEqual(at);
    expect(pose(office.id, b.res.selfId)).toEqual({ ...seats[1], anim: 'sit' });
    expect(pose(office.id, spectator.res.selfId).anim).toBe('idle');
    let state: RaceState | undefined;
    spectator.socket.on('race:state', (states) => { state = states[0]; });
    spectator.socket.emit('race:sync');
    await until(() => !!state);
    expect(state?.drivers).toEqual([
      { id: a.res.selfId, name: 'Alice', number: 1, seat: 0 },
      { id: b.res.selfId, name: 'Bob', number: 2, seat: 1 },
    ]);
    const denied = corrections(spectator.socket);
    sit(spectator.socket, seats[1]);
    await until(() => denied.length === 1);
    expect(state?.drivers).toHaveLength(2);
  });
});
