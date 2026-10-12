import { describe, expect, it } from 'vitest';
import { Frustum, Matrix4, PerspectiveCamera, Vector3 } from 'three';
import { positionRaceCamera, raceViewDriver, ROAD_LANE_SCALE } from '../client/src/features/racing/camera';

function frustum(camera: PerspectiveCamera) {
  return new Frustum().setFromProjectionMatrix(new Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
}
describe('dedicated racing viewpoints', () => {
  it('always follows the selected player even when the opponent is far ahead or behind', () => {
    for (const cars of [[{ distance: 200 }, { distance: 2000 }], [{ distance: 2000 }, { distance: 200 }]]) {
      expect(raceViewDriver(cars, 0)).toBe(0);
      expect(raceViewDriver(cars, 1)).toBe(1);
      expect(raceViewDriver(cars, 'leader')).toBe(cars[1].distance > cars[0].distance ? 1 : 0);
    }
  });
  it('the broadcast changes to the new leader, retaining its target only on an exact tie', () => {
    expect(raceViewDriver([{ distance: 300 }, { distance: 301 }], 'leader', 0)).toBe(1);
    expect(raceViewDriver([{ distance: 302 }, { distance: 301 }], 'leader', 1)).toBe(0);
    expect(raceViewDriver([{ distance: 301 }, { distance: 301 }], 'leader', 1)).toBe(1);
  });
  it('keeps the player visible in a full-width chase view at all speeds and road positions', () => {
    for (const distance of [0, 500, 2900]) for (const lane of [-1.5, 0, 1.5]) for (const speed of [0, 84]) {
      const camera = new PerspectiveCamera(58, 1280 / 720, 0.1, 650);
      positionRaceCamera(camera, distance, speed, lane);
      const point = new Vector3(lane * ROAD_LANE_SCALE, 0.7, -distance);
      expect(frustum(camera).containsPoint(point)).toBe(true);
      const projected = point.project(camera);
      expect(Math.abs(projected.x)).toBeLessThan(0.98);
      expect(Math.abs(projected.y)).toBeLessThan(0.98);
    }
  });
  it('shows a nearby opponent naturally but never reframes to include a distant trailing car', () => {
    const camera = new PerspectiveCamera(58, 1280 / 720, 0.1, 650);
    positionRaceCamera(camera, 300, 56, -0.42);
    expect(frustum(camera).containsPoint(new Vector3(0.42 * ROAD_LANE_SCALE, 0.7, -300))).toBe(true);
    expect(frustum(camera).containsPoint(new Vector3(-0.42 * ROAD_LANE_SCALE, 0.7, -220))).toBe(false);
  });
});
