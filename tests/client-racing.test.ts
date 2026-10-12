import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { seatsOf } from '../shared/catalog';
import { racingRigs } from '../shared/racing';
import { createFromTemplate } from '../shared/templates';

const fake = vi.hoisted(() => ({
  local: { x: 0, z: 0, ry: 0, anim: 'sit' as string, seat: null as null | { x: number; z: number; ry: number; itemId: string }, path: null, pathSeat: null },
  state: {} as Record<string, unknown>,
  sendMove: vi.fn(),
  axis: vi.fn(() => ({ x: 1, y: 0, run: false })),
}));
vi.mock('../client/src/lib/positions', () => ({ local: fake.local }));
vi.mock('../client/src/lib/session', () => ({ getSession: () => ({ sendMove: fake.sendMove }) }));
vi.mock('../client/src/features/audio/focus', () => ({ focusHint: () => null }));
vi.mock('../client/src/state/store', () => ({ getState: () => fake.state, setState: vi.fn(), toast: vi.fn() }));
vi.mock('../client/src/world/input', () => ({ axis: fake.axis }));
vi.mock('../client/src/world/extensions', () => ({ getItemInteraction: () => undefined, nearbyActionFinders: () => [] }));
vi.mock('../client/src/world/officeCache', () => ({ officeData: () => ({ colliders: [], seats: [] }), nearestSeat: () => null }));
import { stepLocal } from '../client/src/world/movement';

const office = createFromTemplate('startup', 'input', 'Input');
const couch = racingRigs(office)[0].couch;
const seat = seatsOf(couch)[0];
beforeEach(() => {
  fake.state = { office, hint: null, toasts: [] };
  Object.assign(fake.local, { x: seat.x, z: seat.z, ry: seat.ry, anim: 'sit', seat: { ...seat, itemId: couch.id }, path: null, pathSeat: null });
  fake.sendMove.mockClear();
  fake.axis.mockClear();
});

describe('racing controls isolation', () => {
  it('keeps racers seated when navigation keys steer their cars', () => {
    stepLocal(0.1, new THREE.PerspectiveCamera());
    expect(fake.axis).not.toHaveBeenCalled();
    expect(fake.local.seat?.itemId).toBe(couch.id);
    expect(fake.local.x).toBe(seat.x);
    expect(fake.local.anim).toBe('sit');
    expect(fake.sendMove).toHaveBeenCalledWith(seat.x, seat.z, seat.ry, 'sit');
  });

  it('preserves ordinary movement and standing from an office chair', () => {
    const chair = office.items.find((i) => i.type === 'chair')!;
    const s = seatsOf(chair)[0];
    Object.assign(fake.local, { x: s.x, z: s.z, ry: s.ry, seat: { ...s, itemId: chair.id } });
    stepLocal(0.1, new THREE.PerspectiveCamera());
    expect(fake.axis).toHaveBeenCalled();
    expect(fake.local.seat).toBeNull();
    expect(fake.local.anim).toBe('walk');
  });
});
