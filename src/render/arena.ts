// Die Arena: ein Amphitheater aus Sandstein nach Marcos Vorlage vom 19.11.2026.
//
// Von innen nach aussen:
//   Sandplatz -> Podiumsmauer mit Bannern und Gittertor -> Umgang ->
//   sieben Sitzstufen mit Treppen -> Bogengalerie mit Fahnen.
// Aussen zwei Geschosse: unten Blendbogen und vier Holztore, oben die offene
// Galerie, durch deren Bogen man von innen den Himmel sieht.
// Dazu die Loge mit Thron ueber der Podiumsmauer und zwei Waffenstaender.
//
// Alles entsteht aus Grundformen zur Laufzeit - keine Dateien. Wiederholte
// Teile (Bogenfelder, Decksteine, Zuschauer) sind Instanzen einer Form.
//
// Winkel: 0 zeigt nach +Z (vorn, zur Kamera des Kampfes), PI nach -Z (hinten).

import {
  BackSide,
  BoxGeometry,
  BufferGeometry,
  CanvasTexture,
  CircleGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DirectionalLight,
  DoubleSide,
  ExtrudeGeometry,
  FrontSide,
  Group,
  HemisphereLight,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshLambertMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  RepeatWrapping,
  RingGeometry,
  Shape,
  ShapeGeometry,
  SphereGeometry,
  ShadowMaterial,
  SRGBColorSpace,
  Vector3,
  type Material,
  type Scene,
} from 'three';

/** Radius des Sandplatzes (m). */
export const ARENA_RADIUS = 9;

// --- Masse, abgelesen aus der Vorlage (Aussenradius ~1,8 x Platzradius) ----
const PODIUM_HEIGHT = 1.25;
const PODIUM_THICK = 0.8;
const WALK_WIDTH = 0.45;
const WALK_Y = 0.9;
const TIERS = 7;
const TIER_DEPTH = 0.66;
const TIER_RISE = 0.42;
const TIER_FIRST_Y = 1.3;
const STAND_INNER = ARENA_RADIUS + PODIUM_THICK + WALK_WIDTH;
const STAND_OUTER = STAND_INNER + TIERS * TIER_DEPTH;
const GALLERY_BASE = TIER_FIRST_Y + TIERS * TIER_RISE;
const GALLERY_DEPTH = 1.65;
const GALLERY_HEIGHT = 3.0;
const COPING_HEIGHT = 0.6;
/** Aussenradius des Bauwerks (m). */
export const ARENA_OUTER_RADIUS = STAND_OUTER + GALLERY_DEPTH;
/** Hoehe bis zur Oberkante der Decksteine (m). */
export const ARENA_HEIGHT = GALLERY_BASE + GALLERY_HEIGHT + COPING_HEIGHT;
/** Bogenfelder rundum. Durch 8 teilbar, damit die Tore auf einem Feld sitzen. */
const BAYS = 40;
const SEGMENTS = 96;

// Winkel der vier Tore, der Treppen und der Loge.
const GATE_ANGLES = [Math.PI / 4, (3 * Math.PI) / 4, (5 * Math.PI) / 4, (7 * Math.PI) / 4];
const AISLE_ANGLES = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => (i * Math.PI) / 4 + Math.PI / 8);
/** Die Loge sitzt hinten rechts. */
const BOX_ANGLE = Math.PI - (38 * Math.PI) / 180;
const BOX_WIDTH = 5.0;
/** Das Gittertor sitzt in der Podiumsmauer knapp neben der Loge. */
const GRATE_ANGLE = BOX_ANGLE + (7 * Math.PI) / 180;
/**
 * Um diesen Winkel ist das Bauwerk gegen die Kampfachse gedreht: So steht die
 * Loge in der Kampfansicht rechts hinter dem Gegner im Bild. Die Aussenansicht
 * dreht sich mit und zeigt die Arena wie in der Vorlage.
 */
export const ARENA_TURN = (40 * Math.PI) / 180;

// Farben der Vorlage: ein warmer Sandstein, dazu Rot, Blau, Gold und Holz.
const STONE = 0xe0a868;
const STONE_LIGHT = 0xedbe84;
const STONE_SHADE = 0xc98f58;
const BASE_BAND = 0x9c653a;
const WOOD = 0x7a4e2c;
const WOOD_DARK = 0x4f321d;
const IRON = 0x4a4a50;
const STEEL = 0xc9d0d8;
const RED = 0xb53a32;
const BLUE = 0x4a6fb8;
const GOLD = 0xdcab3e;
const CARPET = 0x9e2f2b;
const BACKDROP = 0xdadade;
const UP_AXIS = new Vector3(0, 1, 0);

/** Abstand zweier Zuschauer auf einer Stufe (m). */
const SEAT_SPACING = 0.6;
/** So schnell legt sich die Aufregung wieder (1/s). */
const CHEER_DECAY = 0.9;

export interface ArenaScene {
  /** Je Bild: Publikum und Fahnen bewegen. */
  update(dtSeconds: number, clockMs: number): void;
  /** Das Publikum reagiert; `amount` 0..1. */
  cheer(amount: number): void;
  /** Raenge besetzt oder leer wie in der Vorlage. */
  setCrowdVisible(visible: boolean): void;
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
    ctx.fillStyle = '#e7bd80';
    ctx.fillRect(0, 0, size, size);
    const rnd = seeded(7);
    // Nur ein Hauch Koernung: Die Vorlage ist fast glatt.
    for (let i = 0; i < 5000; i++) {
      const light = rnd() > 0.5;
      ctx.fillStyle = light ? `rgba(255, 236, 190, ${0.05 + rnd() * 0.08})` : `rgba(150, 105, 55, ${0.04 + rnd() * 0.07})`;
      ctx.beginPath();
      ctx.arc(rnd() * size, rnd() * size, 0.6 + rnd() * 2, 0, Math.PI * 2);
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

function stone(color: number): MeshStandardMaterial {
  return new MeshStandardMaterial({ color, roughness: 0.9 });
}

/** Breite und Hoehe einer Kachel des Fugenbilds in Metern (2 Quader breit, 4 Lagen hoch). */
const BLOCK_TILE_WIDTH = 2.6;
const BLOCK_TILE_HEIGHT = 2.2;
let blockImage: HTMLCanvasElement | null = null;

/**
 * Fugenbild grosser Quader: weisser Grund (die Steinfarbe kommt vom Material),
 * dunkle Fuge mit heller Kante darunter - wie leicht gefaste Bloecke.
 * `repeatX`/`repeatY`: wie oft die Kachel auf der Flaeche liegt.
 */
function blockTexture(repeatX: number, repeatY: number): CanvasTexture {
  if (!blockImage) {
    const w = 512;
    const h = 512;
    blockImage = document.createElement('canvas');
    blockImage.width = w;
    blockImage.height = h;
    const ctx = blockImage.getContext('2d');
    if (ctx) {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, w, h);
      const rows = 4;
      const rowH = h / rows;
      const rnd = seeded(5);
      for (let r = 0; r < rows; r++) {
        const shift = r % 2 === 0 ? 0 : w / 4;
        for (let c = -1; c < 3; c++) {
          // Jeder Stein einen Hauch anders
          const tone = 236 + Math.floor(rnd() * 19);
          ctx.fillStyle = `rgb(${tone}, ${tone}, ${tone})`;
          ctx.fillRect(c * (w / 2) + shift, r * rowH, w / 2, rowH);
        }
        ctx.fillStyle = 'rgba(120, 72, 34, 0.5)';
        ctx.fillRect(0, r * rowH, w, 5);
        ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
        ctx.fillRect(0, r * rowH + 5, w, 3);
        for (let c = 0; c < 3; c++) {
          const x = (c * w) / 2 + shift;
          ctx.fillStyle = 'rgba(120, 72, 34, 0.5)';
          ctx.fillRect(x % w, r * rowH, 5, rowH);
          ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
          ctx.fillRect((x + 5) % w, r * rowH + 5, 3, rowH - 5);
        }
      }
    }
  }
  const tex = new CanvasTexture(blockImage);
  tex.wrapS = RepeatWrapping;
  tex.wrapT = RepeatWrapping;
  tex.repeat.set(repeatX, repeatY);
  tex.colorSpace = SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

/** Gemauerte Flaeche fuer Teile, deren Texturkoordinaten in Metern laufen (extrudierte Felder). */
function masonry(color: number): MeshStandardMaterial {
  return new MeshStandardMaterial({ color, roughness: 0.9, map: blockTexture(1 / BLOCK_TILE_WIDTH, 1 / BLOCK_TILE_HEIGHT) });
}

/** Gemauerte Mantelflaeche eines Zylinders mit Radius und Hoehe in Metern. */
function masonryRound(color: number, radius: number, height: number, side: typeof BackSide | typeof FrontSide): MeshStandardMaterial {
  const around = Math.round((2 * Math.PI * radius) / BLOCK_TILE_WIDTH);
  return new MeshStandardMaterial({ color, roughness: 0.9, side, map: blockTexture(around, height / BLOCK_TILE_HEIGHT) });
}

/** Position und Drehung fuer ein Teil am Kreis: +Z des Teils zeigt nach aussen. */
function onCircle(m: Matrix4, angle: number, radius: number, y: number): Matrix4 {
  m.makeRotationY(angle);
  m.setPosition(Math.sin(angle) * radius, y, Math.cos(angle) * radius);
  return m;
}

function place(mesh: Mesh | Group, angle: number, radius: number, y: number, faceInward = false): void {
  mesh.position.set(Math.sin(angle) * radius, y, Math.cos(angle) * radius);
  mesh.rotation.y = faceInward ? angle + Math.PI : angle;
}

/** Kleinster Winkelabstand zweier Winkel. */
function angleBetween(a: number, b: number): number {
  const d = Math.abs(a - b) % (Math.PI * 2);
  return d > Math.PI ? Math.PI * 2 - d : d;
}

/** Wandfeld mit Bogenoeffnung, die am Boden beginnt (Umriss in einem Zug, ohne Loch). */
function archPanel(width: number, height: number, openWidth: number, openStraight: number, depth: number): BufferGeometry {
  const w = width / 2;
  const o = openWidth / 2;
  const shape = new Shape();
  shape.moveTo(-w, 0);
  shape.lineTo(-o, 0);
  shape.lineTo(-o, openStraight);
  shape.absarc(0, openStraight, o, Math.PI, 0, true);
  shape.lineTo(o, 0);
  shape.lineTo(w, 0);
  shape.lineTo(w, height);
  shape.lineTo(-w, height);
  shape.closePath();
  const geo = new ExtrudeGeometry(shape, { depth, bevelEnabled: false, curveSegments: 10 });
  geo.translate(0, 0, -depth / 2);
  return geo;
}

/** Flaeche in Bogenform (Tor, Nische). */
function archFace(openWidth: number, openStraight: number): Shape {
  const o = openWidth / 2;
  const shape = new Shape();
  shape.moveTo(-o, 0);
  shape.lineTo(o, 0);
  shape.lineTo(o, openStraight);
  shape.absarc(0, openStraight, o, 0, Math.PI, false);
  shape.closePath();
  return shape;
}

function shadowed<T extends Mesh | InstancedMesh>(mesh: T): T {
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

// ---------------------------------------------------------------------------
// Platz, Podiumsmauer, Sitzstufen
// ---------------------------------------------------------------------------

function buildBowl(arena: Group): void {
  const main = stone(STONE);
  const light = stone(STONE_LIGHT);
  const inward = new MeshStandardMaterial({ color: STONE, roughness: 0.9, side: BackSide });

  const ground = new Mesh(new CircleGeometry(ARENA_RADIUS, SEGMENTS), new MeshStandardMaterial({ map: sandTexture(), color: 0xffffff, roughness: 1 }));
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  arena.add(ground);

  const ring = (inner: number, outer: number, y: number, material: Material): void => {
    const mesh = new Mesh(new RingGeometry(inner, outer, SEGMENTS), material);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.y = y;
    mesh.receiveShadow = true;
    arena.add(mesh);
  };
  /** Senkrechte Flaeche, von innen (zur Mitte) oder von aussen zu sehen. */
  const face = (radius: number, y0: number, y1: number, material: Material): void => {
    const mesh = new Mesh(new CylinderGeometry(radius, radius, y1 - y0, SEGMENTS, 1, true), material);
    mesh.position.y = (y0 + y1) / 2;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    arena.add(mesh);
  };

  // Podiumsmauer: Innenseite mit dunklem Sockelband, gerundete Krone
  face(ARENA_RADIUS, 0, PODIUM_HEIGHT, masonryRound(STONE, ARENA_RADIUS, PODIUM_HEIGHT, BackSide));
  face(ARENA_RADIUS - 0.02, 0, 0.3, new MeshStandardMaterial({ color: BASE_BAND, roughness: 0.95, side: BackSide }));
  ring(ARENA_RADIUS - 0.08, ARENA_RADIUS + PODIUM_THICK, PODIUM_HEIGHT, light);
  face(ARENA_RADIUS - 0.08, PODIUM_HEIGHT - 0.2, PODIUM_HEIGHT, new MeshStandardMaterial({ color: STONE_LIGHT, roughness: 0.9, side: BackSide }));
  face(ARENA_RADIUS + PODIUM_THICK, WALK_Y, PODIUM_HEIGHT, main);

  // Umgang hinter der Mauer
  ring(ARENA_RADIUS + PODIUM_THICK, STAND_INNER, WALK_Y, stone(STONE_SHADE));

  // Sitzstufen
  for (let t = 0; t < TIERS; t++) {
    const inner = STAND_INNER + t * TIER_DEPTH;
    const y = TIER_FIRST_Y + t * TIER_RISE;
    face(inner, t === 0 ? WALK_Y : y - TIER_RISE, y, inward);
    ring(inner, inner + TIER_DEPTH, y, main);
  }
  // Stirnseite unter der Galerie und deren Boden
  face(STAND_OUTER, GALLERY_BASE - TIER_RISE, GALLERY_BASE, inward);
  ring(STAND_OUTER, ARENA_OUTER_RADIUS, GALLERY_BASE, light);

  // Treppen: je Stufe eine halbe Zwischenstufe
  const stepGeo = new BoxGeometry(0.95, TIER_RISE / 2, TIER_DEPTH / 2);
  const steps = shadowed(new InstancedMesh(stepGeo, main, AISLE_ANGLES.length * TIERS));
  const m = new Matrix4();
  let n = 0;
  for (const angle of AISLE_ANGLES) {
    for (let t = 0; t < TIERS; t++) {
      // Die Zwischenstufe liegt auf der Stufe darunter, direkt vor der Stirnseite.
      const below = t === 0 ? WALK_Y : TIER_FIRST_Y + (t - 1) * TIER_RISE;
      steps.setMatrixAt(n++, onCircle(m, angle, STAND_INNER + t * TIER_DEPTH - TIER_DEPTH / 4, below + TIER_RISE / 4));
    }
  }
  steps.instanceMatrix.needsUpdate = true;
  arena.add(steps);
}

// ---------------------------------------------------------------------------
// Banner und Gittertor an der Podiumsmauer
// ---------------------------------------------------------------------------

function buildPodiumDetails(arena: Group): void {
  const shield = new Shape();
  shield.moveTo(-0.3, 0.38);
  shield.lineTo(0.3, 0.38);
  shield.lineTo(0.3, -0.12);
  shield.lineTo(0, -0.42);
  shield.lineTo(-0.3, -0.12);
  shield.closePath();
  const shieldGeo = new ShapeGeometry(shield);
  const barGeo = new BoxGeometry(0.72, 0.07, 0.05);
  const gold = new MeshStandardMaterial({ color: GOLD, roughness: 0.5, metalness: 0.4 });
  const cloth = [new MeshStandardMaterial({ color: BLUE, roughness: 0.85, side: DoubleSide }), new MeshStandardMaterial({ color: RED, roughness: 0.85, side: DoubleSide })];
  const count = 10;
  for (let i = 0; i < count; i++) {
    const angle = (i / count) * Math.PI * 2 + Math.PI / count;
    // Platz fuer das Gittertor.
    if (angleBetween(angle, GRATE_ANGLE) < 0.2) continue;
    const banner = new Mesh(shieldGeo, cloth[i % 2]);
    place(banner, angle, ARENA_RADIUS - 0.04, 0.72, true);
    arena.add(banner);
    const bar = new Mesh(barGeo, gold);
    place(bar, angle, ARENA_RADIUS - 0.05, 1.12, true);
    arena.add(bar);
  }

  // Gittertor: dunkle Oeffnung, Eisenstaebe, Steinrahmen
  const gate = new Group();
  const opening = new Mesh(new ShapeGeometry(archFace(1.1, 0.45)), new MeshStandardMaterial({ color: 0x241c17, roughness: 1, side: DoubleSide }));
  opening.position.set(0, 0.05, 0);
  gate.add(opening);
  const iron = new MeshStandardMaterial({ color: IRON, roughness: 0.6, metalness: 0.5 });
  for (let i = -2; i <= 2; i++) {
    const bar = new Mesh(new BoxGeometry(0.05, 0.98 - Math.abs(i) * 0.11, 0.05), iron);
    bar.position.set(i * 0.2, 0.05 + (0.98 - Math.abs(i) * 0.11) / 2, 0.03);
    gate.add(bar);
  }
  for (let j = 0; j < 3; j++) {
    const bar = new Mesh(new BoxGeometry(1.0 - j * 0.14, 0.05, 0.05), iron);
    bar.position.set(0, 0.25 + j * 0.27, 0.03);
    gate.add(bar);
  }
  const frame = shadowed(new Mesh(archPanel(1.5, 1.17, 1.1, 0.45, 0.14), stone(STONE_LIGHT)));
  frame.position.set(0, 0.05, 0.04);
  gate.add(frame);
  place(gate, GRATE_ANGLE, ARENA_RADIUS - 0.06, 0, true);
  arena.add(gate);
}

// ---------------------------------------------------------------------------
// Bogengalerie, Decksteine, Fahnen
// ---------------------------------------------------------------------------

interface Flags {
  cloths: Mesh[];
}

function buildGallery(arena: Group): Flags {
  const midRadius = STAND_OUTER + GALLERY_DEPTH / 2;
  // Feldbreite am Aussenradius, damit aussen keine Fugen klaffen.
  const bayWidth = 2 * ARENA_OUTER_RADIUS * Math.tan(Math.PI / BAYS) + 0.02;
  const panels = shadowed(
    new InstancedMesh(archPanel(bayWidth, GALLERY_HEIGHT, bayWidth * 0.52, GALLERY_HEIGHT * 0.5, GALLERY_DEPTH), masonry(STONE), BAYS),
  );
  // Decksteine: einzelne Bloecke mit Fuge, wie aufgesetzt
  const copingGeo = new BoxGeometry(bayWidth - 0.18, COPING_HEIGHT, GALLERY_DEPTH + 0.4);
  const coping = shadowed(new InstancedMesh(copingGeo, stone(STONE_LIGHT), BAYS));
  // Bruestung im Bogen: von aussen beginnt die Oeffnung nicht am Gesims
  const parapet = shadowed(new InstancedMesh(new BoxGeometry(bayWidth * 0.54, 0.6, 0.3), stone(STONE), BAYS));
  const m = new Matrix4();
  const rnd = seeded(99);
  for (let i = 0; i < BAYS; i++) {
    const angle = (i / BAYS) * Math.PI * 2;
    panels.setMatrixAt(i, onCircle(m, angle, midRadius, GALLERY_BASE));
    // Die Bloecke sitzen nicht alle gleich hoch.
    coping.setMatrixAt(i, onCircle(m, angle, midRadius, GALLERY_BASE + GALLERY_HEIGHT + COPING_HEIGHT / 2 + (rnd() - 0.5) * 0.05));
    parapet.setMatrixAt(i, onCircle(m, angle, ARENA_OUTER_RADIUS - 0.16, GALLERY_BASE + 0.3));
  }
  panels.instanceMatrix.needsUpdate = true;
  coping.instanceMatrix.needsUpdate = true;
  parapet.instanceMatrix.needsUpdate = true;
  arena.add(panels, coping, parapet);

  // Fahnen wie in der Vorlage: hinten rot, an den Seiten und vorn blau.
  const flagSpots: [number, number][] = [
    [180 - 62, RED], [180 - 33, RED], [180 + 4, RED], [180 + 33, RED], [180 + 60, RED],
    [270, BLUE], [90, BLUE], [72, RED], [345, BLUE],
  ];
  const pole = new CylinderGeometry(0.04, 0.05, 1.9, 8);
  const knob = new SphereGeometry(0.08, 10, 8);
  const flagShape = new Shape();
  flagShape.moveTo(0, 0);
  flagShape.lineTo(0.95, 0);
  flagShape.lineTo(0.72, 0.26);
  flagShape.lineTo(0.95, 0.52);
  flagShape.lineTo(0, 0.52);
  flagShape.closePath();
  const flagGeo = new ShapeGeometry(flagShape);
  const wood = new MeshStandardMaterial({ color: WOOD, roughness: 0.8 });
  const gold = new MeshStandardMaterial({ color: GOLD, roughness: 0.5, metalness: 0.4 });
  const top = GALLERY_BASE + GALLERY_HEIGHT + COPING_HEIGHT;
  const cloths: Mesh[] = [];
  for (const [degrees, color] of flagSpots) {
    const angle = (degrees * Math.PI) / 180;
    const x = Math.sin(angle) * midRadius;
    const z = Math.cos(angle) * midRadius;
    const staff = shadowed(new Mesh(pole, wood));
    staff.position.set(x, top + 0.95, z);
    const ball = new Mesh(knob, gold);
    ball.position.set(x, top + 1.93, z);
    const cloth = new Mesh(flagGeo, new MeshStandardMaterial({ color, roughness: 0.85, side: DoubleSide }));
    cloth.position.set(x, top + 1.3, z);
    cloth.castShadow = true;
    cloths.push(cloth);
    arena.add(staff, ball, cloth);
  }
  return { cloths };
}

// ---------------------------------------------------------------------------
// Aussenfassade: zwei Geschosse Blendbogen, Gesimse, Pfeiler, Holztore
// ---------------------------------------------------------------------------

function buildFacade(arena: Group): void {
  const corniceHeight = 0.2;
  const storyHeight = GALLERY_BASE - corniceHeight;
  const frameDepth = 0.36;
  const bayWidth = 2 * ARENA_OUTER_RADIUS * Math.tan(Math.PI / BAYS) + 0.02;
  const bayAngle = (Math.PI * 2) / BAYS;
  const fullHeight = GALLERY_BASE + GALLERY_HEIGHT;
  const isGateBay = (i: number): boolean => GATE_ANGLES.some((a) => angleBetween(a, i * bayAngle) < bayAngle * 0.5);

  // Rueckwand der Nischen, etwas dunkler: Sie liegt im Schatten.
  const back = shadowed(
    new Mesh(
      new CylinderGeometry(ARENA_OUTER_RADIUS - frameDepth, ARENA_OUTER_RADIUS - frameDepth, GALLERY_BASE, SEGMENTS, 1, true),
      masonryRound(STONE_SHADE, ARENA_OUTER_RADIUS - frameDepth, GALLERY_BASE, FrontSide),
    ),
  );
  back.position.y = GALLERY_BASE / 2;
  arena.add(back);

  // Untergeschoss: ein Blendbogen je Feld, ausser dort, wo ein Tor steht
  const bays: number[] = [];
  for (let i = 0; i < BAYS; i++) if (!isGateBay(i)) bays.push(i);
  const lower = shadowed(new InstancedMesh(archPanel(bayWidth, storyHeight, bayWidth * 0.62, storyHeight * 0.5, frameDepth), masonry(STONE), bays.length));
  const sill = shadowed(new InstancedMesh(new BoxGeometry(bayWidth * 0.66, 0.32, frameDepth * 0.8), stone(STONE_LIGHT), bays.length));
  const m = new Matrix4();
  const radius = ARENA_OUTER_RADIUS - frameDepth / 2;
  bays.forEach((bay, n) => {
    lower.setMatrixAt(n, onCircle(m, bay * bayAngle, radius, 0));
    sill.setMatrixAt(n, onCircle(m, bay * bayAngle, radius, 0.5));
  });
  lower.instanceMatrix.needsUpdate = true;
  sill.instanceMatrix.needsUpdate = true;
  arena.add(lower, sill);

  // Gesims zwischen den Geschossen: ein Band, das rundum vorsteht
  const ledge = ARENA_OUTER_RADIUS + 0.16;
  const cornice = shadowed(new Mesh(new CylinderGeometry(ledge, ledge, corniceHeight, SEGMENTS, 1, true), stone(STONE_LIGHT)));
  cornice.position.y = GALLERY_BASE - corniceHeight / 2;
  arena.add(cornice);
  for (const y of [GALLERY_BASE - corniceHeight, GALLERY_BASE]) {
    const lip = new Mesh(new RingGeometry(ARENA_OUTER_RADIUS - 0.05, ledge, SEGMENTS), new MeshStandardMaterial({ color: STONE_LIGHT, roughness: 0.9, side: DoubleSide }));
    lip.rotation.x = -Math.PI / 2;
    lip.position.y = y;
    arena.add(lip);
  }
  // Sockel
  const plinth = shadowed(new Mesh(new CylinderGeometry(ARENA_OUTER_RADIUS + 0.14, ARENA_OUTER_RADIUS + 0.22, 0.4, SEGMENTS, 1, true), stone(STONE)));
  plinth.position.y = 0.2;
  arena.add(plinth);

  // Pfeiler ueber beide Geschosse, gleichmaessig zwischen den Feldern
  const pierGeo = new BoxGeometry(0.62, fullHeight, 0.42);
  const capGeo = new BoxGeometry(0.8, 0.3, 0.56);
  const piers: number[] = [];
  for (let i = 0; i < BAYS; i++) if (i % 5 === 2) piers.push((i + 0.5) * bayAngle);
  const pierMesh = shadowed(new InstancedMesh(pierGeo, stone(STONE_LIGHT), piers.length));
  const capMesh = shadowed(new InstancedMesh(capGeo, stone(STONE_LIGHT), piers.length * 2));
  piers.forEach((angle, n) => {
    pierMesh.setMatrixAt(n, onCircle(m, angle, ARENA_OUTER_RADIUS + 0.08, fullHeight / 2));
    capMesh.setMatrixAt(n * 2, onCircle(m, angle, ARENA_OUTER_RADIUS + 0.1, 0.35));
    capMesh.setMatrixAt(n * 2 + 1, onCircle(m, angle, ARENA_OUTER_RADIUS + 0.1, GALLERY_BASE - corniceHeight / 2));
  });
  pierMesh.instanceMatrix.needsUpdate = true;
  capMesh.instanceMatrix.needsUpdate = true;
  arena.add(pierMesh, capMesh);

  // Tore: vortretender Bau mit kraeftigen Pfeilern, darin die Holzfluegel
  const wood = new MeshStandardMaterial({ color: WOOD, roughness: 0.85 });
  const woodDark = new MeshStandardMaterial({ color: WOOD_DARK, roughness: 0.9 });
  const iron = new MeshStandardMaterial({ color: IRON, roughness: 0.6, metalness: 0.5 });
  const portalWidth = 4.0;
  const doorWidth = 2.8;
  const doorStraight = 2.15;
  const doorRadius = doorWidth / 2;
  for (const angle of GATE_ANGLES) {
    const gate = new Group();
    gate.add(shadowed(new Mesh(archPanel(portalWidth, GALLERY_BASE, doorWidth, doorStraight, 0.8), masonry(STONE))));
    for (const side of [-1, 1]) {
      const x = side * (portalWidth / 2 - 0.12);
      const pier = shadowed(new Mesh(new BoxGeometry(0.7, fullHeight, 0.56), stone(STONE_LIGHT)));
      pier.position.set(x, fullHeight / 2, 0.36);
      const foot = shadowed(new Mesh(new BoxGeometry(0.9, 0.55, 0.74), stone(STONE)));
      foot.position.set(x, 0.275, 0.36);
      const band = shadowed(new Mesh(new BoxGeometry(0.88, 0.3, 0.72), stone(STONE_LIGHT)));
      band.position.set(x, GALLERY_BASE - corniceHeight / 2, 0.36);
      gate.add(pier, foot, band);
    }
    const door = new Mesh(new ShapeGeometry(archFace(doorWidth, doorStraight)), wood);
    door.position.z = -0.16;
    gate.add(door);
    // Bretterfugen, in der Mitte der Spalt zwischen den Fluegeln
    for (let i = -5; i <= 5; i++) {
      const x = i * 0.25;
      const height = doorStraight + Math.sqrt(Math.max(0, doorRadius * doorRadius - x * x)) - 0.04;
      const gap = new Mesh(new BoxGeometry(i === 0 ? 0.07 : 0.03, height, 0.03), woodDark);
      gap.position.set(x, height / 2, -0.14);
      gate.add(gap);
    }
    for (const y of [0.7, 2.0]) {
      const band = new Mesh(new BoxGeometry(doorWidth - 0.12, 0.14, 0.05), iron);
      band.position.set(0, y, -0.12);
      gate.add(band);
    }
    for (const side of [-1, 1]) {
      const handle = new Mesh(new SphereGeometry(0.08, 10, 8), iron);
      handle.position.set(side * 0.2, 1.35, -0.09);
      gate.add(handle);
    }
    place(gate, angle, ARENA_OUTER_RADIUS - 0.25, 0);
    arena.add(gate);
  }
}

// ---------------------------------------------------------------------------
// Loge mit Thron
// ---------------------------------------------------------------------------

function buildRoyalBox(arena: Group): void {
  const box = new Group();
  const depth = 4.4;
  const floorY = 2.95;
  const main = stone(STONE);
  const light = stone(STONE_LIGHT);
  const gold = new MeshStandardMaterial({ color: GOLD, roughness: 0.45, metalness: 0.5 });
  const red = new MeshStandardMaterial({ color: RED, roughness: 0.85, side: DoubleSide });
  const add = (mesh: Mesh, x: number, y: number, z: number): Mesh => {
    mesh.position.set(x, y, z);
    shadowed(mesh);
    box.add(mesh);
    return mesh;
  };

  // In der Gruppe zeigt +Z zur Platzmitte.
  add(new Mesh(new BoxGeometry(BOX_WIDTH, floorY - WALK_Y, depth), main), 0, (floorY + WALK_Y) / 2, 0);
  add(new Mesh(new BoxGeometry(BOX_WIDTH + 0.25, 0.22, depth + 0.25), light), 0, floorY - 0.11, 0);
  add(new Mesh(new BoxGeometry(BOX_WIDTH + 0.1, 0.3, 0.3), light), 0, WALK_Y + 0.55, depth / 2 + 0.05);
  add(new Mesh(new BoxGeometry(BOX_WIDTH - 0.5, 0.05, depth - 0.5), new MeshStandardMaterial({ color: CARPET, roughness: 0.95 })), 0, floorY + 0.03, 0);

  // Bruestung vorn und an den Seiten
  const baluster = new CylinderGeometry(0.06, 0.08, 0.55, 8);
  const railY = floorY + 0.68;
  for (let i = 0; i <= 14; i++) {
    const x = -BOX_WIDTH / 2 + 0.18 + (i * (BOX_WIDTH - 0.36)) / 14;
    add(new Mesh(baluster, light), x, floorY + 0.3, depth / 2 - 0.12);
  }
  add(new Mesh(new BoxGeometry(BOX_WIDTH, 0.14, 0.2), light), 0, railY, depth / 2 - 0.12);
  for (const side of [-1, 1]) {
    for (let i = 1; i <= 7; i++) {
      add(new Mesh(baluster, light), side * (BOX_WIDTH / 2 - 0.12), floorY + 0.3, depth / 2 - 0.12 - (i * (depth - 1.2)) / 8);
    }
    add(new Mesh(new BoxGeometry(0.2, 0.14, depth - 1.0), light), side * (BOX_WIDTH / 2 - 0.12), railY, 0.4);
  }

  // Vier goldene Pfosten, Dach
  const postHeight = 2.7;
  const roofY = floorY + postHeight;
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      add(new Mesh(new CylinderGeometry(0.075, 0.075, postHeight, 10), gold), sx * (BOX_WIDTH / 2 - 0.2), floorY + postHeight / 2, sz * (depth / 2 - 0.22));
    }
  }
  add(new Mesh(new BoxGeometry(BOX_WIDTH + 0.5, 0.32, depth + 0.5), light), 0, roofY + 0.16, 0);
  add(new Mesh(new BoxGeometry(BOX_WIDTH + 0.1, 0.1, depth + 0.1), stone(STONE)), 0, roofY + 0.37, 0);
  add(new Mesh(new BoxGeometry(BOX_WIDTH - 0.4, 0.05, depth - 0.4), light), 0, roofY + 0.44, 0);

  // Vorhaenge: Schabracke rundum mit Goldkante, geraffte Bahnen an den Pfosten, Rueckwand
  const valance = (width: number, x: number, z: number, turned: boolean): void => {
    const cloth = add(new Mesh(new BoxGeometry(width, 0.42, 0.06), red), x, roofY - 0.21, z);
    const trim = add(new Mesh(new BoxGeometry(width, 0.06, 0.07), gold), x, roofY - 0.44, z);
    if (turned) {
      cloth.rotation.y = Math.PI / 2;
      trim.rotation.y = Math.PI / 2;
    }
  };
  // Vorn: drei geraffte Boegen mit goldenen Quasten dazwischen
  const swagWidth = (BOX_WIDTH - 0.5) / 3;
  const swag = new Shape();
  swag.moveTo(-swagWidth / 2, 0);
  swag.lineTo(swagWidth / 2, 0);
  swag.lineTo(swagWidth / 2, -0.62);
  swag.quadraticCurveTo(0, -0.12, -swagWidth / 2, -0.62);
  swag.closePath();
  const swagGeo = new ShapeGeometry(swag, 10);
  for (let i = 0; i < 3; i++) {
    const cloth = new Mesh(swagGeo, red);
    cloth.position.set((i - 1) * swagWidth, roofY, depth / 2 - 0.2);
    cloth.castShadow = true;
    box.add(cloth);
  }
  for (let i = 0; i <= 3; i++) {
    add(new Mesh(new SphereGeometry(0.07, 8, 6), gold), (i - 1.5) * swagWidth, roofY - 0.66, depth / 2 - 0.2);
  }
  add(new Mesh(new BoxGeometry(BOX_WIDTH - 0.3, 0.07, 0.07), gold), 0, roofY - 0.03, depth / 2 - 0.2);
  valance(depth - 0.3, -(BOX_WIDTH / 2 - 0.2), 0, true);
  valance(depth - 0.3, BOX_WIDTH / 2 - 0.2, 0, true);
  for (const sx of [-1, 1]) {
    const drape = add(new Mesh(new BoxGeometry(0.42, postHeight - 0.9, 0.1), red), sx * (BOX_WIDTH / 2 - 0.4), floorY + 0.75 + (postHeight - 0.9) / 2, depth / 2 - 0.3);
    drape.rotation.z = sx * 0.1;
    const tie = add(new Mesh(new BoxGeometry(0.34, 0.07, 0.13), gold), sx * (BOX_WIDTH / 2 - 0.36), floorY + 1.35, depth / 2 - 0.3);
    tie.rotation.z = sx * 0.1;
  }
  add(new Mesh(new PlaneGeometry(BOX_WIDTH - 0.3, postHeight), new MeshStandardMaterial({ color: 0x7a2420, roughness: 0.95, side: DoubleSide })), 0, floorY + postHeight / 2, -(depth / 2 - 0.2));

  // Thron
  const throne = new Group();
  const cushion = new MeshStandardMaterial({ color: RED, roughness: 0.8 });
  const part = (geo: BufferGeometry, material: Material, x: number, y: number, z: number): void => {
    const mesh = shadowed(new Mesh(geo, material));
    mesh.position.set(x, y, z);
    throne.add(mesh);
  };
  part(new BoxGeometry(0.9, 0.5, 0.8), gold, 0, 0.25, 0);
  part(new BoxGeometry(0.76, 0.14, 0.68), cushion, 0, 0.56, 0.02);
  part(new BoxGeometry(0.9, 1.5, 0.16), gold, 0, 0.95, -0.36);
  part(new BoxGeometry(0.68, 1.05, 0.06), cushion, 0, 1.08, -0.27);
  for (const sx of [-1, 1]) part(new BoxGeometry(0.13, 0.36, 0.72), gold, sx * 0.45, 0.72, 0);
  part(new SphereGeometry(0.11, 10, 8), gold, -0.4, 1.76, -0.36);
  part(new SphereGeometry(0.11, 10, 8), gold, 0.4, 1.76, -0.36);
  throne.scale.setScalar(1.3);
  throne.position.set(0, floorY + 0.05, -0.9);
  box.add(throne);

  // Mitte der Loge: Die Front steht ueber dem Umgang an der Podiumsmauer.
  place(box, BOX_ANGLE, ARENA_RADIUS + PODIUM_THICK + depth / 2 - 0.05, 0, true);
  arena.add(box);
}

// ---------------------------------------------------------------------------
// Waffenstaender auf dem Platz
// ---------------------------------------------------------------------------

function buildWeaponRack(large: boolean): Group {
  const rack = new Group();
  const wood = new MeshStandardMaterial({ color: WOOD, roughness: 0.85 });
  const steel = new MeshStandardMaterial({ color: STEEL, roughness: 0.35, metalness: 0.85 });
  const width = large ? 1.7 : 1.3;
  const height = large ? 1.25 : 1.0;
  const add = (mesh: Mesh, x: number, y: number, z: number, rx = 0, rz = 0): Mesh => {
    mesh.position.set(x, y, z);
    mesh.rotation.set(rx, 0, rz);
    shadowed(mesh);
    rack.add(mesh);
    return mesh;
  };
  // Zwei Boecke in A-Form, dazwischen zwei Holme
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      add(new Mesh(new BoxGeometry(0.1, height * 1.08, 0.1), wood), sx * (width / 2), height / 2, sz * 0.24, -sz * 0.36);
    }
  }
  add(new Mesh(new BoxGeometry(width + 0.2, 0.09, 0.09), wood), 0, height * 0.98, 0);
  add(new Mesh(new BoxGeometry(width + 0.1, 0.08, 0.08), wood), 0, height * 0.45, 0.14);

  // Speer
  add(new Mesh(new CylinderGeometry(0.03, 0.03, 2.1, 8), wood), -width * 0.3, 1.02, 0.22, -0.22);
  const tip = add(new Mesh(new ConeGeometry(0.07, 0.3, 8), steel), -width * 0.3, 2.15, -0.03, -0.22);
  tip.castShadow = true;
  // Schwert, Spitze nach unten
  add(new Mesh(new BoxGeometry(0.07, 0.95, 0.02), steel), 0, 0.62, 0.24, -0.2);
  add(new Mesh(new BoxGeometry(0.3, 0.05, 0.06), new MeshStandardMaterial({ color: GOLD, roughness: 0.5, metalness: 0.4 })), 0, 1.1, 0.14, -0.2);
  add(new Mesh(new CylinderGeometry(0.03, 0.03, 0.2, 8), wood), 0, 1.2, 0.12, -0.2);
  if (large) {
    // Rundschild lehnt vorn am Bock
    const shield = new Group();
    const face = shadowed(new Mesh(new CylinderGeometry(0.4, 0.4, 0.05, 24), new MeshStandardMaterial({ color: 0x8a5a36, roughness: 0.8 })));
    const rim = shadowed(new Mesh(new CylinderGeometry(0.44, 0.44, 0.035, 24), steel));
    rim.position.y = -0.01;
    const centre = new Mesh(new CylinderGeometry(0.2, 0.2, 0.06, 20), new MeshStandardMaterial({ color: RED, roughness: 0.8 }));
    centre.position.y = 0.01;
    const boss = new Mesh(new SphereGeometry(0.09, 12, 8), steel);
    boss.position.y = 0.04;
    boss.scale.y = 0.6;
    shield.add(rim, face, centre, boss);
    shield.position.set(width * 0.3, 0.5, 0.34);
    shield.rotation.x = Math.PI / 2 - 0.28;
    rack.add(shield);
  } else {
    // Axt
    add(new Mesh(new CylinderGeometry(0.03, 0.03, 1.1, 8), wood), width * 0.28, 0.6, 0.22, -0.2);
    add(new Mesh(new BoxGeometry(0.34, 0.26, 0.03), steel), width * 0.28 + 0.12, 1.02, 0.12, -0.2);
  }
  return rack;
}

// ---------------------------------------------------------------------------
// Publikum
// ---------------------------------------------------------------------------

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
const BODY_HEIGHT = 0.5;
const HEAD_ABOVE = 0.39;

function buildCrowd(arena: Group): Crowd {
  const rnd = seeded(1234);
  const seats: { x: number; z: number; y: number; angle: number }[] = [];
  for (let t = 0; t < TIERS; t++) {
    const radius = STAND_INNER + t * TIER_DEPTH + TIER_DEPTH * 0.55;
    const y = TIER_FIRST_Y + t * TIER_RISE;
    const count = Math.floor((Math.PI * 2 * radius) / SEAT_SPACING);
    // Die Loge reicht bis zur fuenften Stufe.
    const boxHalf = (BOX_WIDTH / 2 + 0.5) / radius;
    for (let i = 0; i < count; i++) {
      // Nicht jeder Platz ist besetzt, und niemand sitzt wie abgezaehlt.
      if (rnd() < 0.12) continue;
      const angle = ((i + (rnd() - 0.5) * 0.4) / count) * Math.PI * 2;
      if (AISLE_ANGLES.some((a) => angleBetween(a, angle) * radius < 0.65)) continue;
      if (t < 5 && angleBetween(BOX_ANGLE, angle) < boxHalf) continue;
      const r = radius + (rnd() - 0.5) * 0.2;
      seats.push({ x: Math.sin(angle) * r, z: Math.cos(angle) * r, y, angle });
    }
  }

  const n = seats.length;
  const bodies = new InstancedMesh(new BoxGeometry(0.38, BODY_HEIGHT, 0.26), new MeshLambertMaterial(), n);
  const heads = new InstancedMesh(new SphereGeometry(0.125, 8, 6), new MeshLambertMaterial(), n);
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

// ---------------------------------------------------------------------------

/** Baut das Amphitheater samt Licht in die Szene. */
export function buildArena(scene: Scene): ArenaScene {
  // Neutraler Hintergrund wie in der Vorlage, kein Dunst.
  scene.background = new Color(BACKDROP);
  scene.fog = null;

  const arena = new Group();
  buildBowl(arena);
  buildPodiumDetails(arena);
  const flags = buildGallery(arena);
  buildFacade(arena);
  buildRoyalBox(arena);

  // Waffenstaender: gross hinten links, klein vorn rechts - beide nah an der Mauer.
  const rackA = buildWeaponRack(true);
  place(rackA, Math.PI + (45 * Math.PI) / 180, ARENA_RADIUS * 0.9, 0, true);
  const rackB = buildWeaponRack(false);
  place(rackB, (64 * Math.PI) / 180, ARENA_RADIUS * 0.88, 0, true);
  arena.add(rackA, rackB);

  const crowd = buildCrowd(arena);
  arena.rotation.y = ARENA_TURN;
  scene.add(arena);

  // Boden ausserhalb: dieselbe helle Flaeche wie der Hintergrund, faengt den Schatten.
  const outside = new Mesh(new RingGeometry(ARENA_OUTER_RADIUS - 0.5, 140, 64), new ShadowMaterial({ opacity: 0.15 }));
  outside.rotation.x = -Math.PI / 2;
  outside.position.y = -0.01;
  outside.receiveShadow = true;
  scene.add(outside);

  // Licht: weiches Studiolicht, die Sonne steht vorn links ueber der Arena.
  scene.add(new HemisphereLight(0xffffff, 0xe8cfa8, 1.5));
  const sun = new DirectionalLight(0xfff1dc, 1.9);
  // Im Bezug zum Bauwerk: vorn links, wie in der Vorlage.
  sun.position.set(-13, 33, 21).applyAxisAngle(UP_AXIS, ARENA_TURN);
  sun.shadow.radius = 3;
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const reach = ARENA_OUTER_RADIUS + 5;
  sun.shadow.camera.left = -reach;
  sun.shadow.camera.right = reach;
  sun.shadow.camera.top = reach;
  sun.shadow.camera.bottom = -reach;
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 90;
  sun.shadow.bias = -0.0006;
  sun.shadow.normalBias = 0.03;
  scene.add(sun);

  let excitement = 0;
  const count = crowd.baseY.length;
  return {
    update(dtSeconds: number, clockMs: number): void {
      // Fahnen wehen leicht, jede in ihrem Takt.
      for (let i = 0; i < flags.cloths.length; i++) {
        flags.cloths[i].rotation.y = 0.18 * Math.sin(clockMs * 0.0021 + i * 1.7);
      }
      if (!crowd.bodies.visible) return;
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
    setCrowdVisible(visible: boolean): void {
      crowd.bodies.visible = visible;
      crowd.heads.visible = visible;
    },
  };
}
