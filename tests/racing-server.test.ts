import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { seatsOf } from '../shared/catalog';
import { racingRigs, type RaceState } from '../shared/racing';
import { feature } from '../server/features/racing';
import { startServer } from '../server/index';
import { createTestDb } from './helpers/db';
import { createOffice, disconnectAll, join, until } from './helpers/http';

let server: Awaited<ReturnType<typeof startServer>>;
let base: string;
beforeAll(async () => {
  server = await startServer({ port: 0, host: '127.0.0.1', db: await createTestDb(), quiet: true, iceServers: [], features: [feature], auth: { google: null, apple: null, devLogin: true } });
  base = `http://127.0.0.1:${server.port}`;
}, 60_000);
afterAll(async () => { disconnectAll(); await server?.close(); });

describe('racing realtime', () => {
  it('shares the race with spectators, finds a free couch seat, rejects a full couch, restricts hosting and awards disconnects', async () => {
    const office = await createOffice(base, 'Owner', 'Games', 'startup');
    const a = await join(base, office.id, 'Alice');
    const b = await join(base, office.id, 'Bob');
    const spectator = await join(base, office.id, 'Spectator');
    const elsewhere = await join(base, (await createOffice(base)).id, 'Elsewhere');
    let states: RaceState[] = [];
    let elsewhereStates: RaceState[] = [];
    spectator.socket.on('race:state', (s) => { states = s; });
    elsewhere.socket.on('race:state', (s) => { elsewhereStates = s; });
    const rig = racingRigs(a.res.office)[0];
    const seats = seatsOf(rig.couch);
    const sit = (who: typeof a, index: number) => { const s = seats[index]; who.socket.emit('move', s.x, s.z, s.ry, 'sit'); };
    sit(a, 1);
    await until(() => states[0]?.drivers.length === 1);
    expect(states[0].drivers[0]).toMatchObject({ id: a.res.selfId, number: 1, seat: 1 });
    a.socket.emit('race:start', rig.tv.id);
    await new Promise((r) => setTimeout(r, 120));
    expect(states[0].phase).toBe('waiting');
    let resolved: Parameters<import('../shared/types').ServerToClientEvents['seat:resolved']> | undefined;
    b.socket.on('seat:resolved', (...args) => { resolved = args; });
    sit(b, 1);
    await until(() => states[0]?.phase === 'ready');
    await until(() => !!resolved);
    expect(resolved?.[1]).toMatchObject({ ...seats[0], anim: 'sit' });
    expect(states[0].drivers[1]).toMatchObject({ id: b.res.selfId, number: 2, seat: 0 });
    let full = false;
    spectator.socket.on('seat:resolved', (_requested, spot) => { full = spot.anim !== 'sit'; });
    sit(spectator, 0);
    await until(() => full);
    expect(states[0].drivers).toHaveLength(2);
    spectator.socket.emit('race:start', rig.tv.id);
    b.socket.emit('race:start', rig.tv.id);
    await new Promise((r) => setTimeout(r, 120));
    expect(states[0].phase).toBe('ready');
    a.socket.emit('race:start', rig.tv.id);
    await until(() => states[0]?.phase === 'countdown');
    await until(() => states[0]?.phase === 'racing', 5000);
    for (let i = 0; i < 5; i++) {
      spectator.socket.emit('race:input', rig.tv.id, { gas: true, steer: 1 });
      b.socket.emit('race:input', rig.tv.id, { gas: true, steer: 0 });
      await new Promise((r) => setTimeout(r, 100));
    }
    await until(() => states[0].cars[1].distance > 0);
    expect(states[0].cars[0].distance).toBe(0);
    expect(elsewhereStates).toEqual([]);
    // A late spectator receives the complete current race, rather than an empty preview.
    const late = await join(base, office.id, 'Late viewer');
    let lateState: RaceState | undefined;
    late.socket.on('race:state', (s) => { lateState = s[0]; });
    late.socket.emit('race:sync');
    await until(() => lateState?.phase === 'racing');
    expect(lateState?.drivers).toHaveLength(2);
    a.socket.disconnect();
    await until(() => states[0]?.phase === 'finished');
    expect(states[0].winner).toEqual({ number: 2, name: 'Bob' });
    expect(states[0].reason).toBe('forfeit');
    expect(states[0].drivers).toHaveLength(1);
    // The remaining player becomes the host of the next pairing.
    sit(late, 1);
    await until(() => states[0]?.phase === 'ready');
    expect(states[0].drivers[0]).toMatchObject({ id: b.res.selfId, number: 1 });
    b.socket.emit('race:start', rig.tv.id);
    await until(() => states[0]?.phase === 'countdown');
    late.socket.emit('move', 16, 21, 0, 'idle');
    await until(() => states[0]?.phase === 'finished');
    expect(states[0].winner).toEqual({ number: 1, name: 'Bob' });
  }, 15_000);
});
