import { getEntry, seatsOf, type Seat } from '../../../shared/catalog';
import { buildColliders, type AABB } from '../../../shared/geometry';
import type { Office } from '../../../shared/types';
import { racingItems } from '../../../shared/racing';
import { chooseSeat, occupiedSeat, type SeatOccupant } from '../../../shared/seating';
import { remoteTargets } from '../lib/positions';
import { getState } from '../state/store';

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

/** Network targets are updated on every move; the store only holds remote profile details. */
function seatOccupants(): SeatOccupant[] {
  return Array.from(remoteTargets, ([id, person]) => ({ id, x: person.x, z: person.z, anim: person.anim }));
}

/** Pick a free spot on this item, keeping a support visitor on their own side of the desk. */
export function seatOnItem(office: Office, itemId: string, preferred: { x: number; z: number }): OfficeData['seats'][number] | null {
  const seats = officeData(office).seats.filter((seat) => seat.itemId === itemId);
  return chooseSeat(seats, preferred, seatOccupants(), getState().selfId ?? undefined, seats[0]?.type !== 'support-desk');
}

export function nearestSeat(office: Office, x: number, z: number, maxDist: number, accept: (seat: OfficeData['seats'][number]) => boolean = () => true) {
  let best: OfficeData['seats'][number] | null = null;
  let bestD = maxDist;
  const occupants = seatOccupants();
  const selfId = getState().selfId ?? undefined;
  for (const s of officeData(office).seats) {
    if (!accept(s)) continue;
    if (occupiedSeat(s, occupants, selfId)) continue;
    const d = Math.hypot(s.x - x, s.z - z);
    if (d < bestD) {
      bestD = d;
      best = s;
    }
  }
  return best;
}
