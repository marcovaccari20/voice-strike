// Die Arena: runder Sandplatz mit Mauer, darueber Raenge mit Publikum.
// Alle Texturen entstehen zur Laufzeit auf einer Zeichenflaeche - keine Dateien.
//
// Das Publikum besteht aus zwei Formen je Zuschauer (Rumpf und Kopf), als
// Instanzen gezeichnet. Es wippt leicht und springt auf, wenn im Kampf etwas
// passiert (`cheer`). Einzelne Menschen soll man nicht erkennen - nur, dass
// die Raenge voll sind.

import {
  BackSide,
  BoxGeometry,
  CanvasTexture,
  CircleGeometry,
  Color,
  CylinderGeometry,
  DirectionalLight,
  Fog,
  Group,
  HemisphereLight,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshLambertMaterial,
  MeshStandardMaterial,
  RepeatWrapping,
  RingGeometry,
  SphereGeometry,
  SRGBColorSpace,
  type Scene,
} from 'three';

/** Radius des Sandplatzes (m). */
export const ARENA_RADIUS = 9;
const WALL_HEIGHT = 2.2;
const SKY = 0x9cc3e6;

// Raenge: Stufen, die hinter der Mauer nach aussen ansteigen.
const TIERS = 8;
const TIER_DEPTH = 0.95;
const TIER_RISE = 0.6;
const STAND_INNER = ARENA_RADIUS + 0.9;
/** Abstand zweier Zuschauer auf einer Stufe (m). */
const SEAT_SPACING = 0.6;
/** So schnell legt sich die Aufregung wieder (1/s). */
const CHEER_DECAY = 0.9;

export interface ArenaScene {
  /** Je Bild: Publikum bewegen. */
  update(dtSeconds: number, clockMs: number): void;
  /** Das Publikum reagiert; `amount` 0..1. */
  cheer(amount: number): void;
}

/** Wiederholbare Pseudozufallszahlen, damit die Arena immer gleich aussieht. */
function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function sandTexture(): CanvasTexture {
  const size = 512;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.fillStyle = '#d8b878';
    ctx.fillRect(0, 0, size, size);
    const rnd = seeded(7);
    for (let i = 0; i < 9000; i++) {
      const shade = 150 + Math.floor(rnd() * 90);
      ctx.fillStyle = `rgba(${shade + 20}, ${shade - 10}, ${shade - 70}, ${0.1 + rnd() * 0.25})`;
      const r = 0.6 + rnd() * 2.2;
      ctx.beginPath();
      ctx.arc(rnd() * size, rnd() * size, r, 0, Math.PI * 2);
      ctx.fill();
    }
    // flache Mulden
    for (let i = 0; i < 40; i++) {
      ctx.fillStyle = `rgba(120, 90, 40, ${0.04 + rnd() * 0.05})`;
      ctx.beginPath();
      ctx.ellipse(rnd() * size, rnd() * size, 14 + rnd() * 30, 6 + rnd() * 12, rnd() * Math.PI, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  const tex = new CanvasTexture(canvas);
  tex.wrapS = RepeatWrapping;
  tex.wrapT = RepeatWrapping;
  tex.repeat.set(5, 5);
  tex.colorSpace = SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

function stoneTexture(repeatX: number): CanvasTexture {
  const w = 512;
  const h = 256;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.fillStyle = '#6f675c';
    ctx.fillRect(0, 0, w, h);
    const rnd = seeded(21);
    const rows = 6;
    const rowH = h / rows;
    for (let r = 0; r < rows; r++) {
      const cols = 6;
      const colW = w / cols;
      const shift = r % 2 === 0 ? 0 : colW / 2;
      for (let c = -1; c < cols + 1; c++) {
        const shade = 118 + Math.floor(rnd() * 46);
        ctx.fillStyle = `rgb(${shade + 8}, ${shade}, ${shade - 12})`;
        ctx.fillRect(c * colW + shift + 2, r * rowH + 2, colW - 4, rowH - 4);
      }
    }
    for (let i = 0; i < 2500; i++) {
      ctx.fillStyle = `rgba(40, 36, 30, ${rnd() * 0.18})`;
      ctx.fillRect(rnd() * w, rnd() * h, 1 + rnd() * 2, 1 + rnd() * 2);
    }
  }
  const tex = new CanvasTexture(canvas);
  tex.wrapS = RepeatWrapping;
  tex.wrapT = RepeatWrapping;
  tex.repeat.set(repeatX, 1);
  tex.colorSpace = SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

/** Stufen der Raenge und die Rueckwand dahinter. */
function buildStands(arena: Group): void {
  const seat = new MeshLambertMaterial({ color: 0x8b8275 });
  const riser = new MeshLambertMaterial({ color: 0x6d655a, side: BackSide });
  for (let t = 0; t < TIERS; t++) {
    const inner = STAND_INNER + t * TIER_DEPTH;
    const y = WALL_HEIGHT + 0.2 + t * TIER_RISE;
    const step = new Mesh(new RingGeometry(inner, inner + TIER_DEPTH, 72), seat);
    step.rotation.x = -Math.PI / 2;
    step.position.y = y;
    arena.add(step);
    // Stirnseite der naechsten Stufe
    const front = new Mesh(new CylinderGeometry(inner + TIER_DEPTH, inner + TIER_DEPTH, TIER_RISE, 72, 1, true), riser);
    front.position.y = y + TIER_RISE / 2;
    arena.add(front);
  }

  // Rueckwand mit Bogenoeffnungen als dunkle Felder
  const outer = STAND_INNER + TIERS * TIER_DEPTH;
  const top = WALL_HEIGHT + 0.2 + TIERS * TIER_RISE;
  const backHeight = 3.2;
  const back = new Mesh(
    new CylinderGeometry(outer, outer, backHeight, 72, 1, true),
    new MeshLambertMaterial({ map: stoneTexture(20), side: BackSide }),
  );
  back.position.y = top + backHeight / 2;
  arena.add(back);

  const arches = 28;
  const arch = new InstancedMesh(
    new BoxGeometry(1.5, 1.9, 0.1),
    new MeshLambertMaterial({ color: 0x2c2823 }),
    arches,
  );
  const m = new Matrix4();
  for (let i = 0; i < arches; i++) {
    const a = (i / arches) * Math.PI * 2;
    m.makeRotationY(a);
    m.setPosition(Math.sin(a) * (outer - 0.06), top + 1.25, Math.cos(a) * (outer - 0.06));
    arch.setMatrixAt(i, m);
  }
  arch.instanceMatrix.needsUpdate = true;
  arena.add(arch);

  const rim = new Mesh(new RingGeometry(outer - 0.15, outer + 0.6, 72), new MeshLambertMaterial({ color: 0x857c6e }));
  rim.rotation.x = -Math.PI / 2;
  rim.position.y = top + backHeight;
  arena.add(rim);
}

interface Crowd {
  bodies: InstancedMesh;
  heads: InstancedMesh;
  /** Je Zuschauer: Grundhoehe, Phase, Tempo, Sprungfreude. */
  baseY: Float32Array;
  phase: Float32Array;
  speed: Float32Array;
  eager: Float32Array;
}

const CLOTHES = [
  0x8c5a3c, 0x6b7a4f, 0x9c8a5a, 0x7a4f4f, 0x4f6b7a, 0xb09a78, 0x5a4a6b, 0xa8744a, 0x6a6a6a, 0xc2b08a,
  // dazu die Farben der beiden Kaempfer
  0x2f6fb5, 0x2f6fb5, 0xb53a2f, 0xb53a2f,
];
const SKIN = [0xe0b48c, 0xc9966b, 0x9a6b47, 0xf0cba8];
const BODY_HEIGHT = 0.56;
const HEAD_ABOVE = 0.42;

function buildCrowd(arena: Group): Crowd {
  const rnd = seeded(1234);
  const seats: { x: number; z: number; y: number; angle: number }[] = [];
  for (let t = 0; t < TIERS; t++) {
    const radius = STAND_INNER + t * TIER_DEPTH + TIER_DEPTH * 0.5;
    const y = WALL_HEIGHT + 0.2 + t * TIER_RISE;
    const count = Math.floor((Math.PI * 2 * radius) / SEAT_SPACING);
    for (let i = 0; i < count; i++) {
      // Nicht jeder Platz ist besetzt, und niemand sitzt wie abgezaehlt.
      if (rnd() < 0.1) continue;
      const angle = ((i + (rnd() - 0.5) * 0.4) / count) * Math.PI * 2;
      const r = radius + (rnd() - 0.5) * 0.25;
      seats.push({ x: Math.sin(angle) * r, z: Math.cos(angle) * r, y, angle });
    }
  }

  const n = seats.length;
  const bodies = new InstancedMesh(new BoxGeometry(0.4, BODY_HEIGHT, 0.28), new MeshLambertMaterial(), n);
  const heads = new InstancedMesh(new SphereGeometry(0.13, 8, 6), new MeshLambertMaterial(), n);
  const crowd: Crowd = {
    bodies,
    heads,
    baseY: new Float32Array(n),
    phase: new Float32Array(n),
    speed: new Float32Array(n),
    eager: new Float32Array(n),
  };
  const m = new Matrix4();
  const color = new Color();
  for (let i = 0; i < n; i++) {
    const s = seats[i];
    crowd.baseY[i] = s.y;
    crowd.phase[i] = rnd() * Math.PI * 2;
    crowd.speed[i] = 0.0016 + rnd() * 0.0022;
    crowd.eager[i] = 0.35 + rnd() * 0.65;
    // Blick zur Mitte
    m.makeRotationY(s.angle + Math.PI);
    m.setPosition(s.x, s.y + BODY_HEIGHT / 2, s.z);
    bodies.setMatrixAt(i, m);
    m.setPosition(s.x, s.y + BODY_HEIGHT / 2 + HEAD_ABOVE, s.z);
    heads.setMatrixAt(i, m);
    bodies.setColorAt(i, color.setHex(CLOTHES[Math.floor(rnd() * CLOTHES.length)]));
    heads.setColorAt(i, color.setHex(SKIN[Math.floor(rnd() * SKIN.length)]));
  }
  bodies.instanceMatrix.needsUpdate = true;
  heads.instanceMatrix.needsUpdate = true;
  if (bodies.instanceColor) bodies.instanceColor.needsUpdate = true;
  if (heads.instanceColor) heads.instanceColor.needsUpdate = true;
  // Die Hoehe aendert sich je Bild; die Grenzen der Gruppe bleiben praktisch gleich.
  bodies.frustumCulled = false;
  heads.frustumCulled = false;
  arena.add(bodies, heads);
  return crowd;
}

/** Baut Boden, Mauer, Raenge, Publikum und Licht in die Szene. */
export function buildArena(scene: Scene): ArenaScene {
  scene.background = new Color(SKY);
  scene.fog = new Fog(SKY, 34, 90);

  const arena = new Group();

  const ground = new Mesh(
    new CircleGeometry(ARENA_RADIUS, 72),
    new MeshStandardMaterial({ map: sandTexture(), roughness: 1 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  arena.add(ground);

  // Kreidekreis um die Kampfmitte
  const ring = new Mesh(
    new RingGeometry(3.4, 3.48, 72),
    new MeshStandardMaterial({ color: 0xf2e6c8, roughness: 1, transparent: true, opacity: 0.55 }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.005;
  arena.add(ring);

  const stone = new MeshStandardMaterial({ map: stoneTexture(14), roughness: 0.95, side: BackSide });
  const wall = new Mesh(new CylinderGeometry(ARENA_RADIUS, ARENA_RADIUS, WALL_HEIGHT, 72, 1, true), stone);
  wall.position.y = WALL_HEIGHT / 2;
  wall.receiveShadow = true;
  arena.add(wall);

  // Mauerkrone: Bruestung vor der ersten Reihe
  const capMaterial = new MeshStandardMaterial({ color: 0x857c6e, roughness: 0.95 });
  const cap = new Mesh(new RingGeometry(ARENA_RADIUS, STAND_INNER, 72), capMaterial);
  cap.rotation.x = -Math.PI / 2;
  cap.position.y = WALL_HEIGHT;
  arena.add(cap);
  const parapet = new Mesh(
    new CylinderGeometry(ARENA_RADIUS + 0.12, ARENA_RADIUS + 0.12, 0.3, 72, 1, true),
    new MeshStandardMaterial({ color: 0x857c6e, roughness: 0.95, side: BackSide }),
  );
  parapet.position.y = WALL_HEIGHT + 0.15;
  arena.add(parapet);

  // Banner an der Mauer, abwechselnd in den Farben der beiden Kaempfer
  const bannerColors = [0x2f6fb5, 0xb53a2f];
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
    const banner = new Mesh(
      new BoxGeometry(0.9, 1.3, 0.04),
      new MeshStandardMaterial({ color: bannerColors[i % 2], roughness: 0.9 }),
    );
    banner.position.set(Math.sin(a) * (ARENA_RADIUS - 0.06), 1.35, Math.cos(a) * (ARENA_RADIUS - 0.06));
    banner.rotation.y = a + Math.PI;
    arena.add(banner);
  }

  buildStands(arena);
  const crowd = buildCrowd(arena);

  scene.add(arena);

  // Licht: Himmel plus eine Sonne mit Schatten
  scene.add(new HemisphereLight(0xfff4dc, 0x8a6d47, 1.1));
  const sun = new DirectionalLight(0xfff0d0, 2.4);
  sun.position.set(5, 11, 6);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -6;
  sun.shadow.camera.right = 6;
  sun.shadow.camera.top = 6;
  sun.shadow.camera.bottom = -6;
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 30;
  sun.shadow.bias = -0.0005;
  scene.add(sun);

  let excitement = 0;
  const count = crowd.baseY.length;
  return {
    update(dtSeconds: number, clockMs: number): void {
      excitement = Math.max(0, excitement - dtSeconds * CHEER_DECAY);
      const bodies = crowd.bodies.instanceMatrix.array;
      const heads = crowd.heads.instanceMatrix.array;
      for (let i = 0; i < count; i++) {
        // Ruhe: leichtes Wippen. Aufregung: aufspringen, jeder in seinem Takt.
        const wave = Math.sin(clockMs * crowd.speed[i] + crowd.phase[i]);
        const jump = Math.abs(Math.sin(clockMs * crowd.speed[i] * 2.6 + crowd.phase[i]));
        const y = crowd.baseY[i] + 0.015 * wave + excitement * crowd.eager[i] * 0.24 * jump;
        // Element 13 einer Matrix ist die Hoehe ihrer Verschiebung.
        bodies[i * 16 + 13] = y + BODY_HEIGHT / 2;
        heads[i * 16 + 13] = y + BODY_HEIGHT / 2 + HEAD_ABOVE;
      }
      crowd.bodies.instanceMatrix.needsUpdate = true;
      crowd.heads.instanceMatrix.needsUpdate = true;
    },
    cheer(amount: number): void {
      excitement = Math.min(1, excitement + amount);
    },
  };
}
