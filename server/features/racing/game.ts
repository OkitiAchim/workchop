import { BASH_MS, COUNTDOWN_MS, CRASH_MS, FINISH_DISTANCE, NITRO_MS, NITRO_SPEED, RACE_MS, TOP_SPEED, raceSplit, roadCenter, type RaceDriver, type RaceInput, type RaceState } from '../../../shared/racing';

const freshCars = (): RaceState['cars'] => [-0.42, 0.42].map((lane) => ({ distance: 0, lane, speed: 0, nitro: 0, boostUntil: 0, slowUntil: 0, crashUntil: 0, crashVehicle: null, immuneUntil: 0 })) as RaceState['cars'];
const idle: RaceInput = { gas: false, steer: 0, brake: false, nitro: false };

/** Every client renders the same server-owned cars, traffic, pickups and result. */
export class RaceGame {
  readonly state: RaceState;
  private controls = new Map<string, RaceInput & { at: number }>();
  private nitroRequests = new Set<string>();
  private lastAt: number;
  private bashAfter = 0;
  private random: () => number;

  constructor(tvId: string, couchId: string, now: number, random = Math.random) {
    this.lastAt = now;
    this.random = random;
    this.state = { tvId, couchId, phase: 'waiting', drivers: [], cars: freshCars(), startAt: 0, endAt: 0, serverAt: now, traffic: [], pickups: [], split: false, seed: 0, winner: null, reason: null };
    this.course();
  }

  seat(id: string, name: string, seat: number, now: number): boolean {
    if (this.state.drivers.some((d) => d.id === id)) return true;
    if (this.state.drivers.length >= 2 || this.state.drivers.some((d) => d.seat === seat)) return false;
    this.state.drivers.forEach((d) => { d.number = 1; });
    this.state.drivers.push({ id, name, seat, number: this.state.drivers.length ? 2 : 1 });
    this.reset(now);
    return true;
  }

  leave(id: string, now: number): boolean {
    const before = this.state.drivers;
    if (!before.some((d) => d.id === id)) return false;
    const remaining = before.filter((d) => d.id !== id);
    if (before.length === 2 && this.state.phase !== 'finished') this.finish(remaining[0], 'forfeit', now);
    this.state.drivers = remaining;
    this.controls.delete(id);
    this.nitroRequests.delete(id);
    if (!remaining.length) this.reset(now);
    else if (this.state.phase !== 'finished') this.state.phase = 'waiting';
    return true;
  }

  start(id: string, now: number): boolean {
    if (this.state.drivers.length !== 2 || this.state.drivers[0].id !== id || !['ready', 'finished'].includes(this.state.phase)) return false;
    this.state.drivers.forEach((d, i) => { d.number = (i + 1) as 1 | 2; });
    Object.assign(this.state, { phase: 'countdown', cars: freshCars(), winner: null, reason: null, split: false, startAt: now + COUNTDOWN_MS, endAt: now + COUNTDOWN_MS + RACE_MS });
    this.state.serverAt = this.lastAt = now;
    this.controls.clear();
    this.nitroRequests.clear();
    this.bashAfter = 0;
    this.course();
    return true;
  }

  input(id: string, input: RaceInput, now: number): void {
    if (!this.state.drivers.some((d) => d.id === id) || !['countdown', 'racing'].includes(this.state.phase)) return;
    // A tap is an edge, not an instruction to repeatedly boost whenever a bar refills.
    if (input.nitro && !this.controls.get(id)?.nitro) this.nitroRequests.add(id);
    this.controls.set(id, { ...input, at: now });
  }

  tick(now: number): void {
    const s = this.state;
    s.serverAt = now;
    if (s.phase === 'countdown' && now >= s.startAt) { s.phase = 'racing'; this.lastAt = s.startAt; }
    if (s.phase !== 'racing') return;
    const dt = Math.max(0, Math.min(0.2, (Math.min(now, s.endAt) - this.lastAt) / 1000));
    this.lastAt = now;
    const before = s.cars.map((c) => c.distance);
    const arrivals = [Infinity, Infinity];
    const inputs = s.drivers.map((d) => {
      const raw = this.controls.get(d.id);
      return raw && now - raw.at < 350 ? raw : idle;
    });
    for (const traffic of s.traffic) {
      traffic.distance += traffic.speed * dt;
      traffic.lane = roadCenter(traffic.distance) + traffic.baseLane + Math.sin((now - s.startAt) / 2100 + traffic.phase) * 0.09;
    }
    for (const [index, driver] of s.drivers.entries()) {
      const c = s.cars[index];
      const input = inputs[index];
      if (c.crashVehicle !== null && now >= c.crashUntil) {
        const vehicle = s.traffic.find((v) => v.id === c.crashVehicle);
        c.distance = Math.max(c.distance, Math.min(FINISH_DISTANCE - 12, (vehicle?.distance ?? c.distance) + 12));
        c.lane = roadCenter(c.distance) + (vehicle && vehicle.lane - roadCenter(vehicle.distance) > 0 ? -0.45 : 0.45);
        c.speed = TOP_SPEED * 0.55;
        c.crashVehicle = null;
        c.immuneUntil = now + 1500;
      }
      if (this.nitroRequests.delete(driver.id) && input !== idle && c.nitro > 0 && c.crashVehicle === null && now >= c.boostUntil) c.boostUntil = now + c.nitro * NITRO_MS;
      const boosting = now < c.boostUntil;
      c.nitro = boosting ? Math.max(0, (c.boostUntil - now) / NITRO_MS) : now >= c.boostUntil && c.boostUntil > 0 ? 0 : c.nitro;
      if (!boosting && c.boostUntil) c.boostUntil = 0;
      const crashed = c.crashVehicle !== null;
      c.lane = Math.max(-1.5, Math.min(1.5, c.lane + (crashed ? 0 : input.steer) * dt * 1.35));
      const onRoad = Math.abs(c.lane - roadCenter(c.distance)) <= 0.92;
      const limit = crashed ? 5 : now < c.slowUntil ? 22 : !onRoad ? 26 : boosting ? NITRO_SPEED : TOP_SPEED;
      const target = crashed ? 5 : input.brake ? 0 : input.gas ? limit : 0;
      const decel = input.brake ? 92 : c.speed > limit ? 70 : 10;
      c.speed += Math.max(-dt * decel, Math.min(dt * (boosting ? 52 : 30), target - c.speed));
      const step = c.speed * dt;
      if (c.distance + step >= FINISH_DISTANCE) arrivals[index] = (FINISH_DISTANCE - c.distance) / Math.max(step, 0.0001);
      c.distance = Math.min(FINISH_DISTANCE, c.distance + step);
      if (!crashed && now >= c.immuneUntil) {
        const hit = s.traffic.find((v) => Math.abs(c.lane - v.lane) < 0.24
          && this.crosses(before[index] - (v.distance - v.speed * dt), c.distance - v.distance, 4.1));
        if (hit) {
          c.crashVehicle = hit.id;
          c.crashUntil = now + CRASH_MS;
          c.boostUntil = 0;
          c.nitro = boosting ? 0 : c.nitro;
          c.speed = 5;
        }
      }
      if (c.crashVehicle === null) for (const pickup of s.pickups) {
        if (pickup.available && Math.abs(c.lane - pickup.lane) < 0.25 && this.crosses(before[index] - pickup.distance, c.distance - pickup.distance, 3)) {
          pickup.available = false;
          if (!boosting) c.nitro = 1;
        }
      }
    }
    this.bash(inputs, now, before);
    s.split = raceSplit(s.split, Math.abs(s.cars[0].distance - s.cars[1].distance));
    if (arrivals.some(Number.isFinite) || now >= s.endAt) {
      const difference = arrivals.some(Number.isFinite) ? arrivals[1] - arrivals[0] : s.cars[0].distance - s.cars[1].distance;
      this.finish(Math.abs(difference) < 0.001 ? null : s.drivers[difference > 0 ? 0 : 1], Math.abs(difference) < 0.001 ? 'draw' : arrivals.some(Number.isFinite) ? 'finish' : 'time', now);
    }
  }

  snapshot(now: number): RaceState {
    return { ...this.state, serverAt: now, drivers: this.state.drivers.map((d) => ({ ...d })), cars: this.state.cars.map((c) => ({ ...c })) as RaceState['cars'], traffic: this.state.traffic.map((v) => ({ ...v })), pickups: this.state.pickups.map((p) => ({ ...p })) };
  }

  private crosses(before: number, after: number, radius: number): boolean {
    return Math.min(before, after) <= radius && Math.max(before, after) >= -radius;
  }

  private bash(inputs: RaceInput[], now: number, before: number[]): void {
    const [a, b] = this.state.cars;
    if (now < this.bashAfter || [a, b].some((c) => c.crashVehicle !== null || now < c.immuneUntil)
      || Math.abs(a.lane - b.lane) >= 0.25 || !this.crosses(before[0] - before[1], a.distance - b.distance, 4.2)) return;
    const shoveA = a.speed > 12 && inputs[0].steer * (b.lane - a.lane) > 0.015;
    const shoveB = b.speed > 12 && inputs[1].steer * (a.lane - b.lane) > 0.015;
    const rearA = a.speed > 12 && before[0] < before[1] && a.speed > b.speed + 3;
    const rearB = b.speed > 12 && before[1] < before[0] && b.speed > a.speed + 3;
    if (!shoveA && !shoveB && !rearA && !rearB) return;
    const attackers = [shoveA || rearA, shoveB || rearB];
    for (let i = 0; i < 2; i++) if (attackers[1 - i]) {
      const victim = this.state.cars[i];
      victim.slowUntil = now + BASH_MS;
      victim.speed *= 0.45;
    }
    const direction = a.lane <= b.lane ? -1 : 1;
    a.lane = Math.max(-1.5, Math.min(1.5, a.lane + direction * 0.15));
    b.lane = Math.max(-1.5, Math.min(1.5, b.lane - direction * 0.15));
    this.bashAfter = now + 1000;
  }

  private course(): void {
    const s = this.state;
    s.seed = Math.floor(this.random() * 0xffffffff);
    let seed = s.seed;
    const rand = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 0x100000000; };
    s.traffic = [];
    s.pickups = [];
    const colors = ['#ffce45', '#e44896', '#a7ff64', '#a47dff', '#f4f7ff'];
    for (let distance = 220; distance < FINISH_DISTANCE + 400; distance += 85 + rand() * 85) {
      const baseLane = [-0.65, -0.22, 0.22, 0.65][Math.floor(rand() * 4)];
      s.traffic.push({ id: s.traffic.length, distance, lane: roadCenter(distance) + baseLane, baseLane, speed: rand() < 0.18 ? -18 - rand() * 8 : 17 + rand() * 15, phase: rand() * Math.PI * 2, color: colors[Math.floor(rand() * colors.length)] });
    }
    for (let distance = 95; distance < FINISH_DISTANCE - 50; distance += 145 + rand() * 90) {
      s.pickups.push({ id: s.pickups.length, distance, lane: roadCenter(distance) + (rand() * 1.2 - 0.6), available: true });
    }
  }

  private finish(driver: RaceDriver | null, reason: RaceState['reason'], now: number): void {
    Object.assign(this.state, { phase: 'finished', winner: driver ? { number: driver.number, name: driver.name } : null, reason, serverAt: now });
    this.state.cars.forEach((c) => { c.speed = 0; c.boostUntil = 0; });
    this.controls.clear();
    this.nitroRequests.clear();
  }

  private reset(now: number): void {
    Object.assign(this.state, { phase: this.state.drivers.length === 2 ? 'ready' : 'waiting', cars: freshCars(), startAt: 0, endAt: 0, serverAt: now, winner: null, reason: null, split: false });
    this.controls.clear();
    this.nitroRequests.clear();
    this.lastAt = now;
    this.bashAfter = 0;
    this.course();
  }
}
