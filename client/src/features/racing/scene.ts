import * as THREE from 'three';
import { CAR_COLORS, FINISH_DISTANCE, roadCenter, type RaceState } from '../../../../shared/racing';
import { positionRaceCamera, raceViewDriver, ROAD_LANE_SCALE, type RacePerspective } from './camera';
import { NightCity } from './city';
import { RaceVehicles } from './vehicles';
import { currentRaceInput } from './state';

const W = 1280;
const H = 720;
interface VisualCar { distance: number; lane: number; laneVelocity: number }
interface View {
  canvas: HTMLCanvasElement; lastAt: number; lastGame?: RaceState;
  cars: VisualCar[]; startAt: number; driver: 0 | 1;
}

/** One GPU renderer, independent full-width camera frames, and server-owned race physics. */
export class RaceScene {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(58, W / H, 0.1, 650);
  private city = new NightCity();
  private vehicles = new RaceVehicles();
  private racers = CAR_COLORS.map((color) => this.vehicles.car(color));
  private traffic = Array.from({ length: 16 }, (_, i) => this.vehicles.car('#adb9c7', true, i % 3));
  private cans: THREE.Group[] = [];
  private finish = new THREE.Group();
  private views = new Map<string, View>();
  private geometry: THREE.BufferGeometry[] = [];
  private materials: THREE.Material[] = [];

  constructor() {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(W, H, false);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.15;
    this.scene.background = new THREE.Color('#07101f');
    this.scene.fog = new THREE.Fog('#101a2c', 140, 510);
    this.scene.environment = this.city.environment;
    this.scene.add(new THREE.HemisphereLight('#a8c8ff', '#2a1e33', 1.5));
    const moon = new THREE.DirectionalLight('#bfd5ff', 2.2);
    moon.position.set(-25, 45, 15); this.scene.add(moon);
    const rim = new THREE.DirectionalLight('#ff728d', 1.1);
    rim.position.set(18, 12, -35); this.scene.add(rim);
    this.scene.add(this.city.root, ...this.racers, ...this.traffic);
    const canGeometry = new THREE.CylinderGeometry(0.24, 0.24, 0.8, 12);
    const ringGeometry = new THREE.TorusGeometry(0.7, 0.035, 6, 28);
    const canMaterial = new THREE.MeshStandardMaterial({ color: '#68edff', emissive: '#2ad3fa', emissiveIntensity: 1.7, metalness: 0.65, roughness: 0.25 });
    const ringMaterial = new THREE.MeshBasicMaterial({ color: '#62eaff' });
    this.geometry.push(canGeometry, ringGeometry); this.materials.push(canMaterial, ringMaterial);
    this.cans = Array.from({ length: 8 }, () => {
      const g = new THREE.Group();
      const can = new THREE.Mesh(canGeometry, canMaterial); can.position.y = 0.95;
      const ring = new THREE.Mesh(ringGeometry, ringMaterial); ring.rotation.x = -Math.PI / 2; ring.position.y = 0.045;
      g.add(can, ring); this.scene.add(g); return g;
    });
    const box = new THREE.BoxGeometry(); this.geometry.push(box);
    const white = new THREE.MeshStandardMaterial({ color: '#dde6ed', roughness: 0.5 });
    const dark = new THREE.MeshStandardMaterial({ color: '#111825' });
    const gold = new THREE.MeshStandardMaterial({ color: '#ffce6a', emissive: '#ffaa36', emissiveIntensity: 0.8, metalness: 0.6 });
    this.materials.push(white, dark, gold);
    const piece = (mat: THREE.Material, p: [number, number, number], s: [number, number, number]) => {
      const mesh = new THREE.Mesh(box, mat); mesh.position.set(...p); mesh.scale.set(...s); this.finish.add(mesh);
    };
    for (let x = 0; x < 16; x++) for (let z = 0; z < 2; z++) piece((x + z) % 2 ? dark : white, [x - 7.5, 0.025, z * 1.2], [1, 0.018, 1.2]);
    for (const side of [-1, 1]) piece(dark, [side * 19, 4.4, 0], [0.4, 8.8, 0.5]);
    piece(gold, [0, 8.7, 0], [38.5, 0.45, 0.5]);
    this.scene.add(this.finish);
  }

  render(game: RaceState | undefined, now: number, perspective: RacePerspective = 'leader'): HTMLCanvasElement {
    const key = `${game?.tvId ?? 'preview'}:${perspective}`;
    let view = this.views.get(key);
    if (!view) {
      const canvas = document.createElement('canvas'); canvas.width = W; canvas.height = H;
      view = { canvas, lastAt: 0, cars: [{ distance: 0, lane: -0.42, laneVelocity: 0 }, { distance: 0, lane: 0.42, laneVelocity: 0 }], startAt: -1, driver: 0 };
      this.views.set(key, view);
    }
    if (now - view.lastAt < 14 && view.lastGame === game) return view.canvas;
    const dt = Math.max(0.001, Math.min(0.1, (now - view.lastAt) / 1000));
    const fresh = view.startAt !== (game?.startAt ?? 0);
    const active = game?.phase === 'racing';
    const extrapolate = active ? Math.max(0, Math.min(0.12, (now - game.serverAt) / 1000)) : 0;
    const localInput = perspective === 'leader' ? undefined : currentRaceInput();
    for (let i = 0; i < 2; i++) {
      const c = game?.cars[i]; const target = view.cars[i];
      if (game && view.lastGame && game !== view.lastGame && game.serverAt > view.lastGame.serverAt) {
        const elapsed = (game.serverAt - view.lastGame.serverAt) / 1000;
        target.laneVelocity = Math.max(-1.35, Math.min(1.35, ((c?.lane ?? 0) - view.lastGame.cars[i].lane) / elapsed));
      }
      const distance = Math.min(FINISH_DISTANCE, (c?.distance ?? 0) + (c?.speed ?? 0) * extrapolate);
      const steering = localInput && perspective === i ? localInput.steer * 1.35 : target.laneVelocity;
      // Predict only a fraction of a network tick; collisions, nitro and wins remain server-owned.
      const lane = Math.max(-1.5, Math.min(1.5, (c?.lane ?? (i ? 0.42 : -0.42)) + (c?.crashVehicle === null ? steering * extrapolate : 0)));
      const k = fresh || !active || Math.abs(distance - target.distance) > 25 ? 1 : 1 - Math.exp(-dt * 30);
      target.distance += (distance - target.distance) * k;
      target.lane += (lane - target.lane) * k;
    }
    view.driver = raceViewDriver(game?.cars ?? view.cars, perspective, view.driver);
    const followed = view.cars[view.driver];
    const distance = followed.distance;
    this.city.update(distance, now);
    for (let i = 0; i < 2; i++) {
      const c = game?.cars[i]; const visual = view.cars[i]; const racer = this.racers[i];
      racer.position.set(visual.lane * ROAD_LANE_SCALE, 0, -visual.distance);
      const heading = -Math.atan((roadCenter(visual.distance + 4) - roadCenter(visual.distance - 4)) * ROAD_LANE_SCALE / 8);
      const steer = localInput && perspective === i ? localInput.steer * 1.35 : visual.laneVelocity;
      racer.rotation.set(c?.crashVehicle !== null && c?.crashVehicle !== undefined ? Math.sin(now / 80) * 0.035 : 0,
        heading - steer * 0.055, steer * 0.012);
      racer.visible = !c || now >= c.immuneUntil || Math.floor(now / 100) % 2 === 0;
      this.vehicles.animate(racer, c?.speed ?? 0, !!c && now < c.boostUntil, !!c && (now < c.slowUntil || c.crashVehicle !== null || (perspective === i && !!localInput?.brake)), now);
    }
    const nearby = (game?.traffic ?? []).filter((v) => v.distance > distance - 40 && v.distance < distance + 470).slice(0, this.traffic.length);
    for (let i = 0; i < this.traffic.length; i++) {
      const model = this.traffic[i]; const vehicle = nearby[i]; model.visible = !!vehicle;
      if (!vehicle) continue;
      const d = vehicle.distance + vehicle.speed * extrapolate;
      model.position.set(vehicle.lane * ROAD_LANE_SCALE, 0, -d);
      model.rotation.y = (vehicle.speed < 0 ? Math.PI : 0) - Math.atan((roadCenter(d + 4) - roadCenter(d - 4)) * ROAD_LANE_SCALE / 8);
      this.vehicles.setColor(model, vehicle.color);
      this.vehicles.animate(model, Math.abs(vehicle.speed), false, false, now);
    }
    const pickups = (game?.pickups ?? []).filter((p) => p.available && p.distance > distance - 20 && p.distance < distance + 440).slice(0, this.cans.length);
    for (let i = 0; i < this.cans.length; i++) {
      const model = this.cans[i]; const pickup = pickups[i]; model.visible = !!pickup;
      if (pickup) { model.position.set(pickup.lane * ROAD_LANE_SCALE, Math.sin(now / 250 + pickup.id) * 0.12, -pickup.distance); model.rotation.y = now / 700; }
    }
    this.finish.position.set(roadCenter(FINISH_DISTANCE) * ROAD_LANE_SCALE, 0, -FINISH_DISTANCE);
    this.finish.visible = FINISH_DISTANCE - distance < 480;
    positionRaceCamera(this.camera, distance, game?.cars[view.driver].speed ?? 0, followed.lane);
    this.renderer.render(this.scene, this.camera);
    const ctx = view.canvas.getContext('2d')!;
    ctx.drawImage(this.renderer.domElement, 0, 0);
    view.lastAt = now; view.lastGame = game; view.startAt = game?.startAt ?? 0;
    return view.canvas;
  }

  followedDriver(game: RaceState | undefined, perspective: RacePerspective): 0 | 1 {
    return this.views.get(`${game?.tvId ?? 'preview'}:${perspective}`)?.driver
      ?? raceViewDriver(game?.cars ?? [{ distance: 0 }, { distance: 0 }], perspective);
  }

  release(id: string) { for (const key of this.views.keys()) if (key.startsWith(`${id}:`)) this.views.delete(key); }
  dispose() {
    this.city.dispose(); this.vehicles.dispose();
    for (const geometry of this.geometry) geometry.dispose();
    for (const material of this.materials) material.dispose();
    this.renderer.dispose(); this.renderer.forceContextLoss(); this.views.clear();
  }
}
