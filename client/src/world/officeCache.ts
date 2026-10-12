import { getEntry, seatsOf, type Seat } from '../../../shared/catalog';
import { buildColliders, type AABB } from '../../../shared/geometry';
import type { Office } from '../../../shared/types';
import { racingItems } from '../../../shared/racing';
import { useRacing } from '../features/racing/state';

export interface OfficeData {
  colliders: AABB[];
  seats: (Seat & { itemId: string; type: string; solid: boolean })[];
}

let cachedFor: Office | null = null;
let cached: OfficeData = { colliders: [], seats: [] };

/** Collision boxes and seats for the current office, recomputed only when the office changes. */
export function officeData(office: Office): OfficeData {
  if (office !== cachedFor) {
    cachedFor = office;
    cached = {
      colliders: buildColliders(office),
      seats: racingItems(office).flatMap((item) =>
        seatsOf(item).map((s) => ({ ...s, itemId: item.id, type: item.type, solid: !!getEntry(item.type)?.solid })),
      ),
    };
  }
  return cached;
}

export function nearestSeat(office: Office, x: number, z: number, maxDist: number, accept: (seat: OfficeData['seats'][number]) => boolean = () => true) {
  let best: OfficeData['seats'][number] | null = null;
  let bestD = maxDist;
  for (const s of officeData(office).seats) {
    if (!accept(s)) continue;
    if (s.type === 'gaming-couch') {
      const game = Object.values(useRacing.getState().games).find((g) => g.couchId === s.itemId);
      const item = racingItems(office).find((i) => i.id === s.itemId);
      const index = item ? seatsOf(item).findIndex((seat) => seat.x === s.x && seat.z === s.z) : -1;
      if (game?.drivers.some((d) => d.seat === index)) continue;
    }
    const d = Math.hypot(s.x - x, s.z - z);
    if (d < bestD) {
      bestD = d;
      best = s;
    }
  }
  return best;
}
