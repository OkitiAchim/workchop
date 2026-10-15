import { describe, expect, it } from 'vitest';
import { seatsOf } from '../shared/catalog';
import { buildColliders, isBlocked, standUpSpot } from '../shared/geometry';
import { BASH_MS, COUNTDOWN_MS, CRASH_MS, DEFAULT_RACING_ID, FINISH_DISTANCE, NITRO_MS, RACE_MS, TOP_SPEED, raceSplit, racingItems, racingRigs, validRaceInput } from '../shared/racing';
import { createFromTemplate } from '../shared/templates';
import { RaceGame } from '../server/features/racing/game';

function paired(): RaceGame {
  const game = new RaceGame('tv', 'couch', 0);
  expect(game.seat('alice', 'Alice', 1, 0)).toBe(true);
  expect(game.seat('bob', 'Bob', 0, 1)).toBe(true);
  return game;
}

describe('couch race', () => {
  it('assigns the first arrival Player 1 regardless of seat, rejects occupied seats and spectators', () => {
    const game = new RaceGame('tv', 'couch', 0);
    game.seat('alice', 'Alice', 1, 0);
    expect(game.start('alice', 1)).toBe(false);
    expect(game.seat('bob', 'Bob', 1, 1)).toBe(false);
    game.seat('bob', 'Bob', 0, 1);
    expect(game.state.drivers.map((d) => [d.id, d.number, d.seat])).toEqual([['alice', 1, 1], ['bob', 2, 0]]);
    expect(game.seat('eve', 'Eve', 0, 1)).toBe(false);
    expect(game.start('eve', 1)).toBe(false);
    expect(game.start('bob', 1)).toBe(false);
    expect(game.start('alice', 1)).toBe(true);
  });

  it('counts down for three seconds, then uses a separate two-minute race deadline', () => {
    const game = paired();
    game.start('alice', 0);
    game.input('alice', { gas: true, steer: 0 }, COUNTDOWN_MS - 100);
    game.tick(COUNTDOWN_MS - 1);
    expect(game.state.phase).toBe('countdown');
    expect(game.state.cars[0].distance).toBe(0);
    game.tick(COUNTDOWN_MS);
    expect(game.state.phase).toBe('racing');
    expect(game.state.endAt - game.state.startAt).toBe(RACE_MS);
    expect(RACE_MS).toBe(120_000);
    game.state.cars[0].distance = 5;
    game.tick(COUNTDOWN_MS + RACE_MS);
    expect(game.state.phase).toBe('finished');
    expect(game.state.winner).toEqual({ number: 1, name: 'Alice' });
    expect(game.state.reason).toBe('time');
  });

  it('only accepts seated players controls, accelerates and steers, and releases stale input', () => {
    const game = paired();
    game.start('alice', 0);
    game.tick(COUNTDOWN_MS);
    for (let now = COUNTDOWN_MS + 50; now <= COUNTDOWN_MS + 1000; now += 50) {
      game.input('alice', { gas: true, steer: 1 }, now);
      game.input('eve', { gas: true, steer: 1 }, now);
      game.tick(now);
    }
    expect(game.state.cars[0].distance).toBeGreaterThan(0);
    expect(game.state.cars[0].lane).toBeGreaterThan(-0.25);
    expect(game.state.cars[1].distance).toBe(0);
    const speed = game.state.cars[0].speed;
    for (let now = COUNTDOWN_MS + 1050; now <= COUNTDOWN_MS + 3000; now += 50) game.tick(now);
    expect(game.state.cars[0].speed).toBeLessThan(speed);
    for (let now = COUNTDOWN_MS + 3050; now <= COUNTDOWN_MS + 7000; now += 50) game.tick(now);
    expect(game.state.cars[0].speed).toBe(0);
  });

  it('finishes early at the finish line and supports replay with a fresh countdown', () => {
    const game = paired();
    game.start('alice', 0);
    game.tick(COUNTDOWN_MS);
    Object.assign(game.state.cars[0], { distance: FINISH_DISTANCE - 0.1, speed: 24, lane: 0 });
    game.input('alice', { gas: true, steer: 0 }, COUNTDOWN_MS);
    game.tick(COUNTDOWN_MS + 50);
    expect(game.state.winner?.number).toBe(1);
    expect(game.state.reason).toBe('finish');
    expect(game.start('bob', 4000)).toBe(false);
    expect(game.start('alice', 4000)).toBe(true);
    expect(game.state.phase).toBe('countdown');
    expect(game.state.winner).toBeNull();
    expect(game.state.cars[0].distance).toBe(0);
  });

  it.each([0, 1])('standing during countdown awards the remaining player and transfers hosting (%s)', (leaver) => {
    const game = paired();
    game.start('alice', 0);
    game.leave(leaver ? 'bob' : 'alice', 1000);
    expect(game.state.phase).toBe('finished');
    expect(game.state.winner?.number).toBe(leaver ? 1 : 2);
    expect(game.state.reason).toBe('forfeit');
    const survivor = leaver ? 'alice' : 'bob';
    expect(game.start(survivor, 1100)).toBe(false);
    game.seat('cara', 'Cara', leaver ? 0 : 1, 1200);
    expect(game.state.drivers[0]).toMatchObject({ id: survivor, number: 1 });
    expect(game.start(survivor, 1300)).toBe(true);
  });

  it('handles a tied deadline and clears the room after everyone leaves', () => {
    const game = paired();
    game.start('alice', 0);
    game.tick(COUNTDOWN_MS + RACE_MS);
    expect(game.state.reason).toBe('draw');
    game.leave('alice', 70_000);
    game.leave('bob', 70_001);
    expect(game.state.phase).toBe('waiting');
    expect(game.state.drivers).toHaveLength(0);
  });

  it('validates untrusted controls and makes snapshots independent', () => {
    for (const bad of [null, {}, { gas: 'true', steer: 0 }, { gas: true, steer: 3 }, { gas: true, steer: NaN }, { gas: true, steer: 0, brake: 'yes' }, { gas: true, steer: 0, nitro: 1 }]) expect(validRaceInput(bad)).toBe(false);
    expect(validRaceInput({ gas: true, steer: -1 })).toBe(true);
    const game = paired();
    const snapshot = game.snapshot(2);
    snapshot.drivers[0].name = 'Fake';
    snapshot.cars[0].distance = 99;
    expect(game.state.drivers[0].name).toBe('Alice');
    expect(game.state.cars[0].distance).toBe(0);
    snapshot.traffic[0].distance = -50;
    snapshot.pickups[0].available = false;
    expect(game.state.traffic[0].distance).toBeGreaterThan(0);
    expect(game.state.pickups[0].available).toBe(true);
  });
});

function running(): RaceGame {
  const game = paired(); game.start('alice', 0); game.tick(COUNTDOWN_MS);
  game.state.traffic = []; game.state.pickups = [];
  return game;
}

describe('competitive racing', () => {
  it('coasts gradually when gas is released, while B brakes sharply and overrides gas', () => {
    const coast = running(); const brake = running();
    for (const game of [coast, brake]) Object.assign(game.state.cars[0], { speed: TOP_SPEED, distance: 200, lane: 0 });
    coast.input('alice', { gas: false, steer: 0 }, 3100); coast.tick(3200);
    brake.input('alice', { gas: true, steer: 0, brake: true }, 3100); brake.tick(3200);
    expect(coast.state.cars[0].speed).toBeCloseTo(TOP_SPEED - 2);
    expect(brake.state.cars[0].speed).toBeLessThan(coast.state.cars[0].speed - 10);
  });

  it('gives a pickup to only one racer, consumes a single N tap over four seconds and returns to regular speed', () => {
    const game = running();
    for (const c of game.state.cars) Object.assign(c, { distance: 95, lane: 0, speed: 50 });
    game.state.pickups = [{ id: 1, distance: 101, lane: 0, available: true }];
    game.input('alice', { gas: true, steer: 0 }, 3100); game.input('bob', { gas: true, steer: 0 }, 3100); game.tick(3200);
    expect(game.state.cars.map((c) => c.nitro)).toEqual([1, 0]);
    expect(game.state.pickups[0].available).toBe(false);
    game.input('alice', { gas: true, steer: 0, nitro: true }, 3250); game.tick(3250);
    expect(game.state.cars[0].boostUntil).toBe(3250 + NITRO_MS);
    for (let now = 3300; now <= 4300; now += 50) { game.input('alice', { gas: true, steer: 0 }, now); game.tick(now); }
    expect(game.state.cars[0].speed).toBeGreaterThan(TOP_SPEED);
    expect(game.state.cars[0].nitro).toBeCloseTo(0.7375);
    for (let now = 4350; now <= 8300; now += 50) { game.input('alice', { gas: true, steer: 0 }, now); game.tick(now); }
    expect(game.state.cars[0].nitro).toBe(0);
    expect(game.state.cars[0].boostUntil).toBe(0);
    expect(game.state.cars[0].speed).toBe(TOP_SPEED);
  });

  it('does not arm an empty tank or repeatedly activate a held nitro key', () => {
    const game = running(); game.input('alice', { gas: true, steer: 0, nitro: true }, 3050); game.tick(3050);
    expect(game.state.cars[0].boostUntil).toBe(0);
    game.state.cars[0].nitro = 1;
    game.input('alice', { gas: true, steer: 0, nitro: true }, 3100); game.tick(3100);
    expect(game.state.cars[0].boostUntil).toBe(0);
    game.input('alice', { gas: true, steer: 0, nitro: false }, 3150); game.tick(3150);
    game.input('alice', { gas: true, steer: 0, nitro: true }, 3200); game.tick(3200);
    expect(game.state.cars[0].boostUntil).toBe(3200 + NITRO_MS);
  });

  it('lets a racer coast or brake while nitro is still burning', () => {
    for (const brake of [false, true]) {
      const game = running(); const c = game.state.cars[0];
      Object.assign(c, { speed: TOP_SPEED, nitro: 1, lane: 0 });
      game.input('alice', { gas: true, steer: 0, nitro: true }, 3050); game.tick(3050);
      const before = c.speed;
      game.input('alice', { gas: false, steer: 0, brake }, 3100); game.tick(3100);
      expect(c.speed).toBeLessThan(before);
      expect(c.speed).toBeCloseTo(before - (brake ? 92 : 10) * 0.05);
      expect(c.boostUntil).toBeGreaterThan(3100);
    }
  });

  it.each([0, 1])('lets either racer bash the other for two seconds without trapping them (%s)', (attacker) => {
    const game = running();
    Object.assign(game.state.cars[0], { distance: 200, lane: -0.12, speed: 50 });
    Object.assign(game.state.cars[1], { distance: 200, lane: 0.12, speed: 50 });
    game.input('alice', { gas: true, steer: attacker === 0 ? 1 : 0 }, 3050);
    game.input('bob', { gas: true, steer: attacker === 1 ? -1 : 0 }, 3050); game.tick(3050);
    const victim = game.state.cars[1 - attacker];
    expect(victim.slowUntil).toBe(3050 + BASH_MS);
    expect(victim.speed).toBeLessThan(25);
    expect(game.state.cars[attacker].speed).toBeGreaterThan(50);
    for (let now = 3100; now <= 6000; now += 50) {
      game.input('alice', { gas: true, steer: 0 }, now); game.input('bob', { gas: true, steer: 0 }, now); game.tick(now);
    }
    expect(victim.speed).toBeGreaterThan(45);
  });

  it('lets a racer steer away or accelerate out of a bash, and detects rear-end hits', () => {
    const dodge = running();
    Object.assign(dodge.state.cars[0], { distance: 200, lane: -0.16, speed: 50 });
    Object.assign(dodge.state.cars[1], { distance: 200, lane: 0.16, speed: 50 });
    dodge.input('alice', { gas: true, steer: 1 }, 3050); dodge.input('bob', { gas: true, steer: 1 }, 3050); dodge.tick(3050);
    expect(dodge.state.cars[1].slowUntil).toBe(0);
    Object.assign(dodge.state.cars[0], { distance: 210, lane: 0, speed: 50 });
    Object.assign(dodge.state.cars[1], { distance: 212, lane: 0, speed: 20 });
    dodge.input('alice', { gas: true, steer: 0 }, 3100); dodge.input('bob', { gas: false, steer: 0 }, 3100); dodge.tick(3100);
    expect(dodge.state.cars[1].slowUntil).toBe(3100 + BASH_MS);
  });

  it('does not let a stationary car bash a moving opponent just by steering', () => {
    const game = running();
    Object.assign(game.state.cars[0], { distance: 200, lane: -0.12, speed: 0 });
    Object.assign(game.state.cars[1], { distance: 200, lane: 0.12, speed: 50 });
    game.input('alice', { gas: false, steer: 1 }, 3050); game.input('bob', { gas: true, steer: 0 }, 3050); game.tick(3050);
    expect(game.state.cars[1].slowUntil).toBe(0);
  });

  it('moves traffic, slows a crash for 2.5 seconds, respawns ahead and gives recovery immunity', () => {
    const game = running(); const c = game.state.cars[0];
    Object.assign(c, { distance: 198, lane: 0, speed: TOP_SPEED });
    game.state.traffic = [{ id: 7, distance: 200, lane: 0, baseLane: -0.2, speed: 20, phase: 0, color: '#ffffff' }];
    game.input('alice', { gas: true, steer: 0 }, 3100); game.tick(3100);
    expect(game.state.traffic[0].distance).toBe(202);
    expect(c.crashVehicle).toBe(7); expect(c.speed).toBe(5);
    expect(c.crashUntil).toBe(3100 + CRASH_MS);
    for (let now = 3150; now < c.crashUntil; now += 50) { game.input('alice', { gas: true, steer: 1 }, now); game.tick(now); }
    expect(c.crashVehicle).toBe(7);
    const respawnAt = c.crashUntil;
    game.input('alice', { gas: true, steer: 0 }, respawnAt); game.tick(respawnAt);
    expect(c.crashVehicle).toBeNull(); expect(c.distance).toBeGreaterThan(game.state.traffic[0].distance + 10);
    expect(c.immuneUntil).toBe(respawnAt + 1500);
    expect(c.speed).toBeGreaterThan(30);
  });

  it('randomizes a replay course but shares stable traffic and pickups in each snapshot', () => {
    let seed = 0.1;
    const game = new RaceGame('tv', 'couch', 0, () => { seed += 0.1; return seed; });
    game.seat('alice', 'Alice', 0, 0); game.seat('bob', 'Bob', 1, 1);
    const first = game.snapshot(2);
    expect(first.traffic.length).toBeGreaterThan(30); expect(first.pickups.length).toBeGreaterThan(20);
    expect(first.traffic.some((v) => v.speed < 0)).toBe(true);
    game.start('alice', 3);
    expect(game.state.seed).not.toBe(first.seed);
    expect(game.state.pickups).not.toEqual(first.pickups);
    expect(game.snapshot(4).traffic).toEqual(game.snapshot(5).traffic);
  });

  it('splits and merges with hysteresis and never changes car movement when the camera mode changes', () => {
    expect(raceSplit(false, 73)).toBe(true); expect(raceSplit(true, 60)).toBe(true);
    expect(raceSplit(true, 41)).toBe(false); expect(raceSplit(false, 60)).toBe(false);
    const a = running(); const b = running();
    for (const game of [a, b]) {
      Object.assign(game.state.cars[0], { distance: 200, speed: 50, lane: -0.4 });
      Object.assign(game.state.cars[1], { distance: 280, speed: 50, lane: 0.4 });
      game.input('alice', { gas: true, steer: 0 }, 3050); game.input('bob', { gas: true, steer: 0 }, 3050);
    }
    b.state.split = true; a.tick(3050); b.tick(3050);
    expect(a.state.split).toBe(true); expect(a.state.cars).toEqual(b.state.cars);
    a.state.cars[1].distance = a.state.cars[0].distance + 30; a.tick(3100);
    expect(a.state.split).toBe(false);
  });

  it('awards the actual first crossing even when both cars cross in one server tick', () => {
    const game = running();
    Object.assign(game.state.cars[0], { distance: FINISH_DISTANCE - 1, speed: 40, lane: -0.4 });
    Object.assign(game.state.cars[1], { distance: FINISH_DISTANCE - 0.2, speed: 40, lane: 0.4 });
    game.input('alice', { gas: true, steer: 0 }, 3050); game.input('bob', { gas: true, steer: 0 }, 3050); game.tick(3050);
    expect(game.state.winner?.number).toBe(2); expect(game.state.reason).toBe('finish');
  });
});

describe('games corner layout', () => {
  it('adds one station to new and old startup offices without modifying saved data', () => {
    const office = createFromTemplate('startup', 'test', 'Test');
    expect(racingRigs(office)).toHaveLength(1);
    const original = office.items.filter((i) => !['racing-tv', 'gaming-couch', 'gaming-table'].includes(i.type));
    const legacy = { ...office, items: original };
    const items = racingItems(legacy);
    expect(items.filter((i) => i.id.startsWith(DEFAULT_RACING_ID))).toHaveLength(3);
    expect(legacy.items).toBe(original);
    expect(racingItems({ ...legacy, items })).toEqual(items);
    expect(racingRigs(legacy)).toHaveLength(1);
    expect(racingRigs(createFromTemplate('blank', 'blank', 'Blank'))).toHaveLength(0);
    expect(racingRigs(createFromTemplate('support', 'support', 'Support'))).toHaveLength(0);
  });

  it('leaves clear walking space, keeps the spawn free and lets both sitters stand safely', () => {
    const office = createFromTemplate('startup', 'test', 'Test');
    const rig = racingRigs(office)[0];
    const colliders = buildColliders(office);
    expect(rig.tv.z - rig.couch.z).toBeGreaterThan(4);
    expect(rig.couch.rot).toBe((rig.tv.rot + 2) % 4);
    expect(isBlocked(office.settings.spawn.x, office.settings.spawn.z, colliders, office.settings)).toBe(false);
    for (const seat of seatsOf(rig.couch)) {
      const spot = standUpSpot(seat, true, colliders, office.settings);
      expect(isBlocked(spot.x, spot.z, colliders, office.settings)).toBe(false);
    }
  });
});
