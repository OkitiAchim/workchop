import type { PerspectiveCamera } from 'three';
import { roadCenter } from '../../../../shared/racing';

export type RacePerspective = 0 | 1 | 'leader';
export const ROAD_LANE_SCALE = 9;

/** A racer always follows their own car; only the broadcast follows the leader. */
export function raceViewDriver(cars: readonly { distance: number }[], perspective: RacePerspective, previousLeader: 0 | 1 = 0): 0 | 1 {
  if (perspective !== 'leader') return perspective;
  if (cars[0].distance === cars[1].distance) return previousLeader;
  return cars[1].distance > cars[0].distance ? 1 : 0;
}

export function positionRaceCamera(camera: PerspectiveCamera, distance: number, speed: number, lane: number): void {
  const x = lane * ROAD_LANE_SCALE;
  const curveAhead = (roadCenter(distance + 35) - roadCenter(distance)) * ROAD_LANE_SCALE;
  camera.fov = 58 + Math.min(7, speed / 12);
  camera.position.set(x, 4.5, -distance + 10.5);
  camera.lookAt(x + curveAhead * 0.65, 1.05, -distance - 25);
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld();
}
