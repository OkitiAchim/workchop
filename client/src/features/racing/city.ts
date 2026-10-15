import * as THREE from 'three';
import { roadCenter } from '../../../../shared/racing';
import { ROAD_LANE_SCALE } from './camera';

/** World metres per normalized driving lane. Physics still uses the original lane units. */
export const LANE_SCALE = ROAD_LANE_SCALE;
const HALF_ROAD = 0.92 * LANE_SCALE;
// Include the original off-road steering range and the car body inside the recovery apron.
const RIGID_EDGE = 18.8;
const LAMP_OFFSET = 19.5;
const ROAD_COUNT = 98;
const LAMP_COUNT = 34;
const BUILDING_COUNT = 84;

function random(seed: number): number {
  const v = Math.sin(seed * 127.1 + 311.7) * 43758.5453;
  return v - Math.floor(v);
}

function canvas(width: number, height: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const el = document.createElement('canvas'); el.width = width; el.height = height;
  return [el, el.getContext('2d')!];
}

function texture(el: HTMLCanvasElement): THREE.CanvasTexture {
  const result = new THREE.CanvasTexture(el);
  result.colorSpace = THREE.SRGBColorSpace;
  return result;
}

function asphaltTexture(): THREE.CanvasTexture {
  const [el, ctx] = canvas(512, 512);
  const pixels = ctx.createImageData(512, 512);
  for (let i = 0; i < pixels.data.length; i += 4) {
    const grain = 17 + Math.floor(random(i) * 14);
    pixels.data[i] = grain; pixels.data[i + 1] = grain + 2; pixels.data[i + 2] = grain + 5; pixels.data[i + 3] = 255;
  }
  ctx.putImageData(pixels, 0, 0);
  // Fine aggregate and longitudinal tyre wear, without a repeating decorative road pattern.
  for (let i = 0; i < 90; i++) {
    const x = random(i + 1200) * 512;
    ctx.fillStyle = `rgba(96,116,142,${0.015 + random(i + 11) * 0.018})`;
    ctx.fillRect(x, 0, 1 + random(i + 53) * 4, 512);
  }
  const map = texture(el); map.wrapS = map.wrapT = THREE.RepeatWrapping; map.repeat.set(3, 1); map.anisotropy = 4;
  return map;
}

function facadeTexture(kind: number): THREE.CanvasTexture {
  const [el, ctx] = canvas(256, 512);
  const rows = [7, 10, 15, 21, 28, 35][kind];
  const cols = 10 + (kind % 3) * 2;
  ctx.fillStyle = ['#101c2b', '#152331', '#17232d', '#122438', '#172238', '#172a3a'][kind];
  ctx.fillRect(0, 0, 256, 512);
  const cellW = 256 / cols; const cellH = 512 / rows;
  for (let row = 0; row < rows; row++) for (let col = 0; col < cols; col++) {
    const seed = kind * 7301 + row * 89 + col * 419;
    const lit = random(seed) > 0.37;
    ctx.fillStyle = lit ? (random(seed + 27) > 0.64 ? '#dfbf80' : ['#6fa6bc', '#9cc2cf', '#668caa'][kind % 3]) : '#152431';
    const inset = Math.max(2, cellW * 0.19);
    ctx.fillRect(col * cellW + inset, row * cellH + 2, cellW - inset * 2, cellH - 5);
    if (lit) {
      ctx.fillStyle = '#223846';
      ctx.fillRect(col * cellW + cellW / 2, row * cellH + 2, 1.2, cellH - 5);
      if (random(seed + 3) > 0.55) ctx.fillRect(col * cellW + inset, row * cellH + cellH * 0.7, cellW - inset * 2, 2);
    }
  }
  // A subtle horizontal mullion grid keeps the skyscrapers readable at speed.
  ctx.strokeStyle = '#1f3442'; ctx.lineWidth = 1;
  for (let row = 0; row <= rows; row++) { ctx.beginPath(); ctx.moveTo(0, row * cellH); ctx.lineTo(256, row * cellH); ctx.stroke(); }
  return texture(el);
}

function lightPoolTexture(): THREE.CanvasTexture {
  const [el, ctx] = canvas(128, 128);
  const glow = ctx.createRadialGradient(64, 64, 1, 64, 64, 63);
  glow.addColorStop(0, 'rgba(150,188,224,.31)'); glow.addColorStop(0.38, 'rgba(88,130,176,.15)'); glow.addColorStop(1, 'rgba(57,103,166,0)');
  ctx.fillStyle = glow; ctx.fillRect(0, 0, 128, 128);
  return texture(el);
}

function signTexture(title: string, subtitle: string, tint: string): THREE.CanvasTexture {
  const [el, ctx] = canvas(512, 128);
  ctx.fillStyle = '#06101c'; ctx.fillRect(0, 0, 512, 128);
  ctx.strokeStyle = tint; ctx.lineWidth = 4; ctx.strokeRect(6, 6, 500, 116);
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = tint;
  ctx.font = 'bold 40px system-ui, sans-serif'; ctx.fillText(title, 256, 50);
  ctx.fillStyle = '#d9eaf5'; ctx.font = '18px system-ui, sans-serif'; ctx.fillText(subtitle, 256, 91);
  return texture(el);
}

function environmentTexture(): THREE.CanvasTexture {
  const [el, ctx] = canvas(512, 256);
  const sky = ctx.createLinearGradient(0, 0, 0, 256);
  sky.addColorStop(0, '#142035'); sky.addColorStop(0.42, '#2b4059'); sky.addColorStop(0.56, '#41647b'); sky.addColorStop(0.66, '#101b28'); sky.addColorStop(1, '#111923');
  ctx.fillStyle = sky; ctx.fillRect(0, 0, 512, 256);
  for (const [x, tint] of [[56, '#4d83a6'], [186, '#95979b'], [316, '#754865'], [428, '#52899c']] as const) {
    const glow = ctx.createRadialGradient(x, 126, 1, x, 126, 65);
    glow.addColorStop(0, tint); glow.addColorStop(1, 'rgba(10,23,37,0)'); ctx.fillStyle = glow; ctx.fillRect(x - 65, 61, 130, 130);
  }
  // Broad light panels make glossy car surfaces readable without expensive scene reflections.
  ctx.fillStyle = '#b8cede'; ctx.fillRect(78, 59, 85, 7); ctx.fillRect(275, 79, 55, 6);
  ctx.fillStyle = '#537c99'; ctx.fillRect(3, 108, 42, 9); ctx.fillRect(367, 107, 73, 5);
  const map = texture(el); map.mapping = THREE.EquirectangularReflectionMapping;
  return map;
}

/** A bounded, instanced city corridor. The same geometry serves every local camera. */
export class NightCity {
  readonly root = new THREE.Group();
  readonly environment: THREE.Texture;
  private geometries = new Set<THREE.BufferGeometry>();
  private materials = new Set<THREE.Material>();
  private textures = new Set<THREE.Texture>();
  private box: THREE.BoxGeometry;
  private ground: THREE.Mesh;
  private road: THREE.InstancedMesh;
  private shoulders: THREE.InstancedMesh;
  private runoff: THREE.InstancedMesh;
  private edges: THREE.InstancedMesh;
  private dashes: THREE.InstancedMesh;
  private concrete: THREE.InstancedMesh;
  private rails: THREE.InstancedMesh;
  private reflectors: THREE.InstancedMesh;
  private poles: THREE.InstancedMesh;
  private arms: THREE.InstancedMesh;
  private housings: THREE.InstancedMesh;
  private bulbs: THREE.InstancedMesh;
  private pools: THREE.InstancedMesh;
  private buildings: THREE.InstancedMesh[] = [];
  private roofs: THREE.InstancedMesh;
  private bases: THREE.InstancedMesh;
  private antennas: THREE.InstancedMesh;
  private trims: THREE.InstancedMesh;
  private billboardSupports: THREE.InstancedMesh;
  private billboards: THREE.InstancedMesh[] = [];
  private gantryPosts: THREE.InstancedMesh;
  private gantryBeams: THREE.InstancedMesh;
  private gantrySigns: THREE.InstancedMesh;
  private gantryArrows: THREE.InstancedMesh;
  private transform = new THREE.Object3D();
  private roadFirst = Number.NaN;
  private lampFirst = Number.NaN;
  private blockFirst = Number.NaN;
  private gantryFirst = Number.NaN;

  constructor() {
    this.environment = this.ownTexture(environmentTexture());
    this.box = this.ownGeometry(new THREE.BoxGeometry(1, 1, 1));
    const plain = (color: string, roughness = 0.8, metalness = 0.05) => this.ownMaterial(new THREE.MeshStandardMaterial({ color, roughness, metalness }));
    const glow = (color: string, intensity = 1.5) => this.ownMaterial(new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: intensity, roughness: 0.5, metalness: 0.15 }));
    const asphalt = this.ownTexture(asphaltTexture());
    const roadMaterial = this.ownMaterial(new THREE.MeshStandardMaterial({ color: '#939faa', map: asphalt, roughness: 0.43, metalness: 0.25, envMapIntensity: 0.45 }));
    this.ground = new THREE.Mesh(this.box, plain('#080e17', 0.96));
    this.ground.position.y = -0.27; this.ground.scale.set(520, 0.3, 1250); this.root.add(this.ground);
    this.road = this.batch(roadMaterial, ROAD_COUNT);
    this.shoulders = this.batch(plain('#3b4651'), ROAD_COUNT * 2);
    this.runoff = this.batch(this.ownMaterial(new THREE.MeshStandardMaterial({ color: '#697681', map: asphalt, roughness: 0.78, metalness: 0.07, envMapIntensity: 0.2 })), ROAD_COUNT * 2);
    this.edges = this.batch(plain('#d4d9d3', 0.55), ROAD_COUNT * 2);
    this.dashes = this.batch(plain('#dce5e6', 0.5), Math.ceil(ROAD_COUNT / 2) * 3);
    this.concrete = this.batch(plain('#53606b'), ROAD_COUNT * 2);
    this.rails = this.batch(plain('#80949e', 0.29, 0.73), ROAD_COUNT * 2);
    this.reflectors = this.batch(glow('#d3c593', 0.9), ROAD_COUNT * 2);
    const steel = plain('#53636f', 0.35, 0.7);
    this.poles = this.batch(steel, LAMP_COUNT);
    this.arms = this.batch(steel, LAMP_COUNT);
    this.housings = this.batch(plain('#a8b7bf', 0.32, 0.6), LAMP_COUNT);
    this.bulbs = this.batch(glow('#d6e8fa', 2.1), LAMP_COUNT);
    const pool = this.ownTexture(lightPoolTexture());
    const poolMaterial = this.ownMaterial(new THREE.MeshBasicMaterial({ map: pool, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.6, toneMapped: false }));
    this.pools = this.batch(poolMaterial, LAMP_COUNT, this.ownGeometry(new THREE.PlaneGeometry(1, 1)));
    const heights = [18, 28, 42, 59, 78, 98];
    for (let i = 0; i < 6; i++) {
      const facade = this.ownTexture(facadeTexture(i));
      this.buildings.push(this.batch(this.ownMaterial(new THREE.MeshStandardMaterial({ color: '#778b9d', map: facade, emissiveMap: facade, emissive: '#ffffff', emissiveIntensity: 0.8, roughness: 0.35, metalness: 0.48, envMapIntensity: 0.65 })), BUILDING_COUNT / 6));
    }
    this.roofs = this.batch(plain('#1a2c3a', 0.6, 0.3), BUILDING_COUNT);
    this.bases = this.batch(plain('#172532', 0.7, 0.1), BUILDING_COUNT);
    this.antennas = this.batch(steel, BUILDING_COUNT);
    this.trims = this.batch(glow('#3d748a', 0.48), BUILDING_COUNT);
    this.billboardSupports = this.batch(steel, 6);
    const billboardTitles = ['NIGHT DRIVE', 'HOMEOFFICE', 'TURBO RIVALS'];
    for (let i = 0; i < 3; i++) {
      const sign = this.ownTexture(signTexture(billboardTitles[i], ['CITY EXPRESSWAY', 'AFTER HOURS', 'CHASE THE FINISH'][i], ['#63d7e5', '#c298ef', '#ed6b95'][i]));
      this.billboards.push(this.batch(this.ownMaterial(new THREE.MeshBasicMaterial({ map: sign, toneMapped: false })), 2, this.ownGeometry(new THREE.PlaneGeometry(1, 1))));
    }
    this.gantryPosts = this.batch(steel, 4);
    this.gantryBeams = this.batch(steel, 2);
    const highwaySign = this.ownTexture(signTexture('DOWNTOWN', 'EXPRESS  •  KEEP RACING', '#71d4b2'));
    this.gantrySigns = this.batch(this.ownMaterial(new THREE.MeshBasicMaterial({ map: highwaySign, toneMapped: false })), 2, this.ownGeometry(new THREE.PlaneGeometry(1, 1)));
    const [arrowEl, arrowCtx] = canvas(64, 64);
    arrowCtx.fillStyle = '#041a14'; arrowCtx.fillRect(0, 0, 64, 64); arrowCtx.fillStyle = '#79edbe';
    arrowCtx.beginPath(); arrowCtx.moveTo(24, 9); arrowCtx.lineTo(40, 9); arrowCtx.lineTo(40, 33); arrowCtx.lineTo(55, 33); arrowCtx.lineTo(32, 58); arrowCtx.lineTo(9, 33); arrowCtx.lineTo(24, 33); arrowCtx.closePath(); arrowCtx.fill();
    const arrows = this.ownTexture(texture(arrowEl));
    this.gantryArrows = this.batch(this.ownMaterial(new THREE.MeshBasicMaterial({ map: arrows, toneMapped: false })), 8, this.ownGeometry(new THREE.PlaneGeometry(1, 1)));
    this.root.userData.buildingHeights = heights;
    this.update(0, 0);
  }

  private ownGeometry<T extends THREE.BufferGeometry>(geometry: T): T { this.geometries.add(geometry); return geometry; }
  private ownMaterial<T extends THREE.Material>(material: T): T { this.materials.add(material); return material; }
  private ownTexture<T extends THREE.Texture>(map: T): T { this.textures.add(map); return map; }
  private batch(material: THREE.Material, count: number, geometry: THREE.BufferGeometry = this.box): THREE.InstancedMesh {
    const mesh = new THREE.InstancedMesh(geometry, material, count);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    // The bounded corridor moves every few metres, so avoid recomputing its aggregate sphere.
    mesh.frustumCulled = false; this.root.add(mesh); return mesh;
  }

  private set(mesh: THREE.InstancedMesh, index: number, distance: number, x: number, y: number, z: number, sx: number, sy: number, sz: number, plane = false): void {
    const turn = -Math.atan((roadCenter(distance + 3) - roadCenter(distance - 3)) * LANE_SCALE / 6);
    this.transform.position.set(roadCenter(distance) * LANE_SCALE + x * Math.cos(turn) + z * Math.sin(turn), y, -distance - x * Math.sin(turn) + z * Math.cos(turn));
    this.transform.rotation.set(plane ? -Math.PI / 2 : 0, turn, 0, 'YXZ'); this.transform.scale.set(sx, sy, sz); this.transform.updateMatrix();
    mesh.setMatrixAt(index, this.transform.matrix);
  }

  update(distance: number, _now: number): void {
    this.ground.position.z = -distance;
    const first = Math.floor((distance - 72) / 6);
    if (first !== this.roadFirst) {
      this.roadFirst = first;
      let dash = 0;
      for (let i = 0; i < ROAD_COUNT; i++) {
        const d = (first + i) * 6;
        this.set(this.road, i, d, 0, -0.065, 0, HALF_ROAD * 2, 0.13, 6.07);
        for (let side = 0; side < 2; side++) {
          const direction = side ? 1 : -1; const at = i * 2 + side;
          this.set(this.shoulders, at, d, direction * (HALF_ROAD + 0.8), -0.043, 0, 1.6, 0.07, 6.07);
          const apronStart = HALF_ROAD + 1.6; const apronEnd = RIGID_EDGE - 0.25;
          this.set(this.runoff, at, d, direction * (apronStart + apronEnd) / 2, -0.068, 0, apronEnd - apronStart, 0.11, 6.07);
          this.set(this.edges, at, d, direction * (HALF_ROAD - 0.17), 0.006, 0, 0.13, 0.011, 6.07);
          this.set(this.concrete, at, d, direction * RIGID_EDGE, 0.36, 0, 0.5, 0.75, 6.07);
          this.set(this.rails, at, d, direction * RIGID_EDGE, 0.91, 0, 0.18, 0.2, 6.07);
          this.set(this.reflectors, at, d, direction * (RIGID_EDGE - 0.27), 0.84, 0, 0.03, 0.08, 0.18);
        }
        if ((first + i) % 2 === 0) for (const lane of [-0.46, 0, 0.46]) this.set(this.dashes, dash++, d, lane * LANE_SCALE, 0.012, 0, 0.13, 0.016, 4.5);
      }
      for (const mesh of [this.road, this.shoulders, this.runoff, this.edges, this.dashes, this.concrete, this.rails, this.reflectors]) mesh.instanceMatrix.needsUpdate = true;
    }
    const lampFirst = Math.floor((distance - 65) / 34);
    if (lampFirst !== this.lampFirst) {
      this.lampFirst = lampFirst;
      for (let i = 0; i < LAMP_COUNT; i++) {
        const d = (lampFirst + Math.floor(i / 2)) * 34; const side = i % 2 ? 1 : -1;
        const poleX = side * LAMP_OFFSET; const lampX = side * (HALF_ROAD - 0.9);
        this.set(this.poles, i, d, poleX, 4.85, 0, 0.17, 9.7, 0.17);
        this.set(this.arms, i, d, (poleX + lampX) / 2, 9.7, 0, Math.abs(poleX - lampX) + 0.2, 0.2, 0.2);
        this.set(this.housings, i, d, lampX, 9.61, 0, 0.7, 0.17, 1.65);
        this.set(this.bulbs, i, d, lampX, 9.5, 0, 0.59, 0.028, 1.49);
        this.set(this.pools, i, d, side * 4.7, 0.018, 0, 13.5, 25, 1, true);
      }
      for (const mesh of [this.poles, this.arms, this.housings, this.bulbs, this.pools]) mesh.instanceMatrix.needsUpdate = true;
    }
    const blockFirst = Math.floor((distance - 90) / 44);
    if (blockFirst !== this.blockFirst) {
      this.blockFirst = blockFirst;
      const counts = [0, 0, 0, 0, 0, 0]; const heights = this.root.userData.buildingHeights as number[];
      for (let i = 0; i < BUILDING_COUNT; i++) {
        const block = blockFirst + Math.floor(i / 6); const slot = i % 6;
        const seed = block * 231 + slot * 79; const side = slot < 3 ? -1 : 1;
        const type = ((block % 6) + slot + 6) % 6;
        const d = block * 44 + (random(seed + 1) - 0.5) * 15;
        const width = 10 + random(seed + 2) * 10; const depth = 13 + random(seed + 3) * 14;
        const height = heights[type] * (0.82 + random(seed + 4) * 0.3);
        const x = side * (30 + (slot % 3) * 32 + random(seed + 5) * 7);
        this.set(this.buildings[type], counts[type]++, d, x, height / 2, 0, width, height, depth);
        this.set(this.roofs, i, d, x, height + 0.25, 0, width + 0.25, 0.5, depth + 0.25);
        this.set(this.bases, i, d, x, 0.7, 0, width + 1.5, 1.4, depth + 1.5);
        this.set(this.antennas, i, d, x + width * 0.15, height + 2.2, 0, 0.14, 4.1, 0.14);
        this.set(this.trims, i, d, x + side * width * 0.475, height * 0.49, depth * 0.502, 0.09, height * 0.96, 0.08);
      }
      // Facade types remain evenly distributed: fourteen instances each, regardless of the streamed block.
      for (const mesh of [...this.buildings, this.roofs, this.bases, this.antennas, this.trims]) mesh.instanceMatrix.needsUpdate = true;
      for (let i = 0; i < 6; i++) {
        const block = blockFirst + i * 2; const d = block * 44 + 12; const side = i % 2 ? 1 : -1; const x = side * 20;
        this.set(this.billboardSupports, i, d, x, 7.5, 0, 0.22, 15, 0.22);
        this.set(this.billboards[i % 3], Math.floor(i / 3), d, x, 14.2, 0.2, 10, 2.5, 1);
      }
      for (const mesh of [this.billboardSupports, ...this.billboards]) mesh.instanceMatrix.needsUpdate = true;
    }
    const gantryFirst = Math.floor((distance - 60) / 280);
    if (gantryFirst !== this.gantryFirst) {
      this.gantryFirst = gantryFirst;
      for (let i = 0; i < 2; i++) {
        const d = (gantryFirst + i) * 280 + 130;
        for (let side = 0; side < 2; side++) this.set(this.gantryPosts, i * 2 + side, d, (side ? 1 : -1) * 19, 5.6, 0, 0.35, 11.2, 0.4);
        this.set(this.gantryBeams, i, d, 0, 11.08, 0, 38.6, 0.52, 0.52);
        this.set(this.gantrySigns, i, d, 0, 10.3, 0.36, 7.4, 1.85, 1);
        for (let lane = 0; lane < 4; lane++) this.set(this.gantryArrows, i * 4 + lane, d, (lane - 1.5) * HALF_ROAD / 2, 8.66, 0.39, 0.74, 0.74, 1);
      }
      for (const mesh of [this.gantryPosts, this.gantryBeams, this.gantrySigns, this.gantryArrows]) mesh.instanceMatrix.needsUpdate = true;
    }
  }

  dispose(): void {
    this.root.traverse((object) => { if (object instanceof THREE.InstancedMesh) object.dispose(); });
    for (const geometry of this.geometries) geometry.dispose();
    for (const material of this.materials) material.dispose();
    for (const map of this.textures) map.dispose();
    this.root.clear(); this.geometries.clear(); this.materials.clear(); this.textures.clear();
  }
}
