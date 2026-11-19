// Die Arena: runder Sandplatz mit Mauer, einfaches Licht.
// Alle Texturen entstehen zur Laufzeit auf einer Zeichenflaeche - keine Dateien.

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
  MeshStandardMaterial,
  RepeatWrapping,
  RingGeometry,
  SRGBColorSpace,
  type Scene,
} from 'three';

/** Radius des Sandplatzes (m). */
export const ARENA_RADIUS = 9;
const WALL_HEIGHT = 2.8;
const SKY = 0x9cc3e6;

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

function stoneTexture(): CanvasTexture {
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
  tex.repeat.set(14, 1);
  tex.colorSpace = SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

/** Baut Boden, Mauer, Zinnen, Banner und Licht in die Szene. */
export function buildArena(scene: Scene): void {
  scene.background = new Color(SKY);
  scene.fog = new Fog(SKY, 26, 60);

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

  const stone = new MeshStandardMaterial({ map: stoneTexture(), roughness: 0.95, side: BackSide });
  const wall = new Mesh(new CylinderGeometry(ARENA_RADIUS, ARENA_RADIUS, WALL_HEIGHT, 72, 1, true), stone);
  wall.position.y = WALL_HEIGHT / 2;
  wall.receiveShadow = true;
  arena.add(wall);

  // Mauerkrone und Zinnen
  const capMaterial = new MeshStandardMaterial({ color: 0x857c6e, roughness: 0.95 });
  const cap = new Mesh(new RingGeometry(ARENA_RADIUS, ARENA_RADIUS + 0.7, 72), capMaterial);
  cap.rotation.x = -Math.PI / 2;
  cap.position.y = WALL_HEIGHT;
  arena.add(cap);

  const merlons = 36;
  const merlonMesh = new InstancedMesh(new BoxGeometry(0.75, 0.5, 0.5), capMaterial, merlons);
  const m = new Matrix4();
  for (let i = 0; i < merlons; i++) {
    const a = (i / merlons) * Math.PI * 2;
    m.makeRotationY(-a);
    m.setPosition(Math.sin(a) * (ARENA_RADIUS + 0.3), WALL_HEIGHT + 0.25, Math.cos(a) * (ARENA_RADIUS + 0.3));
    merlonMesh.setMatrixAt(i, m);
  }
  merlonMesh.instanceMatrix.needsUpdate = true;
  arena.add(merlonMesh);

  // Banner an der Mauer, abwechselnd in den Farben der beiden Kaempfer
  const bannerColors = [0x2f6fb5, 0xb53a2f];
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
    const banner = new Mesh(
      new BoxGeometry(0.9, 1.5, 0.04),
      new MeshStandardMaterial({ color: bannerColors[i % 2], roughness: 0.9 }),
    );
    banner.position.set(Math.sin(a) * (ARENA_RADIUS - 0.06), 1.75, Math.cos(a) * (ARENA_RADIUS - 0.06));
    banner.rotation.y = a + Math.PI;
    arena.add(banner);
  }

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
}
