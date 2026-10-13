import type { Seat } from './catalog';
import type { AnimState } from './types';

/** Matches a seated player's network position to a furniture seat. */
export const SEAT_TOLERANCE = 0.22;

export interface SeatOccupant {
  id?: string;
  x: number;
  z: number;
  anim: AnimState;
}

/** Standing beside a chair does not reserve it; a seated person occupies one spot. */
export function occupiedSeat(seat: { x: number; z: number }, occupants: Iterable<SeatOccupant>, exceptId?: string): boolean {
  for (const person of occupants) {
    if (exceptId !== undefined && person.id === exceptId) continue;
    if (person.anim === 'sit' && Math.hypot(person.x - seat.x, person.z - seat.z) < SEAT_TOLERANCE) return true;
  }
  return false;
}

/**
 * Choose within one furniture item. Role-specific furniture can forbid another seat, so an
 * occupied visitor seat never becomes the staff seat across a support desk.
 */
export function chooseSeat<T extends Seat>(
  seats: readonly T[],
  preferred: { x: number; z: number },
  occupants: Iterable<SeatOccupant>,
  exceptId?: string,
  alternatives = true,
): T | null {
  const ordered = [...seats].sort((a, b) => Math.hypot(a.x - preferred.x, a.z - preferred.z) - Math.hypot(b.x - preferred.x, b.z - preferred.z));
  const people = [...occupants];
  for (const seat of alternatives ? ordered : ordered.slice(0, 1)) {
    if (!occupiedSeat(seat, people, exceptId)) return seat;
  }
  return null;
}
