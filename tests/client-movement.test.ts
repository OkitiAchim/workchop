import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Office } from '../shared/types';
import { seatsOf } from '../shared/catalog';

// Sitting down and getting up are sent the moment they happen, whatever caused them (a click, E,
// arriving at a chair, a support customer called to a desk), not with the next frame: a tab in the
// background draws none, and others would keep seeing them where they were.

const fake = vi.hoisted(() => ({
  sendMove: vi.fn(),
  toast: vi.fn(),
  input: { x: 0, y: 0, run: false },
}));

vi.mock('../client/src/lib/session', () => ({ getSession: () => ({ sendMove: fake.sendMove }) }));
vi.mock('../client/src/features/audio/focus', () => ({ focusHint: () => null }));
vi.mock('../client/src/world/extensions', () => ({ getItemInteraction: () => undefined, nearbyActionFinders: () => [] }));
vi.mock('../client/src/world/input', () => ({ axis: () => fake.input }));

const office: Office = {
  id: 'o1',
  settings: { name: 'HQ', width: 30, depth: 30, floor: 'wood', floorColor: '#000', wallColor: '#000', spawn: { x: 5, z: 5 }, buildPolicy: 'members' },
  items: [
    { id: 'chair1', type: 'chair', x: 15, z: 11, rot: 0 },
    { id: 'stool1', type: 'stool', x: 14.3, z: 11, rot: 0 },
    { id: 'desk1', type: 'support-desk', x: 20, z: 20, rot: 0 },
    { id: 'sofa1', type: 'sofa', x: 7, z: 8, rot: 0 },
    { id: 'game1', type: 'gaming-couch', x: 16, z: 16, rot: 0 },
  ],
  zones: [],
  createdAt: 0,
  updatedAt: 0,
} as unknown as Office;

vi.mock('../client/src/state/store', () => ({
  getState: () => ({ office, selfId: 'me', toasts: [], hint: null }),
  setState: () => {},
  toast: fake.toast,
}));

const { local, remoteTargets, setRemoteTarget } = await import('../client/src/lib/positions');
const { interact, sitOn, standUp, stepLocal, walkTo, walkToItemSeat } = await import('../client/src/world/movement');

const camera = { matrixWorld: { elements: new Array(16).fill(0) } } as never;

beforeEach(() => {
  fake.sendMove.mockClear();
  fake.toast.mockClear();
  Object.assign(fake.input, { x: 0, y: 0, run: false });
  remoteTargets.clear();
  Object.assign(local, { x: 10, z: 10, ry: 0, anim: 'idle', seat: null, path: null, pathSeat: null });
});

describe('sitting down and getting up', () => {
  it('are sent at once, without waiting for a frame', () => {
    sitOn({ x: 20, z: 21, ry: Math.PI, itemId: 'desk1' });
    expect(fake.sendMove).toHaveBeenCalledExactlyOnceWith(20, 21, Math.PI, 'sit');
    standUp();
    // Up in front of the desk's seat (it's solid), standing.
    expect(fake.sendMove).toHaveBeenLastCalledWith(local.x, local.z, Math.PI, 'idle');
    expect(Math.hypot(local.x - 20, local.z - 21)).toBeGreaterThan(0.5);
  });

  it('with E', () => {
    Object.assign(local, { x: 15.5, z: 11 });
    interact();
    expect(fake.sendMove).toHaveBeenLastCalledWith(15, 11, 0, 'sit');
    interact();
    expect(fake.sendMove).toHaveBeenLastCalledWith(local.x, local.z, 0, 'idle');
  });

  it('on arriving at a chair walked to, in that same frame', () => {
    walkTo(15, 11, { x: 15, z: 11, ry: 0, itemId: 'chair1' });
    expect(local.path?.length).toBeGreaterThan(0);
    let frames = 0;
    while (local.anim !== 'sit' && frames++ < 600) stepLocal(1 / 60, camera);
    expect(local.anim).toBe('sit');
    expect(fake.sendMove).toHaveBeenLastCalledWith(15, 11, 0, 'sit');
  });
});

const sofaSeats = seatsOf(office.items.find((item) => item.id === 'sofa1')!);
const sitRemote = (id: string, seat: { x: number; z: number; ry: number }) => setRemoteTarget(id, seat.x, seat.z, seat.ry, 'sit');
const arrive = () => {
  let frames = 0;
  while (local.path && frames++ < 600) stepLocal(1 / 60, camera);
  expect(frames).toBeLessThan(600);
};

describe('exclusive seat selection', () => {
  it('chooses the clicked sofa cushion instead of the one nearest the player', () => {
    Object.assign(local, { x: sofaSeats[0].x, z: 6 });
    walkToItemSeat('sofa1', sofaSeats[1]);
    expect(local.pathSeat).toMatchObject({ ...sofaSeats[1], itemId: 'sofa1' });
  });

  it('redirects an occupied sofa cushion to a free cushion on that same sofa', () => {
    sitRemote('other', sofaSeats[0]);
    walkToItemSeat('sofa1', sofaSeats[0]);
    expect(local.pathSeat).toMatchObject({ ...sofaSeats[1], itemId: 'sofa1' });
    arrive();
    expect(local.seat).toMatchObject({ ...sofaSeats[1], itemId: 'sofa1' });
    expect(fake.sendMove).toHaveBeenLastCalledWith(sofaSeats[1].x, sofaSeats[1].z, sofaSeats[1].ry, 'sit');
  });

  it('keeps a currently seated player in place when they click a full chair', () => {
    sitOn({ x: 20, z: 21, ry: Math.PI, itemId: 'desk1' });
    fake.sendMove.mockClear();
    setRemoteTarget('other', 15, 11, 0, 'sit');
    walkToItemSeat('chair1', { x: 15, z: 11 });
    expect(local.seat?.itemId).toBe('desk1');
    expect(local.path).toBeNull();
    expect(fake.sendMove).not.toHaveBeenCalled();
    expect(fake.toast).toHaveBeenCalledWith('That seat is occupied');
  });

  it('does not start walking toward a full sofa', () => {
    sofaSeats.forEach((seat, index) => sitRemote(`other${index}`, seat));
    walkToItemSeat('sofa1', sofaSeats[0]);
    expect(local.path).toBeNull();
    expect(local.seat).toBeNull();
    expect(fake.toast).toHaveBeenCalledWith('All seats here are occupied');
  });

  it('skips an occupied chair when choosing a nearby seat with E', () => {
    Object.assign(local, { x: 15.05, z: 11 });
    setRemoteTarget('other', 15, 11, 0, 'sit');
    interact();
    expect(local.seat?.itemId).toBe('stool1');
  });

  it('stops if another person occupies a single chair before arrival', () => {
    walkToItemSeat('chair1', { x: 15, z: 11 });
    setRemoteTarget('other', 15, 11, 0, 'sit');
    arrive();
    expect(local.seat).toBeNull();
    expect(local.pathSeat).toBeNull();
    expect(local.anim).toBe('idle');
    expect(fake.sendMove.mock.calls.every((call) => call[3] !== 'sit')).toBe(true);
    expect(fake.toast).toHaveBeenCalledWith('That seat is occupied');
  });

  it('takes a new path to a free cushion if the chosen sofa cushion fills before arrival', () => {
    walkToItemSeat('sofa1', sofaSeats[1]);
    sitRemote('other', sofaSeats[1]);
    arrive();
    expect(local.seat).toMatchObject({ ...sofaSeats[0], itemId: 'sofa1' });
  });

  it('stops if both sofa cushions fill while walking', () => {
    walkToItemSeat('sofa1', sofaSeats[0]);
    sofaSeats.forEach((seat, index) => sitRemote(`other${index}`, seat));
    arrive();
    expect(local.seat).toBeNull();
    expect(local.anim).toBe('idle');
    expect(fake.toast).toHaveBeenCalledWith('All seats here are occupied');
  });

  it('rejects an occupied support customer seat instead of taking the staff seat', () => {
    setRemoteTarget('customer', 20, 21, Math.PI, 'sit');
    expect(sitOn({ x: 20, z: 21, ry: Math.PI, itemId: 'desk1' })).toBe(false);
    expect(local.seat).toBeNull();
    expect(fake.sendMove).not.toHaveBeenCalled();
    expect(fake.toast).toHaveBeenCalledWith('That seat is occupied');
  });

  it('releases a seat immediately when its network target stands up', () => {
    setRemoteTarget('other', 15, 11, 0, 'sit');
    expect(sitOn({ x: 15, z: 11, ry: 0, itemId: 'chair1' })).toBe(false);
    setRemoteTarget('other', 15, 11, 0, 'idle');
    expect(sitOn({ x: 15, z: 11, ry: 0, itemId: 'chair1' })).toBe(true);
    expect(local.seat?.itemId).toBe('chair1');
  });

  it('leaves racing arrow controls seated on the gaming couch', () => {
    const seat = seatsOf(office.items.find((item) => item.id === 'game1')!)[0];
    sitOn({ ...seat, itemId: 'game1' });
    fake.input.x = 1;
    stepLocal(1 / 60, camera);
    expect(local.seat?.itemId).toBe('game1');
    expect(local.anim).toBe('sit');
  });
});
