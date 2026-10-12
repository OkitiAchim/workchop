import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

type Vec3 = [number, number, number];
type Pieces = THREE.BufferGeometry[];
interface VehicleParts {
  paint: THREE.BufferGeometry;
  trim: THREE.BufferGeometry;
  glass: THREE.BufferGeometry;
  metal: THREE.BufferGeometry;
  front: THREE.BufferGeometry;
  rear: THREE.BufferGeometry;
  tire: THREE.BufferGeometry;
  wheel: THREE.BufferGeometry;
  wheelPositions: Vec3[];
  radius: number;
  length: number;
}

// These are original procedural silhouettes. The wedges, glazing, and light signatures
// are separate surfaces, so reflections describe a car rather than a stack of boxes.
export class RaceVehicles {
  private geometries = new Set<THREE.BufferGeometry>();
  private materials = new Set<THREE.Material>();
  private instances = new Set<THREE.InstancedMesh>();
  private paints = new Map<string, THREE.MeshPhysicalMaterial>();
  private parts = new Map<number, VehicleParts>();
  private trim = this.ownedMaterial(new THREE.MeshStandardMaterial({ color: '#10151c', roughness: 0.56, metalness: 0.25 }));
  private glass = this.ownedMaterial(new THREE.MeshPhysicalMaterial({ color: '#142b3e', roughness: 0.08, metalness: 0.35, clearcoat: 1, clearcoatRoughness: 0.04, envMapIntensity: 1.8 }));
  private metal = this.ownedMaterial(new THREE.MeshStandardMaterial({ color: '#8e9fae', metalness: 0.95, roughness: 0.22, envMapIntensity: 1.5 }));
  private rubber = this.ownedMaterial(new THREE.MeshStandardMaterial({ color: '#070a10', roughness: 0.93, metalness: 0.02 }));
  private front = this.ownedMaterial(new THREE.MeshStandardMaterial({ color: '#def6ff', emissive: '#c9eeff', emissiveIntensity: 4, roughness: 0.22 }));
  private rear = this.ownedMaterial(new THREE.MeshStandardMaterial({ color: '#fe254a', emissive: '#ff153d', emissiveIntensity: 2.2, roughness: 0.3 }));
  private braking = this.ownedMaterial(new THREE.MeshStandardMaterial({ color: '#ff4263', emissive: '#ff173f', emissiveIntensity: 6, roughness: 0.3 }));
  private flame = this.ownedMaterial(new THREE.MeshBasicMaterial({ color: '#26bfff', transparent: true, opacity: 0.7, blending: THREE.AdditiveBlending, depthWrite: false }));
  private flameCore = this.ownedMaterial(new THREE.MeshBasicMaterial({ color: '#baf8ff', transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }));
  private shadowTexture: THREE.CanvasTexture;
  private shadow: THREE.MeshBasicMaterial;
  private shadowGeometry = this.ownedGeometry(new THREE.PlaneGeometry(1, 1));
  private flameGeometry = this.ownedGeometry(new THREE.ConeGeometry(0.17, 1.25, 9));
  private wheelMatrix = new THREE.Matrix4();
  private wheelPosition = new THREE.Vector3();
  private wheelRotation = new THREE.Quaternion();
  private wheelAxis = new THREE.Vector3(1, 0, 0);
  private wheelScale = new THREE.Vector3(1, 1, 1);

  constructor() {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 64;
    const ctx = canvas.getContext('2d')!;
    const gradient = ctx.createRadialGradient(32, 32, 8, 32, 32, 31);
    gradient.addColorStop(0, 'rgba(0,0,0,0.95)');
    gradient.addColorStop(0.55, 'rgba(0,0,0,0.75)');
    gradient.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 64, 64);
    this.shadowTexture = new THREE.CanvasTexture(canvas);
    this.shadow = this.ownedMaterial(new THREE.MeshBasicMaterial({ color: '#000000', map: this.shadowTexture, transparent: true, opacity: 0.68, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1 }));
  }

  private ownedGeometry<T extends THREE.BufferGeometry>(geometry: T): T { this.geometries.add(geometry); return geometry; }
  private ownedMaterial<T extends THREE.Material>(material: T): T { this.materials.add(material); return material; }

  private paint(color: string) {
    let material = this.paints.get(color);
    if (!material) {
      material = this.ownedMaterial(new THREE.MeshPhysicalMaterial({ color, metalness: 0.7, roughness: 0.2, clearcoat: 1, clearcoatRoughness: 0.08, envMapIntensity: 1.35 }));
      this.paints.set(color, material);
    }
    return material;
  }

  private merge(pieces: Pieces) {
    const geometry = mergeGeometries(pieces, false)!;
    pieces.forEach((piece) => piece.dispose());
    return this.ownedGeometry(geometry);
  }

  private cube(parts: Pieces, position: Vec3, size: Vec3, rotation: Vec3 = [0, 0, 0]) {
    const geometry = new THREE.BoxGeometry(...size);
    geometry.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(...position), new THREE.Quaternion().setFromEuler(new THREE.Euler(...rotation)), new THREE.Vector3(1, 1, 1)));
    parts.push(geometry);
  }

  private polygon(parts: Pieces, vertices: Vec3[]) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices.flat(), 3));
    // Box primitives have UVs; all pieces need matching attributes before merging.
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(vertices.flatMap((v) => [v[0], v[2]]), 2));
    const indices: number[] = [];
    for (let i = 1; i < vertices.length - 1; i++) indices.push(0, i, i + 1);
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    parts.push(geometry);
  }

  private strip(parts: Pieces, a: Vec3, b: Vec3, width = 0.045) {
    const va = new THREE.Vector3(...a), vb = new THREE.Vector3(...b);
    const geometry = new THREE.BoxGeometry(width, va.distanceTo(vb), width);
    geometry.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), vb.clone().sub(va).normalize()));
    const center = va.add(vb).multiplyScalar(0.5);
    geometry.translate(center.x, center.y, center.z);
    parts.push(geometry);
  }

  private makeParts(kind: number): VehicleParts {
    const sport = kind === 0, suv = kind === 2;
    const paint: Pieces = [], trim: Pieces = [], glass: Pieces = [], metal: Pieces = [], front: Pieces = [], rear: Pieces = [];
    const half = sport ? 1.01 : suv ? 1.025 : 0.95;
    const length = suv ? 4.9 : 4.5;
    const radius = suv ? 0.42 : sport ? 0.36 : 0.37;
    const base = suv ? 0.51 : 0.39;
    const bodyTop = suv ? 1.05 : sport ? 0.78 : 0.91;
    const roofTop = suv ? 1.85 : sport ? 1.25 : 1.57;
    const ring = (z: number, width: number, top: number) => [
      [-width * 0.83, base - 0.05, z], [-width, base + 0.13, z], [-width, top - 0.14, z],
      [-width * 0.83, top, z], [width * 0.83, top, z], [width, top - 0.14, z],
      [width, base + 0.13, z], [width * 0.83, base - 0.05, z],
    ] as Vec3[];
    const z = [-length / 2, -length / 2 + 0.25, -1.3, -0.3, 0.8, 1.5, length / 2 - 0.2, length / 2];
    const rings = z.map((d, i) => ring(d, half * ([0.82, 0.99, 1, 0.98, 0.96, 1, 0.99, 0.91][i]), bodyTop + (sport ? [-0.16, -0.06, 0.06, 0.08, 0.05, 0.1, 0.02, -0.04][i] : [0, 0.03, 0.05, 0.08, 0.08, 0.06, 0.03, 0][i])));
    for (let j = 0; j < rings.length - 1; j++) {
      for (let i = 0; i < 8; i++) this.polygon(paint, [rings[j + 1][i], rings[j + 1][(i + 1) % 8], rings[j][(i + 1) % 8], rings[j][i]]);
    }
    this.polygon(paint, rings[0]);
    this.polygon(paint, [...rings[rings.length - 1]].reverse());

    const frontBase = sport ? -1.15 : suv ? -1.05 : -1.23;
    const frontRoof = sport ? -0.43 : suv ? -0.67 : -0.53;
    const rearRoof = sport ? 0.62 : suv ? 1.05 : 0.69;
    const rearBase = sport ? 1.36 : suv ? 1.43 : 1.4;
    const roofHalf = half * (sport ? 0.66 : suv ? 0.85 : 0.73);
    const glassHalf = half * (sport ? 0.82 : suv ? 0.9 : 0.85);
    // Winding points outward: all glazing stays opaque to avoid sorting over 20 cars.
    this.polygon(glass, [[-glassHalf, bodyTop + 0.085, frontBase], [-roofHalf, roofTop - 0.06, frontRoof], [roofHalf, roofTop - 0.06, frontRoof], [glassHalf, bodyTop + 0.085, frontBase]]);
    this.polygon(glass, [[glassHalf, bodyTop + 0.085, rearBase], [roofHalf, roofTop - 0.08, rearRoof], [-roofHalf, roofTop - 0.08, rearRoof], [-glassHalf, bodyTop + 0.085, rearBase]]);
    this.polygon(paint, [[-roofHalf, roofTop, frontRoof - 0.02], [-roofHalf, roofTop, rearRoof + 0.04], [roofHalf, roofTop, rearRoof + 0.04], [roofHalf, roofTop, frontRoof - 0.02]]);
    for (const side of [-1, 1]) {
      const window: Vec3[] = [[side * glassHalf, bodyTop + 0.12, frontBase + 0.15], [side * glassHalf, bodyTop + 0.12, rearBase - 0.12], [side * roofHalf, roofTop - 0.06, rearRoof], [side * roofHalf, roofTop - 0.06, frontRoof]];
      this.polygon(glass, side === -1 ? window : window.reverse());
      this.strip(paint, [side * glassHalf, bodyTop + 0.08, frontBase], [side * roofHalf, roofTop - 0.01, frontRoof], sport ? 0.065 : 0.085);
      this.strip(paint, [side * glassHalf, bodyTop + 0.08, rearBase], [side * roofHalf, roofTop - 0.01, rearRoof], 0.095);
      this.strip(trim, [side * glassHalf, bodyTop + 0.11, 0.34], [side * roofHalf, roofTop - 0.07, 0.34], 0.045);
      this.cube(paint, [side * (half + 0.1), bodyTop + 0.12, -0.65], [0.23, 0.1, 0.21], [0, side * 0.18, 0]);
      this.cube(glass, [side * (half + 0.105), bodyTop + 0.13, -0.53], [0.17, 0.065, 0.018]);
      this.cube(trim, [side * half, base - 0.055, 0], [0.08, 0.1, length - 0.32]);
      this.cube(metal, [side * (half * 0.985), bodyTop - 0.025, 0.4], [0.015, 0.035, 0.19]);
      if (sport) {
        const scoop: Vec3[] = [[side * (half + 0.004), 0.46, 0.52], [side * (half + 0.004), 0.66, 0.47], [side * (half + 0.004), 0.75, 1.02], [side * (half + 0.004), 0.45, 1.08]];
        this.polygon(trim, side === -1 ? scoop.reverse() : scoop);
        // A crease rises over each rear wheel; a low black side skirt emphasizes stance.
        this.strip(paint, [side * 0.96, 0.49, 0.38], [side * 1.0, 0.75, 1.2], 0.055);
      }
    }
    this.cube(trim, [0, base + 0.055, -length / 2 - 0.018], [half * 1.65, 0.16, 0.045]);
    this.cube(trim, [0, base - 0.075, -length / 2 - 0.05], [half * 2.06, 0.055, 0.24]);
    this.cube(trim, [0, base + 0.09, length / 2 + 0.017], [half * 1.75, 0.2, 0.045]);
    this.cube(trim, [0, base - 0.06, length / 2], [half * 1.82, 0.12, 0.23]);
    for (let i = -2; i <= 2; i++) this.cube(trim, [i * 0.3, base - 0.085, length / 2 - 0.03], [0.035, 0.14, 0.39]);
    for (const side of [-1, 1]) {
      if (sport) {
        const x = side * 0.68;
        this.strip(front, [x - side * 0.15, 0.68, -2.235], [x, 0.68, -2.24], 0.038);
        this.strip(front, [x, 0.68, -2.24], [x + side * 0.17, 0.74, -2.12], 0.04);
        this.strip(front, [x, 0.68, -2.24], [x + side * 0.12, 0.59, -2.24], 0.04);
        this.strip(rear, [x - side * 0.19, 0.68, 2.255], [x, 0.68, 2.255], 0.047);
        this.strip(rear, [x, 0.68, 2.255], [x + side * 0.2, 0.77, 2.235], 0.047);
        this.strip(rear, [x, 0.68, 2.255], [x + side * 0.2, 0.59, 2.255], 0.047);
      } else {
        this.cube(front, [side * half * 0.65, bodyTop - 0.08, -length / 2 - 0.025], [0.47, 0.13, 0.04]);
        this.cube(rear, [side * half * 0.68, bodyTop - 0.08, length / 2 + 0.025], [0.38, 0.17, 0.04]);
        if (suv) this.cube(rear, [side * half * 0.86, bodyTop + 0.07, length / 2 - 0.03], [0.075, 0.39, 0.05]);
      }
      const pipe = new THREE.CylinderGeometry(0.09, 0.09, 0.17, 12, 1, true);
      pipe.rotateX(Math.PI / 2); pipe.translate(side * 0.43, base + 0.03, length / 2 + 0.05); metal.push(pipe);
      this.cube(trim, [side * 0.43, base + 0.03, length / 2 + 0.02], [0.13, 0.13, 0.025]);
    }
    if (sport) {
      this.cube(trim, [0, 1.03, 1.72], [1.88, 0.065, 0.27], [-0.07, 0, 0]);
      for (const x of [-0.62, 0.62]) this.cube(trim, [x, 0.92, 1.72], [0.055, 0.19, 0.12]);
      for (let i = 0; i < 5; i++) this.cube(trim, [0, 0.93 - i * 0.02, 1.05 + i * 0.105], [0.66, 0.025, 0.04]);
      for (const x of [-0.61, 0.61]) this.cube(trim, [x, 0.79, -1.58], [0.24, 0.017, 0.27], [0.065, 0, 0]);
    } else if (suv) {
      for (const x of [-0.7, 0.7]) this.cube(metal, [x, roofTop + 0.04, 0.24], [0.04, 0.05, 1.6]);
    }
    this.cube(trim, [0, bodyTop - 0.19, length / 2 + 0.038], [0.34, 0.105, 0.012]);
    this.cube(metal, [0, bodyTop - 0.19, length / 2 + 0.048], [0.26, 0.07, 0.012]);

    const tire: Pieces = [], wheel: Pieces = [];
    const tireWidth = sport ? 0.28 : 0.24;
    const tireCylinder = new THREE.CylinderGeometry(radius, radius, tireWidth, 24);
    tireCylinder.rotateZ(Math.PI / 2); tire.push(tireCylinder);
    const rim = new THREE.TorusGeometry(radius * 0.76, 0.026, 6, 24);
    rim.rotateY(Math.PI / 2);
    for (const side of [-1, 1]) {
      const ringPiece = rim.clone(); ringPiece.translate(side * (tireWidth / 2 + 0.005), 0, 0); wheel.push(ringPiece);
      for (let i = 0; i < 5; i++) {
        const angle = i * Math.PI * 2 / 5;
        this.cube(wheel, [side * (tireWidth / 2 + 0.005), Math.cos(angle) * radius * 0.38, Math.sin(angle) * radius * 0.38], [0.023, radius * 0.65, 0.035], [angle, 0, 0]);
      }
    }
    rim.dispose();
    const hub = new THREE.CylinderGeometry(radius * 0.16, radius * 0.16, tireWidth + 0.03, 12);
    hub.rotateZ(Math.PI / 2); wheel.push(hub);
    const axle = sport ? 1.36 : suv ? 1.54 : 1.39;
    const wheelPositions: Vec3[] = [];
    for (const x of [-half * 0.96, half * 0.96]) for (const dz of [-axle, axle]) wheelPositions.push([x, radius + 0.04, dz]);
    return {
      paint: this.merge(paint), trim: this.merge(trim), glass: this.merge(glass), metal: this.merge(metal),
      front: this.merge(front), rear: this.merge(rear), tire: this.merge(tire), wheel: this.merge(wheel),
      wheelPositions, radius, length,
    };
  }

  car(color: string, traffic = false, variant = 0): THREE.Group {
    const kind = traffic ? 1 + Math.abs(variant % 2) : 0;
    let parts = this.parts.get(kind);
    if (!parts) { parts = this.makeParts(kind); this.parts.set(kind, parts); }
    const group = new THREE.Group();
    const paintMesh = new THREE.Mesh(parts.paint, this.paint(color));
    const rearMesh = new THREE.Mesh(parts.rear, this.rear);
    group.add(paintMesh, new THREE.Mesh(parts.trim, this.trim), new THREE.Mesh(parts.glass, this.glass), new THREE.Mesh(parts.metal, this.metal), new THREE.Mesh(parts.front, this.front), rearMesh);
    const shadow = new THREE.Mesh(this.shadowGeometry, this.shadow);
    shadow.rotation.x = -Math.PI / 2; shadow.position.y = 0.025; shadow.scale.set(2.85, parts.length + 1.1, 1);
    group.add(shadow);
    const tires = new THREE.InstancedMesh(parts.tire, this.rubber, 4);
    const wheels = new THREE.InstancedMesh(parts.wheel, this.metal, 4);
    this.instances.add(tires); this.instances.add(wheels);
    tires.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    wheels.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    parts.wheelPositions.forEach((position, i) => {
      this.wheelMatrix.makeTranslation(...position);
      tires.setMatrixAt(i, this.wheelMatrix); wheels.setMatrixAt(i, this.wheelMatrix);
    });
    tires.computeBoundingSphere(); wheels.computeBoundingSphere();
    group.add(tires, wheels);
    const flames = new THREE.Group();
    for (const x of [-0.43, 0.43]) {
      const flame = new THREE.Mesh(this.flameGeometry, this.flame);
      flame.rotation.x = Math.PI / 2; flame.position.set(x, 0.45, parts.length / 2 + 0.65);
      const core = new THREE.Mesh(this.flameGeometry, this.flameCore);
      core.rotation.x = Math.PI / 2; core.position.set(x, 0.45, parts.length / 2 + 0.38); core.scale.set(0.5, 0.55, 0.5);
      flames.add(flame, core);
    }
    flames.visible = false; group.add(flames);
    Object.assign(group.userData, { paintMesh, paint: color, rearMesh, tires, wheels, wheelPositions: parts.wheelPositions, flames, radius: parts.radius, wheelAngle: 0 });
    return group;
  }

  setColor(group: THREE.Group, color: string): void {
    if (group.userData.paint === color) return;
    (group.userData.paintMesh as THREE.Mesh).material = this.paint(color);
    group.userData.paint = color;
  }

  animate(group: THREE.Group, speed: number, boost: boolean, brake: boolean, now: number): void {
    const dt = Math.max(0, Math.min(0.1, (now - (group.userData.wheelAt ?? now)) / 1000));
    const rotation = ((group.userData.wheelAngle as number) - dt * speed / (group.userData.radius as number)) % (Math.PI * 2);
    group.userData.wheelAt = now; group.userData.wheelAngle = rotation;
    this.wheelRotation.setFromAxisAngle(this.wheelAxis, rotation);
    const tires = group.userData.tires as THREE.InstancedMesh;
    const wheels = group.userData.wheels as THREE.InstancedMesh;
    (group.userData.wheelPositions as Vec3[]).forEach((position, i) => {
      this.wheelPosition.set(...position);
      this.wheelMatrix.compose(this.wheelPosition, this.wheelRotation, this.wheelScale);
      tires.setMatrixAt(i, this.wheelMatrix); wheels.setMatrixAt(i, this.wheelMatrix);
    });
    tires.instanceMatrix.needsUpdate = true; wheels.instanceMatrix.needsUpdate = true;
    (group.userData.rearMesh as THREE.Mesh).material = brake ? this.braking : this.rear;
    const flames = group.userData.flames as THREE.Group;
    flames.visible = boost;
    flames.scale.z = 0.82 + Math.sin(now / 35) * 0.13 + Math.sin(now / 21) * 0.06;
  }

  dispose(): void {
    this.instances.forEach((mesh) => mesh.dispose());
    this.geometries.forEach((geometry) => geometry.dispose());
    this.materials.forEach((material) => material.dispose());
    this.shadowTexture.dispose();
    this.instances.clear(); this.geometries.clear(); this.materials.clear(); this.parts.clear(); this.paints.clear();
  }
}
