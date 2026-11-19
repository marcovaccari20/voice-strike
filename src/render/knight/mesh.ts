// Das sichtbare Netz des Ritters nach Marcos Bildvorlage: eine weiche,
// rundliche Spielfigur wie aus Knete - grosser Topfhelm mit rotem Buerstenbusch,
// kupferne Schulterplatten, Wappenrock in der Farbe der Seite mit goldener
// Borte, Lederguertel, nackte Oberarme, helle Stulpenhandschuhe, Stahl an den
// Beinen, kurzes breites Schwert und runder Bretterschild.
//
// Das Netz kennt keine Haltungen. Es haengt nur an den Knochen aus skeleton.ts:
//   - Fast alles liegt in drei Sammelnetzen (Metall, Mattes, Stoff), die als
//     SkinnedMesh an das Skelett gebunden sind. Starre Teile haengen dabei an
//     genau einem Knochen; Rumpf, Guertel, Wappenrock und Helmbusch verteilen
//     sich weich auf mehrere und biegen sich deshalb ohne Knick.
//   - Schwert und Schild sind eigene Netze an ihren Knochen, damit sie sich
//     ein- und ausblenden lassen.
// Je Ritter entstehen so rund ein Dutzend Zeichenaufrufe; je Bild rechnet das
// Netz nichts.
//
// Die Szene hat Sonne und Himmelslicht, aber keine Umgebungskarte. Echtes
// Metall bliebe darin fast schwarz - deshalb ist "Metall" hier eine helle
// Grundfarbe mit wenig Metallanteil und weichem Glanzlicht.

import {
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  CatmullRomCurve3,
  Color,
  ConeGeometry,
  Euler,
  ExtrudeGeometry,
  Matrix3,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  Quaternion,
  Shape,
  Skeleton,
  SkinnedMesh,
  SphereGeometry,
  SRGBColorSpace,
  TorusGeometry,
  TubeGeometry,
  Vector3,
  type Bone,
  type Object3D,
} from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { BODY } from './proportions';
import { BONE_NAMES, type BoneName, type KnightSkeleton } from './skeleton';
import type { KnightLook, KnightMeshBuilder } from './types';

const TAU = Math.PI * 2;

// ---------------------------------------------------------------------------
// Farben (sRGB) - abgenommen von der Bildvorlage
// ---------------------------------------------------------------------------

const TONE = {
  /** Helm: Zinn mit warmem Stich. */
  helm: 0xd6bca4,
  /** Beinzeug: etwas kuehlerer Stahl. */
  steel: 0xb9aca4,
  /** Eisenschuhe: Stahl mit Bronzestich. */
  sabaton: 0xbd9c88,
  /** Kragen und Schulterplatten. */
  copper: 0xd69a78,
  skin: 0xdd9058,
  glove: 0xf2bd90,
  /** Waffenrock unter dem Wappenrock. */
  tunic: 0xa8623f,
  thigh: 0xb9703f,
  leather: 0x8c5433,
  buckle: 0xa9693f,
  blade: 0xcdbbb0,
  guard: 0x9c6541,
  rim: 0xa9a3a0,
  /** Inneres des Helms. */
  dark: 0x2b1a12,
} as const;

interface Palette {
  helm: Color;
  steel: Color;
  sabaton: Color;
  copper: Color;
  skin: Color;
  glove: Color;
  tunic: Color;
  thigh: Color;
  leather: Color;
  buckle: Color;
  blade: Color;
  guard: Color;
  rim: Color;
  dark: Color;
  white: Color;
  team: Color;
  plume: Color;
}

function palette(look: KnightLook): Palette {
  return {
    helm: new Color(TONE.helm),
    steel: new Color(TONE.steel),
    sabaton: new Color(TONE.sabaton),
    copper: new Color(TONE.copper),
    skin: new Color(TONE.skin),
    glove: new Color(TONE.glove),
    tunic: new Color(TONE.tunic),
    thigh: new Color(TONE.thigh),
    leather: new Color(TONE.leather),
    buckle: new Color(TONE.buckle),
    blade: new Color(TONE.blade),
    guard: new Color(TONE.guard),
    rim: new Color(TONE.rim),
    dark: new Color(TONE.dark),
    white: new Color(0xffffff),
    team: new Color(look.tabard),
    plume: new Color(look.plume),
  };
}

const MIXED = new Color();

/** Mischfarbe; gilt nur bis zum naechsten Aufruf. */
function mix(a: Color, b: Color, t: number): Color {
  return MIXED.copy(a).lerp(b, clamp01(t));
}

/** Farbe heller (> 1) oder dunkler (< 1). */
function shade(color: Color, factor: number): Color {
  return color.clone().multiplyScalar(factor);
}

// ---------------------------------------------------------------------------
// Kleine Rechenhilfen
// ---------------------------------------------------------------------------

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function smoothstep(from: number, to: number, v: number): number {
  const t = clamp01((v - from) / (to - from));
  return t * t * (3 - 2 * t);
}

/** Potenz mit Vorzeichen - fuer Superellipsen. */
function spow(v: number, e: number): number {
  return Math.sign(v) * Math.abs(v) ** e;
}

/** Zufallszahlen mit festem Anfang: Jeder Ritter sieht gleich aus. */
function randomSource(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Keys = readonly (readonly [number, number])[];

/** Weiche Kurve durch Stuetzpunkte [stelle, wert]; ausserhalb bleibt der Randwert. */
function curve(keys: Keys): (t: number) => number {
  const slope = (i: number): number => {
    const a = keys[Math.max(0, i - 1)];
    const b = keys[Math.min(keys.length - 1, i + 1)];
    return (b[1] - a[1]) / (b[0] - a[0]);
  };
  return (t) => {
    const last = keys.length - 1;
    if (t <= keys[0][0]) return keys[0][1];
    if (t >= keys[last][0]) return keys[last][1];
    let i = 0;
    while (t > keys[i + 1][0]) i++;
    const [t0, v0] = keys[i];
    const [t1, v1] = keys[i + 1];
    const h = t1 - t0;
    const u = (t - t0) / h;
    const u2 = u * u;
    const u3 = u2 * u;
    return (
      (2 * u3 - 3 * u2 + 1) * v0 + (u3 - 2 * u2 + u) * h * slope(i) + (-2 * u3 + 3 * u2) * v1 + (u3 - u2) * h * slope(i + 1)
    );
  };
}

/** Lage eines Teils im Raum seines Knochens. */
function put(
  x = 0,
  y = 0,
  z = 0,
  scale: readonly [number, number, number] = [1, 1, 1],
  turn: readonly [number, number, number] = [0, 0, 0],
): Matrix4 {
  return new Matrix4().compose(
    new Vector3(x, y, z),
    new Quaternion().setFromEuler(new Euler(turn[0], turn[1], turn[2])),
    new Vector3(scale[0], scale[1], scale[2]),
  );
}

// ---------------------------------------------------------------------------
// Flaechen
// ---------------------------------------------------------------------------

type PointFn = (col: number, row: number, out: Vector3) => void;

interface SurfaceOptions {
  /** Die Flaeche schliesst sich entlang der Spalten (Rotationskoerper). */
  wrap?: boolean;
  /** Felder, die offen bleiben. */
  hole?: (col: number, row: number) => boolean;
  /** Je Zeile: wie scharf die Naht bleibt (0 = glatt, 1 = Kante). Nur mit `wrap`. */
  crease?: (row: number) => number;
}

/**
 * Gitterflaeche aus `cols` x `rows` Feldern. Die sichtbare Seite ist die, von
 * der aus die Spalten nach rechts und die Zeilen nach oben laufen. Bei einem
 * Rotationskoerper (Winkel waechst von +Z nach +X) heisst das: Profil von
 * unten nach oben abschreiten, die Achse links - dann zeigt die Flaeche nach
 * aussen.
 */
function surface(cols: number, rows: number, point: PointFn, options: SurfaceOptions = {}): BufferGeometry {
  const stride = cols + 1;
  const count = stride * (rows + 1);
  const position = new Float32Array(count * 3);
  const uv = new Float32Array(count * 2);
  const p = new Vector3();
  for (let row = 0; row <= rows; row++) {
    for (let col = 0; col <= cols; col++) {
      const i = row * stride + col;
      point(options.wrap && col === cols ? 0 : col, row, p);
      position[i * 3] = p.x;
      position[i * 3 + 1] = p.y;
      position[i * 3 + 2] = p.z;
      uv[i * 2] = col / cols;
      uv[i * 2 + 1] = row / rows;
    }
  }
  const index: number[] = [];
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      if (options.hole?.(col, row)) continue;
      const a = row * stride + col;
      const d = a + stride;
      index.push(a, a + 1, d + 1, a, d + 1, d);
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(position, 3));
  geometry.setAttribute('uv', new BufferAttribute(uv, 2));
  geometry.setIndex(index);
  geometry.computeVertexNormals();

  const normal = geometry.getAttribute('normal');
  const a = new Vector3();
  const b = new Vector3();
  if (options.wrap) {
    // Naht: erste und letzte Spalte liegen aufeinander - Normalen angleichen.
    for (let row = 0; row <= rows; row++) {
      const sharp = clamp01(options.crease?.(row) ?? 0);
      if (sharp >= 1) continue;
      const i0 = row * stride;
      const i1 = i0 + cols;
      a.fromBufferAttribute(normal, i0);
      b.fromBufferAttribute(normal, i1);
      p.addVectors(a, b).normalize();
      a.lerp(p, 1 - sharp).normalize();
      b.lerp(p, 1 - sharp).normalize();
      normal.setXYZ(i0, a.x, a.y, a.z);
      normal.setXYZ(i1, b.x, b.y, b.z);
    }
  }
  // Pole: Faellt eine Randzeile auf einen Punkt zusammen, bekommt sie eine Normale.
  for (const row of [0, rows]) {
    const i0 = row * stride;
    a.fromArray(position, i0 * 3);
    b.fromArray(position, (i0 + (cols >> 1)) * 3);
    if (a.distanceToSquared(b) > 1e-12) continue;
    p.set(0, 0, 0);
    for (let col = 0; col <= cols; col++) p.add(a.fromBufferAttribute(normal, i0 + col));
    p.normalize();
    for (let col = 0; col <= cols; col++) normal.setXYZ(i0 + col, p.x, p.y, p.z);
  }
  return geometry;
}

/** Profil eines Rotationskoerpers: Punkte [Radius, Hoehe], von unten nach oben. */
type Profile = readonly (readonly [number, number])[];

/** Rundet ein grobes Profil: weiche Kurve durch die Punkte. */
function rounded(profile: Profile, samples: number): Profile {
  const path = new CatmullRomCurve3(
    profile.map(([r, y]) => new Vector3(r, y, 0)),
    false,
    'centripetal',
  );
  return path.getPoints(samples).map((q) => [Math.max(0, q.x), q.y] as const);
}

/** Rotationskoerper um die Y-Achse. `warp` darf jeden Punkt noch verschieben. */
function revolve(profile: Profile, segments: number, warp?: (angle: number, row: number, p: Vector3) => void): BufferGeometry {
  return surface(
    segments,
    profile.length - 1,
    (col, row, out) => {
      const angle = (col / segments) * TAU;
      const [r, y] = profile[row];
      out.set(Math.sin(angle) * r, y, Math.cos(angle) * r);
      warp?.(angle, row, out);
    },
    { wrap: true },
  );
}

function ball(radius: number, around = 20, up = 14): BufferGeometry {
  return new SphereGeometry(radius, around, up);
}

/** Kissenform zwischen Kugel (`e` = 1) und Quader (`e` gegen 0). */
function pillow(rx: number, ry: number, rz: number, e: number, around = 24, up = 14): BufferGeometry {
  return surface(
    around,
    up,
    (col, row, out) => {
      const lat = (row / up - 0.5) * Math.PI;
      const angle = (col / around) * TAU;
      const ring = spow(Math.cos(lat), e);
      out.set(rx * ring * spow(Math.sin(angle), e), ry * spow(Math.sin(lat), e), rz * ring * spow(Math.cos(angle), e));
    },
    { wrap: true },
  );
}

/** Wulst entlang einer geschlossenen Linie. */
function roll(points: Vector3[], radius: number, along: number, around = 8): BufferGeometry {
  return new TubeGeometry(new CatmullRomCurve3(points, true, 'centripetal'), along, radius, around, true);
}

/** Dreht eine Flaeche um: Rueckseite wird Vorderseite. */
function reversed(geometry: BufferGeometry): BufferGeometry {
  const index = geometry.getIndex();
  if (index) {
    for (let i = 0; i < index.count; i += 3) {
      const b = index.getX(i + 1);
      index.setX(i + 1, index.getX(i + 2));
      index.setX(i + 2, b);
    }
  }
  const normal = geometry.getAttribute('normal');
  for (let i = 0; i < normal.count; i++) normal.setXYZ(i, -normal.getX(i), -normal.getY(i), -normal.getZ(i));
  return geometry;
}

/** Legt die Textur einer Flaeche auf einen Ausschnitt [u0..u1] x [v0..v1]. */
function mapped(geometry: BufferGeometry, u0: number, v0: number, u1: number, v1: number): BufferGeometry {
  const uv = geometry.getAttribute('uv');
  for (let i = 0; i < uv.count; i++) uv.setXY(i, lerp(u0, u1, uv.getX(i)), lerp(v0, v1, uv.getY(i)));
  return geometry;
}

/** Drueckt alles unterhalb von `floor` platt (Sohle, Unterseite). */
function flattened(geometry: BufferGeometry, floor: number): BufferGeometry {
  const position = geometry.getAttribute('position');
  const normal = geometry.getAttribute('normal');
  for (let i = 0; i < position.count; i++) {
    if (position.getY(i) >= floor) continue;
    position.setY(i, floor);
    normal.setXYZ(i, 0, -1, 0);
  }
  return geometry;
}

// ---------------------------------------------------------------------------
// Sammelnetze
// ---------------------------------------------------------------------------

/** Welche Knochen einen Punkt halten (hoechstens vier). */
class Influence {
  readonly bone = [0, 0, 0, 0];
  readonly weight = [0, 0, 0, 0];
  private used = 0;

  clear(): void {
    this.used = 0;
    this.bone.fill(0);
    this.weight.fill(0);
  }

  add(bone: number, weight: number): void {
    if (weight <= 1e-4 || this.used >= 4) return;
    this.bone[this.used] = bone;
    this.weight[this.used] = weight;
    this.used++;
  }

  scale(factor: number): void {
    for (let i = 0; i < this.used; i++) this.weight[i] *= factor;
  }

  /** Gewichte auf Summe 1 bringen. */
  settle(): void {
    const sum = this.weight[0] + this.weight[1] + this.weight[2] + this.weight[3];
    if (sum <= 0) {
      this.weight[0] = 1;
      return;
    }
    for (let i = 0; i < 4; i++) this.weight[i] /= sum;
  }
}

/** Verteilt einen Punkt (Ruhelage, Raum der Figur) auf Knochen. */
type Skinner = (x: number, y: number, z: number, out: Influence) => void;
/** Feste Farbe oder Farbe je Punkt (Koordinaten im Raum des Knochens). */
type Paint = Color | ((x: number, y: number, z: number) => Color);

/** Ruhelage des Skeletts: Knochen-Nummern und wo die Knochen stehen. */
class Rig {
  readonly bones: Bone[] = [];
  private readonly slot = new Map<BoneName, number>();
  private readonly resting = new Map<BoneName, Matrix4>();

  constructor(skeleton: KnightSkeleton) {
    skeleton.root.updateMatrixWorld(true);
    const toBody = new Matrix4().copy(skeleton.body.matrixWorld).invert();
    BONE_NAMES.forEach((name, i) => {
      const bone = skeleton.bones[name];
      this.bones.push(bone);
      this.slot.set(name, i);
      this.resting.set(name, new Matrix4().multiplyMatrices(toBody, bone.matrixWorld));
    });
  }

  index(name: BoneName): number {
    return this.slot.get(name) ?? 0;
  }

  /** Lage des Knochens im Raum der Figur. */
  rest(name: BoneName): Matrix4 {
    return this.resting.get(name) ?? new Matrix4();
  }

  /** Hoehe des Knochens in der Ruhelage. */
  height(name: BoneName): number {
    return this.rest(name).elements[13];
  }
}

const NO_PLACE = new Matrix4();

/** Sammelt Flaechen eines Materials; am Ende wird daraus EIN Netz. */
class Batch {
  private readonly position: number[] = [];
  private readonly normal: number[] = [];
  private readonly uv: number[] = [];
  private readonly color: number[] = [];
  private readonly skinIndex: number[] = [];
  private readonly skinWeight: number[] = [];
  private readonly index: number[] = [];
  private readonly full = new Matrix4();
  private readonly normalMatrix = new Matrix3();
  private readonly p = new Vector3();
  private readonly n = new Vector3();
  private readonly influence = new Influence();
  private readonly rig: Rig | null;

  /** Mit `rig` entsteht ein an die Knochen gebundenes Netz, ohne ein starres. */
  constructor(rig: Rig | null = null) {
    this.rig = rig;
  }

  /** Starres Teil an einem Knochen; `place` setzt es in dessen Raum. */
  rigid(geometry: BufferGeometry, bone: BoneName, paint: Paint, place: Matrix4 = NO_PLACE): void {
    if (!this.rig) throw new Error('Batch.rigid: Dieses Sammelnetz hat kein Skelett.');
    const slot = this.rig.index(bone);
    this.append(geometry, place, this.rig.rest(bone), paint, (_x, _y, _z, out) => out.add(slot, 1), null);
  }

  /** Weiches Teil: `place` setzt es in den Raum der Figur, `skin` verteilt es auf Knochen. */
  soft(geometry: BufferGeometry, skin: Skinner, paint: Paint, place: Matrix4 = NO_PLACE): void {
    this.append(geometry, place, null, paint, skin, null);
  }

  /** Teil eines starren Einzelnetzes. `flatUv` legt alle Punkte auf eine Stelle der Textur. */
  plain(geometry: BufferGeometry, paint: Paint, place: Matrix4 = NO_PLACE, flatUv: readonly [number, number] | null = null): void {
    this.append(geometry, place, null, paint, null, flatUv);
  }

  private append(
    geometry: BufferGeometry,
    place: Matrix4,
    rest: Matrix4 | null,
    paint: Paint,
    skin: Skinner | null,
    flatUv: readonly [number, number] | null,
  ): void {
    const position = geometry.getAttribute('position');
    const normal = geometry.getAttribute('normal');
    const uv = geometry.getAttribute('uv');
    const base = this.position.length / 3;
    if (rest) this.full.multiplyMatrices(rest, place);
    else this.full.copy(place);
    this.normalMatrix.getNormalMatrix(this.full);
    const { p, n } = this;

    for (let i = 0; i < position.count; i++) {
      p.fromBufferAttribute(position, i).applyMatrix4(place);
      const c = typeof paint === 'function' ? paint(p.x, p.y, p.z) : paint;
      this.color.push(c.r, c.g, c.b);
      if (rest) p.applyMatrix4(rest);
      this.position.push(p.x, p.y, p.z);
      n.fromBufferAttribute(normal, i).applyMatrix3(this.normalMatrix).normalize();
      this.normal.push(n.x, n.y, n.z);
      if (flatUv) this.uv.push(flatUv[0], flatUv[1]);
      else if (uv) this.uv.push(uv.getX(i), uv.getY(i));
      else this.uv.push(0, 0);
      if (skin) {
        this.influence.clear();
        skin(p.x, p.y, p.z, this.influence);
        this.influence.settle();
        this.skinIndex.push(...this.influence.bone);
        this.skinWeight.push(...this.influence.weight);
      }
    }

    // Eine Spiegelung dreht den Umlaufsinn um - Dreiecke zurueckdrehen.
    const mirrored = this.full.determinant() < 0;
    const index = geometry.getIndex();
    const corners = index ? index.count : position.count;
    for (let i = 0; i < corners; i += 3) {
      const a = base + (index ? index.getX(i) : i);
      const b = base + (index ? index.getX(i + 1) : i + 1);
      const c = base + (index ? index.getX(i + 2) : i + 2);
      if (mirrored) this.index.push(a, c, b);
      else this.index.push(a, b, c);
    }
  }

  private geometry(): BufferGeometry {
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(new Float32Array(this.position), 3));
    geometry.setAttribute('normal', new BufferAttribute(new Float32Array(this.normal), 3));
    geometry.setAttribute('uv', new BufferAttribute(new Float32Array(this.uv), 2));
    geometry.setAttribute('color', new BufferAttribute(new Float32Array(this.color), 3));
    geometry.setIndex(this.index);
    return geometry;
  }

  /** Starres Netz (Schwert, Schild). */
  mesh(material: MeshStandardMaterial): Mesh {
    const mesh = new Mesh(this.geometry(), material);
    mesh.castShadow = true;
    return mesh;
  }

  /** An die Knochen gebundenes Netz; die Punkte liegen in der Ruhelage der Figur. */
  skinned(material: MeshStandardMaterial): SkinnedMesh {
    const geometry = this.geometry();
    geometry.setAttribute('skinIndex', new BufferAttribute(new Uint16Array(this.skinIndex), 4));
    geometry.setAttribute('skinWeight', new BufferAttribute(new Float32Array(this.skinWeight), 4));
    const mesh = new SkinnedMesh(geometry, material);
    mesh.castShadow = true;
    // Die Huelle gilt nur fuer die Ruhelage - nie wegschneiden.
    mesh.frustumCulled = false;
    return mesh;
  }
}

/** Alles, was die Bauteile brauchen. */
interface Kit {
  rig: Rig;
  tone: Palette;
  /** Stahl und Kupfer. */
  metal: Batch;
  /** Haut, Leder, Stoff ohne Muster, Helmbusch. */
  matte: Batch;
  /** Wappenrock mit Borte (Textur). */
  cloth: Batch;
}

// ---------------------------------------------------------------------------
// Texturen
// ---------------------------------------------------------------------------

function css(color: number): string {
  return `#${new Color(color).getHexString()}`;
}

function roundedRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function canvasTexture(width: number, height: number, draw: (ctx: CanvasRenderingContext2D) => void): CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Ritter-Netz: kein 2D-Kontext fuer die Textur.');
  draw(ctx);
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

/** Breite der Borte in Bildpunkten: Brust seitlich / oben, Bahn seitlich / unten. */
const TRIM_PX = { chestSide: 18, chestTop: 30, panelSide: 21, panelEnd: 24 } as const;

/**
 * Wappenrock: obere Haelfte = Brust (Borte links, rechts, oben am Halsausschnitt),
 * untere Haelfte = haengende Bahn (Borte links, rechts, unten). Die Naht
 * dazwischen liegt unter dem Guertel.
 */
function tabardTexture(look: KnightLook): CanvasTexture {
  const w = 256;
  const half = 256;
  return canvasTexture(w, half * 2, (ctx) => {
    const field = (x: number, y: number, width: number, height: number): void => {
      roundedRect(ctx, x, y, width, height, 12);
      ctx.fillStyle = css(look.tabard);
      ctx.fill();
      // Schmale dunkle Fuge zwischen Borte und Tuch.
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = 'rgba(40, 20, 0, 0.32)';
      ctx.stroke();
    };
    ctx.fillStyle = css(look.trim);
    ctx.fillRect(0, 0, w, half * 2);
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, w, half);
    ctx.clip();
    field(TRIM_PX.chestSide, TRIM_PX.chestTop, w - TRIM_PX.chestSide * 2, half);
    ctx.restore();
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, half, w, half);
    ctx.clip();
    field(TRIM_PX.panelSide, half - 40, w - TRIM_PX.panelSide * 2, half + 40 - TRIM_PX.panelEnd);
    ctx.restore();
  });
}

/** Stelle der Schildtextur, die weiss bleibt: dort sitzen einfarbige Teile. */
const WOOD_BLANK: readonly [number, number] = [0.04, 0.04];

/** Schildbretter: senkrecht, mit Maserung und dunklen Fugen. Die Ecken bleiben weiss. */
function woodTexture(): CanvasTexture {
  const size = 512;
  return canvasTexture(size, size, (ctx) => {
    const random = randomSource(7);
    const planks = [0, 0.17, 0.38, 0.6, 0.81, 1];
    const tones = ['#bd8350', '#b0774a', '#c28a55', '#b47b4b', '#ba8150'];
    for (let i = 0; i < planks.length - 1; i++) {
      const x0 = planks[i] * size;
      const x1 = planks[i + 1] * size;
      ctx.fillStyle = tones[i];
      ctx.fillRect(x0, 0, x1 - x0, size);
      // Maserung: leicht geschwungene Laengslinien.
      for (let k = 0; k < 9; k++) {
        const x = x0 + (x1 - x0) * (0.08 + 0.84 * random());
        const sway = 3 + random() * 7;
        const phase = random() * TAU;
        ctx.beginPath();
        for (let y = 0; y <= size; y += 16) {
          const dx = Math.sin(phase + (y / size) * (2 + random() * 0.4) * Math.PI) * sway;
          if (y === 0) ctx.moveTo(x + dx, y);
          else ctx.lineTo(x + dx, y);
        }
        ctx.lineWidth = 1 + random() * 1.6;
        ctx.strokeStyle = random() < 0.3 ? 'rgba(255, 214, 160, 0.16)' : 'rgba(96, 52, 22, 0.2)';
        ctx.stroke();
      }
    }
    // Fugen zwischen den Brettern, leicht schief wie von Hand gesaegt.
    for (let i = 1; i < planks.length - 1; i++) {
      const x = planks[i] * size;
      const lean = (random() - 0.5) * 14;
      ctx.beginPath();
      ctx.moveTo(x - lean, 0);
      ctx.lineTo(x + lean, size);
      ctx.lineWidth = 5;
      ctx.strokeStyle = '#74492a';
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(x - lean + 4, 0);
      ctx.lineTo(x + lean + 4, size);
      ctx.lineWidth = 2;
      ctx.strokeStyle = 'rgba(255, 220, 170, 0.28)';
      ctx.stroke();
    }
    ctx.fillStyle = '#ffffff';
    const corner = 54;
    for (const [x, y] of [[0, 0], [size - corner, 0], [0, size - corner], [size - corner, size - corner]]) {
      ctx.fillRect(x, y, corner, corner);
    }
  });
}

// ---------------------------------------------------------------------------
// Helm
// ---------------------------------------------------------------------------

const HELM = {
  /** Halbe Breite und Tiefe der Helmglocke an der dicksten Stelle. */
  rx: 0.204,
  rz: 0.2,
  /** Die Glocke sitzt eine Spur vor der Halsachse. */
  z: 0.008,
  /** Hoehe, ab der sich die Glocke zur Kuppel schliesst, und Hoehe der Kuppel. */
  shoulder: 0.335,
  dome: 0.185,
  /** So dick traegt das Visier auf der Glocke auf. */
  visorLift: 0.021,
  /** Winkel der Visierwangen gegen die Stirnseite und wie tief sie einschneiden. */
  cheek: 0.47,
  cheekCut: 0.955,
  /** Sehschlitz: Unter- und Oberkante, halbe Breite in Spalten. */
  slitLow: 0.245,
  slitHigh: 0.292,
  slitCols: 9,
  slitDepth: 0.032,
  cols: 64,
} as const;

/** Verjuengung der Glocke zum unteren Rand hin. */
function helmTaper(y: number): number {
  return y >= 0.18 ? 1 : 1 - 0.085 * ((0.18 - y) / 0.18) ** 2;
}

function skullScale(y: number): number {
  if (y <= HELM.shoulder) return helmTaper(y);
  return Math.sqrt(Math.max(0, 1 - ((y - HELM.shoulder) / HELM.dome) ** 2));
}

function visorScale(y: number): number {
  if (y <= HELM.shoulder) return helmTaper(y);
  return 1 - 0.13 * ((y - HELM.shoulder) / 0.127) ** 2;
}

/** Oberkante des Visiers: ein Giebel, in der Mitte am hoechsten. */
function visorEdge(angle: number): number {
  const a = Math.abs(angle);
  return a < 1.4 ? 0.462 - 0.102 * (a / 1.4) ** 1.05 : 0.36;
}

/** Radius der runden Glocke unter dem Winkel `angle` (0 = vorn). */
function skullRadius(angle: number): number {
  return 1 / Math.hypot(Math.sin(angle) / HELM.rx, Math.cos(angle) / HELM.rz);
}

/**
 * Radius des Helms mit Visier: hinten rund, vorn zwei flache Wangen, die sich
 * im Mittelgrat treffen. Hinter den Schlaefen laeuft das Visier in die Glocke aus.
 */
function visorRadius(angle: number, y: number): number {
  const a = Math.abs(angle);
  const round = skullRadius(angle);
  const flat = (HELM.cheekCut * skullRadius(HELM.cheek)) / Math.cos(Math.min(1.45, Math.abs(a - HELM.cheek)));
  const front = a < HELM.cheek + 1.45 ? (round ** -12 + flat ** -12) ** (-1 / 12) : round;
  const visor = 1 - smoothstep(1.62, 1.76, a);
  return lerp(round * skullScale(y), (front + HELM.visorLift) * visorScale(y), visor);
}

type HelmRow = (angle: number, out: { r: number; y: number }) => void;

/** Zeilen der Helmflaeche von der Unterseite bis zum Scheitel. */
function helmRows(): { rows: HelmRow[]; slit: number; edge: number } {
  const rows: HelmRow[] = [];
  // Das Kinn des Visiers haengt vorn etwas tiefer.
  const chin = (angle: number, y: number): number => y - 0.022 * Math.max(0, Math.cos(angle)) ** 2 * (1 - smoothstep(0, 0.11, y));
  const body = (y: number, bulge = 0): void => {
    rows.push((angle, out) => {
      out.r = visorRadius(angle, y) + bulge;
      out.y = chin(angle, y);
    });
  };
  // Unterseite: geschlossen, damit niemand in den Helm schaut.
  rows.push((_angle, out) => {
    out.r = 0;
    out.y = 0.03;
  });
  rows.push((angle, out) => {
    out.r = visorRadius(angle, 0) * 0.72;
    out.y = chin(angle, 0.012);
  });
  // Gerollter Rand.
  body(0, -0.004);
  body(0.008, 0.005);
  body(0.024, 0.006);
  body(0.036, 0.001);
  for (const y of [0.07, 0.11, 0.15, 0.19, 0.222]) body(y);
  const slit = rows.length;
  body(HELM.slitLow);
  body(HELM.slitHigh);
  body(0.312);
  body(HELM.shoulder);
  // Bis zur Giebelkante des Visiers.
  for (const t of [0.3, 0.6, 0.86]) {
    rows.push((angle, out) => {
      out.y = lerp(HELM.shoulder, visorEdge(angle) - 0.007, t);
      out.r = visorRadius(angle, out.y);
    });
  }
  // Giebelkante: dieselbe Zeile zweimal - so bleibt sie eine Kante statt
  // einer weichen Woelbung. Dahinter das "Dach" hinueber zur Kuppel.
  const brim: HelmRow = (angle, out) => {
    out.y = visorEdge(angle) - 0.005;
    out.r = visorRadius(angle, out.y);
  };
  rows.push(brim, brim);
  const edge = rows.length;
  rows.push((angle, out) => {
    out.y = visorEdge(angle) + 0.003;
    out.r = lerp(skullRadius(angle) * skullScale(out.y), visorRadius(angle, out.y), 0.72);
  });
  for (const t of [0, 0.14, 0.28, 0.42, 0.56, 0.7, 0.82, 0.92, 1]) {
    rows.push((angle, out) => {
      out.y = lerp(visorEdge(angle) + 0.011, HELM.shoulder + HELM.dome, t);
      out.r = skullRadius(angle) * skullScale(out.y);
    });
  }
  return { rows, slit, edge };
}

function addHelmet(kit: Kit): void {
  const { metal, matte, tone } = kit;
  const { rows, slit, edge } = helmRows();
  const cols = HELM.cols;
  const ring = { r: 0, y: 0 };
  /** Winkel einer Spalte, -PI..PI, 0 = Mittelgrat. */
  const angleOf = (col: number): number => {
    const a = (col / cols) * TAU;
    return a > Math.PI ? a - TAU : a;
  };
  const helmPoint = (col: number, row: number, out: Vector3, inset = 0): void => {
    const angle = angleOf(col);
    rows[row](angle, ring);
    const r = Math.max(0, ring.r - inset);
    out.set(Math.sin(angle) * r, ring.y, Math.cos(angle) * r + HELM.z);
  };
  const inSlit = (col: number): boolean => col < HELM.slitCols || col >= cols - HELM.slitCols;

  const shell = surface(cols, rows.length - 1, helmPoint, {
    wrap: true,
    hole: (col, row) => row === slit && inSlit(col),
    // Der Mittelgrat bleibt am Visier eine Kante, die Kuppel ist glatt.
    crease: (row) => (row <= edge ? 1 : 0),
  });
  // Die zwei Haelften fangen das Licht verschieden; unten etwas dunkler.
  metal.rigid(shell, 'Head', (_x, y) => mix(tone.helm, tone.dark, y < 0.02 ? 0.5 : 0.06 * (1 - smoothstep(0.02, 0.2, y))));

  // Laibung des Sehschlitzes: aussen Stahl, nach innen dunkel. Matt, damit
  // die ebenen Flaechen nicht als Ganzes aufblitzen.
  const span = HELM.slitCols * 2;
  const slitCol = (i: number): number => (i - HELM.slitCols + cols) % cols;
  const edgeTone = shade(tone.helm, 0.62);
  const lining = (x: number, _y: number, z: number): Color => {
    const edgeR = visorRadius(Math.atan2(x, z - HELM.z), HELM.slitLow);
    return mix(tone.dark, edgeTone, smoothstep(edgeR - HELM.slitDepth, edgeR - 0.002, Math.hypot(x, z - HELM.z)));
  };
  const sill = surface(span, 1, (col, row, out) => helmPoint(slitCol(col), slit, out, row * HELM.slitDepth));
  const lintel = surface(span, 1, (col, row, out) => helmPoint(slitCol(col), slit + 1, out, (1 - row) * HELM.slitDepth));
  const jambLeft = surface(1, 1, (col, row, out) => helmPoint(slitCol(span), slit + col, out, row * HELM.slitDepth));
  const jambRight = surface(1, 1, (col, row, out) => helmPoint(slitCol(0), slit + col, out, (1 - row) * HELM.slitDepth));
  for (const part of [sill, lintel, jambLeft, jambRight]) matte.rigid(part, 'Head', lining);

  // Gesicht: fuellt den Helm aus. Durch den Schlitz sieht man ein Band Haut,
  // oben im Schatten der Stirn, zu den Seiten hin dunkel.
  const faceShadow = shade(tone.skin, 0.2);
  matte.rigid(pillow(0.19, 0.2, 0.19, 1, 16, 10), 'Head', faceShadow, put(0, 0.27, HELM.z - 0.006));
  const faceR = 0.193;
  const band = surface(14, 10, (col, row, out) => {
    const angle = lerp(-1.25, 1.25, col / 14);
    out.set(Math.sin(angle) * faceR, lerp(0.21, 0.33, row / 10), Math.cos(angle) * faceR + HELM.z - 0.006);
  });
  matte.rigid(band, 'Head', (x, y) => {
    const lit = (1 - smoothstep(0.25, 0.266, y)) * smoothstep(0.212, 0.23, y) * (1 - smoothstep(0.07, 0.16, Math.abs(x)));
    return mix(faceShadow, tone.skin, lit * 0.82);
  });

  // Kamm: flacher Wulst von der Visierspitze ueber die Kuppel zum Buschhalter.
  // Die Linie liegt knapp unter der Kuppel, nur ihre Kappe schaut heraus.
  const crest: Vector3[] = [];
  const top = HELM.shoulder + HELM.dome;
  for (let i = 0; i <= 8; i++) {
    const y = lerp(top - 0.115, top - 0.008, i / 8);
    const scale = skullScale(y);
    // Zur Kuppelmitte hin sinkt die Linie entlang der Flaechennormalen ein.
    const sink = 0.0075;
    crest.push(new Vector3(0, y - sink * Math.sqrt(1 - scale * scale), HELM.z + (HELM.rz - sink) * scale));
  }
  const comb = new TubeGeometry(new CatmullRomCurve3(crest), 14, 0.013, 8, false);
  metal.rigid(comb, 'Head', tone.helm, put(0, 0, 0, [1.7, 1, 1]));

  // Schlaefenbolzen: Scheibe mit Knopf, Drehpunkt des Visiers.
  for (const sx of [1, -1]) {
    const x = sx * (visorRadius(Math.PI / 2, 0.268) - 0.004);
    metal.rigid(pillow(0.014, 0.034, 0.034, 1, 18, 10), 'Head', tone.helm, put(x, 0.268, HELM.z));
    metal.rigid(ball(0.016, 14, 10), 'Head', shade(tone.helm, 1.06), put(x + sx * 0.012, 0.268, HELM.z));
  }

  // Buschhalter: kurze Tuelle mit Bund auf dem Scheitel.
  const socket = rounded(
    [
      [0.052, 0.49],
      [0.055, 0.5],
      [0.046, 0.51],
      [0.038, 0.518],
      [0.037, 0.538],
      [0.044, 0.543],
      [0.045, 0.553],
      [0.04, 0.559],
      [0.032, 0.557],
      [0.031, 0.537],
    ],
    18,
  );
  metal.rigid(revolve(socket, 18), 'Head', tone.helm, put(0, 0, -0.01));
}

// ---------------------------------------------------------------------------
// Helmbusch
// ---------------------------------------------------------------------------

/** Verteilt den Busch nach der Hoehe auf seine drei federnden Glieder. */
function plumeSkin(rig: Rig): Skinner {
  const base = rig.height('Plume1');
  const p1 = rig.index('Plume1');
  const p2 = rig.index('Plume2');
  const p3 = rig.index('Plume3');
  const s = BODY.plumeSegment;
  return (_x, y, _z, out) => {
    const h = y - base;
    const second = smoothstep(s - 0.045, s + 0.045, h);
    const third = smoothstep(2 * s - 0.045, 2 * s + 0.045, h);
    out.add(p1, 1 - second);
    out.add(p2, second * (1 - third));
    out.add(p3, second * third);
  };
}

/** Dichter, aufrechter Buerstenbusch: gerippter Kern und ein Kranz einzelner Spitzen. */
function addPlume(kit: Kit): void {
  const { matte, tone, rig } = kit;
  const skin = plumeSkin(rig);
  const at = rig.rest('Plume1');
  const random = randomSource(23);
  const dark = shade(tone.plume, 0.5);
  const bright = shade(tone.plume, 1.3);

  // Kern: jede zweite Spalte steht vor - das gibt Borstenbuendel.
  const cols = 44;
  const profile = rounded(
    [
      [0.028, 0],
      [0.03, 0.03],
      [0.048, 0.07],
      [0.068, 0.115],
      [0.083, 0.16],
      [0.09, 0.2],
      [0.087, 0.223],
      [0.072, 0.237],
      [0.04, 0.243],
      [0, 0.244],
    ],
    18,
  );
  const ridge = Array.from({ length: cols }, () => 0.9 + random() * 0.2);
  const streak = Array.from({ length: cols }, () => random());
  const core = surface(
    cols,
    profile.length - 1,
    (col, row, out) => {
      const angle = (col / cols) * TAU;
      const [r, y] = profile[row];
      const k = col % cols;
      const radius = r * (k % 2 === 0 ? 1.09 : 0.91) * ridge[k];
      // Oben franst der Rand aus: jede Spalte endet etwas anders.
      const fray = smoothstep(0.18, 0.235, y) * (ridge[k] - 1) * 0.16;
      out.set(Math.sin(angle) * radius, y + fray, Math.cos(angle) * radius);
    },
    { wrap: true },
  );
  matte.soft(
    core,
    skin,
    (x, y, z) => {
      const a = Math.atan2(x, z + 0.01);
      const k = Math.round(((a < 0 ? a + TAU : a) / TAU) * cols) % cols;
      const tip = smoothstep(0.02, 0.24, y - at.elements[13]);
      return mix(dark, bright, 0.18 + 0.3 * tip + 0.5 * streak[k] * (k % 2 === 0 ? 1 : 0.4));
    },
    at,
  );

  // Einzelne Borstenspitzen: aussen kuerzer und nach aussen geneigt, innen laenger.
  const rings: readonly (readonly [number, number, number, number])[] = [
    // Anzahl, Radius, Fusshoehe, Laenge
    [24, 0.081, 0.19, 0.05],
    [17, 0.06, 0.204, 0.046],
    [10, 0.037, 0.212, 0.042],
    [4, 0.014, 0.216, 0.04],
  ];
  for (const [count, radius, foot, length] of rings) {
    for (let i = 0; i < count; i++) {
      const angle = ((i + random() * 0.6) / count) * TAU;
      const h = length * (0.75 + random() * 0.5);
      const r = radius * (0.88 + random() * 0.24);
      const lean = (r / 0.08) * (0.26 + random() * 0.16);
      const tuft = new ConeGeometry(0.012 + random() * 0.005, h, 4, 1, true);
      tuft.translate(0, h / 2, 0);
      const tint = shade(tone.plume, 0.85 + random() * 0.4);
      const place = new Matrix4()
        .copy(at)
        .multiply(put(Math.sin(angle) * r, foot + random() * 0.008, Math.cos(angle) * r, [1, 1, 1], [0, angle, 0]))
        .multiply(put(0, 0, 0, [1, 1, 1], [lean, 0, 0]));
      matte.soft(tuft, skin, tint, place);
    }
  }
}

// ---------------------------------------------------------------------------
// Rumpf: Waffenrock, Guertel, Kragen
// ---------------------------------------------------------------------------

/** Hoehen im Raum der Figur in Ruhe (Hueftgelenke = 0). */
const WAIST_Y = BODY.waist;
const CHEST_Y = BODY.waist + BODY.chest;
const NECK_Y = CHEST_Y + BODY.neck;
/** Wie kantig der Rumpf im Grundriss ist (2 = Ellipse, groesser = Kasten). */
const TRUNK_POWER = 3.6;

const trunkRx = curve([
  [-0.108, 0.205],
  [-0.098, 0.256],
  [-0.076, 0.27],
  [-0.04, 0.265],
  [0.02, 0.256],
  [0.08, 0.25],
  [0.11, 0.248],
  [0.17, 0.254],
  [0.26, 0.266],
  [0.36, 0.268],
  [0.44, 0.262],
  [0.5, 0.246],
  [0.545, 0.195],
  [0.575, 0.11],
]);
const trunkRz = curve([
  [-0.108, 0.125],
  [-0.098, 0.153],
  [-0.076, 0.162],
  [-0.04, 0.16],
  [0.02, 0.158],
  [0.08, 0.16],
  [0.11, 0.162],
  [0.17, 0.165],
  [0.26, 0.17],
  [0.36, 0.17],
  [0.44, 0.165],
  [0.5, 0.15],
  [0.545, 0.125],
  [0.575, 0.08],
]);

/** Radius des Rumpfs unter dem Winkel `angle` (0 = vorn) in der Hoehe `y`. */
function trunkRadius(angle: number, y: number): number {
  const sx = Math.abs(Math.sin(angle)) / trunkRx(y);
  const sz = Math.abs(Math.cos(angle)) / trunkRz(y);
  return (sx ** TRUNK_POWER + sz ** TRUNK_POWER) ** (-1 / TRUNK_POWER);
}

/** Vorderflaeche des Rumpfs: Tiefe an der Stelle (x, y). */
function trunkFront(x: number, y: number): number {
  const q = Math.min(0.995, Math.abs(x) / trunkRx(y));
  return trunkRz(y) * (1 - q ** TRUNK_POWER) ** (1 / TRUNK_POWER);
}

/** Becken, Taille, Brust: weiche Uebergaenge an den beiden Rumpfgelenken. */
function trunkSkin(rig: Rig): Skinner {
  const hips = rig.index('Hips');
  const spine = rig.index('Spine');
  const chest = rig.index('Chest');
  return (_x, y, _z, out) => {
    const toSpine = smoothstep(WAIST_Y - 0.05, WAIST_Y + 0.05, y);
    const toChest = smoothstep(CHEST_Y - 0.06, CHEST_Y + 0.06, y);
    out.add(hips, 1 - toSpine);
    out.add(spine, toSpine * (1 - toChest));
    out.add(chest, toSpine * toChest);
  };
}

/** Halsausschnitt: Hoehe der Kragenkante ueber der Stelle x; vorn tiefer als hinten. */
const NECKLINE = { front: 0.44, back: 0.462, corner: 0.5, side: 0.52, halfWidth: 0.238 } as const;

function neckline(x: number, front: boolean): number {
  const a = Math.abs(x);
  const low = front ? NECKLINE.front : NECKLINE.back;
  if (a < NECKLINE.halfWidth) return low + (NECKLINE.corner - low) * (a / NECKLINE.halfWidth) ** 3;
  return lerp(NECKLINE.corner, NECKLINE.side, smoothstep(NECKLINE.halfWidth, 0.272, a));
}

/** Waffenrock: der kupferbraune Rumpf vom gerollten Saum bis unter den Kragen. */
function addTrunk(kit: Kit): void {
  const { matte, tone, rig } = kit;
  const heights = [
    -0.108, -0.102, -0.092, -0.076, -0.058, -0.034, -0.005, 0.03, 0.06, 0.085, 0.11, 0.135, 0.16, 0.2, 0.24, 0.28, 0.32,
    0.36, 0.4, 0.44, 0.48, 0.515, 0.545, 0.575,
  ];
  const cols = 48;
  const last = heights.length + 1;
  const trunk = surface(
    cols,
    last,
    (col, row, out) => {
      // Erste und letzte Zeile schliessen die Form.
      if (row === 0) {
        out.set(0, -0.09, 0);
      } else if (row === last) {
        out.set(0, 0.58, 0);
      } else {
        const angle = (col / cols) * TAU;
        const y = heights[row - 1];
        const r = trunkRadius(angle, y);
        out.set(Math.sin(angle) * r, y, Math.cos(angle) * r);
      }
    },
    { wrap: true },
  );
  const under = shade(tone.tunic, 0.6);
  matte.soft(trunk, trunkSkin(rig), (_x, y) => mix(under, tone.tunic, smoothstep(-0.105, -0.085, y)));
}

/** Lederguertel mit eckiger Schnalle; er liegt ueber dem Wappenrock und verdeckt dessen Naht. */
function addBelt(kit: Kit): void {
  const { matte, tone, rig } = kit;
  const skin = trunkSkin(rig);
  const cols = 48;
  const band = rounded(
    [
      [0.01, WAIST_Y - 0.043],
      [0.027, WAIST_Y - 0.04],
      [0.031, WAIST_Y - 0.03],
      [0.0315, WAIST_Y],
      [0.031, WAIST_Y + 0.03],
      [0.027, WAIST_Y + 0.04],
      [0.01, WAIST_Y + 0.043],
    ],
    10,
  );
  const belt = surface(
    cols,
    band.length - 1,
    (col, row, out) => {
      const angle = (col / cols) * TAU;
      const [over, y] = band[row];
      const r = trunkRadius(angle, WAIST_Y) + over;
      out.set(Math.sin(angle) * r, y, Math.cos(angle) * r);
    },
    { wrap: true },
  );
  matte.soft(belt, skin, tone.leather);

  const front = trunkRz(WAIST_Y) + 0.0315;
  const z = front + 0.006;
  const bar = 0.024;
  const size = 0.118;
  // Schnalle: Rahmen aus vier runden Staeben, Dorn, daneben das Riemenende.
  const frame: readonly (readonly [number, number, number, number])[] = [
    [0, (size - bar) / 2, size, bar],
    [0, -(size - bar) / 2, size, bar],
    [(size - bar) / 2, 0, bar, size],
    [-(size - bar) / 2, 0, bar, size],
  ];
  for (const [x, y, w, h] of frame) {
    matte.soft(new RoundedBoxGeometry(w, h, 0.024, 2, 0.009), skin, tone.buckle, put(x, WAIST_Y + y, z));
  }
  matte.soft(new RoundedBoxGeometry(0.056, 0.013, 0.013, 2, 0.006), skin, shade(tone.buckle, 1.12), put(-0.014, WAIST_Y, z + 0.008));
  const tipX = 0.118;
  matte.soft(
    new RoundedBoxGeometry(0.085, 0.056, 0.014, 2, 0.007),
    skin,
    shade(tone.leather, 1.08),
    put(tipX, WAIST_Y, trunkFront(tipX, WAIST_Y) + 0.036, [1, 1, 1], [0, 0.2, 0]),
  );
  // Zwei Loecher im Riemen.
  for (const x of [-0.09, -0.125]) {
    matte.soft(ball(0.007, 8, 6), skin, shade(tone.leather, 0.45), put(x, WAIST_Y, trunkFront(x, WAIST_Y) + 0.031, [1, 1, 0.4]));
  }
}

/** Kupferner Kragen: liegt wie ein Latz auf Brust, Schultern und Ruecken; darueber der Halsring. */
function addCollar(kit: Kit): void {
  const { metal, tone, rig } = kit;
  const chest = rig.index('Chest');
  const onChest: Skinner = (_x, _y, _z, out) => out.add(chest, 1);
  const cols = 56;
  const steps = 9;
  const topR = 0.132;
  const topY = NECK_Y + 0.052;
  const cape = surface(
    cols,
    steps + 1,
    (col, row, out) => {
      const angle = (col / cols) * TAU;
      const s = Math.sin(angle);
      const c = Math.cos(angle);
      // Kante: folgt dem Halsausschnitt und liegt auf dem Rumpf auf.
      const edgeY = neckline(trunkRadius(angle, 0.47) * s, c >= 0);
      const edgeR = trunkRadius(angle, edgeY) + 0.017;
      let r: number;
      let y: number;
      if (row === 0) {
        r = edgeR - 0.014;
        y = edgeY + 0.003;
      } else {
        const t = (row - 1) / (steps - 0);
        r = lerp(edgeR, topR, t ** 2.3);
        y = lerp(edgeY, topY, 1 - (1 - t) ** 1.7);
      }
      out.set(s * r, y, c * r);
    },
    { wrap: true },
  );
  metal.soft(cape, onChest, tone.copper);

  // Hals und Halsring: Der Helm sitzt darauf, auch wenn der Kopf sich neigt.
  metal.rigid(pillow(0.135, 0.085, 0.13, 1, 20, 10), 'Neck', shade(tone.copper, 0.8), put(0, 0.005, 0));
  const ring = new TorusGeometry(0.156, 0.024, 10, 40);
  metal.rigid(ring, 'Neck', tone.copper, put(0, 0.038, 0.004, [1, 1, 1], [Math.PI / 2, 0, 0]));
}

// ---------------------------------------------------------------------------
// Wappenrock
// ---------------------------------------------------------------------------

/** Dicke des Tuchs und sein Abstand vom Waffenrock. */
const CLOTH_THICK = 0.011;
const CHEST_BOTTOM = WAIST_Y - 0.034;
/** Die haengende Bahn beginnt unter dem Guertel und reicht bis zur Mitte der Oberschenkel. */
const PANEL_TOP = WAIST_Y + 0.014;
const PANEL_HALF = 0.2;

type SheetPoint = (t: number, s: number, out: Vector3) => void;

/**
 * Ein Stueck Tuch mit Dicke: Vorderseite, Rueckseite und die genannten Kanten.
 * `t` laeuft -1..1 von der rechten zur linken Seite der Figur, `s` 0..1 von
 * unten nach oben. Die Textur liegt auf dem Ausschnitt [v0..v1].
 */
function sheet(
  cols: number,
  rows: number,
  point: SheetPoint,
  v0: number,
  v1: number,
  edges: { sides: boolean; bottom: boolean; back: boolean },
): BufferGeometry[] {
  const parts: BufferGeometry[] = [];
  const at = (col: number, row: number, out: Vector3, depth: number): void => {
    point((col / cols) * 2 - 1, row / rows, out);
    out.z -= depth;
  };
  parts.push(mapped(surface(cols, rows, (col, row, out) => at(col, row, out, 0)), 0, v0, 1, v1));
  if (edges.back) parts.push(mapped(reversed(surface(cols, rows, (col, row, out) => at(col, row, out, CLOTH_THICK))), 0, v0, 1, v1));
  if (edges.sides) {
    // Kanten zeigen die Borte.
    parts.push(mapped(surface(1, rows, (col, row, out) => at(0, row, out, (1 - col) * CLOTH_THICK)), 0.02, v0, 0.02, v1));
    parts.push(mapped(surface(1, rows, (col, row, out) => at(cols, row, out, col * CLOTH_THICK)), 0.98, v0, 0.98, v1));
  }
  if (edges.bottom) {
    parts.push(mapped(surface(cols, 1, (col, row, out) => at(col, 0, out, (1 - row) * CLOTH_THICK)), 0, v0, 1, v0));
  }
  return parts;
}

/** Bahn unter dem Guertel: oben geht sie mit dem Rumpf, darunter haengt sie an ihren zwei Gliedern. */
function panelSkin(rig: Rig, first: BoneName, second: BoneName): Skinner {
  const trunk = trunkSkin(rig);
  const b1 = rig.index(first);
  const b2 = rig.index(second);
  const joint1 = rig.height(first);
  const joint2 = rig.height(second);
  return (x, y, z, out) => {
    const hang = 1 - smoothstep(joint1 - 0.012, joint1 + 0.032, y);
    const low = 1 - smoothstep(joint2 - 0.05, joint2 + 0.05, y);
    if (hang < 1) {
      trunk(x, y, z, out);
      out.scale(1 - hang);
    }
    out.add(b1, hang * (1 - low));
    out.add(b2, hang * low);
  };
}

/** Wappenrock vorn und hinten: Brustteil auf dem Rumpf, darunter je eine frei haengende Bahn. */
function addTabard(kit: Kit): void {
  const { cloth, rig, tone } = kit;
  const trunk = trunkSkin(rig);
  const panelBottom = rig.height('TabardFront2') - BODY.tabardSegment;
  const anchorZ = rig.rest('TabardFront1').elements[14];

  for (const front of [true, false]) {
    // Die Rueckseite ist die gespiegelte Vorderseite.
    const place = front ? NO_PLACE : put(0, 0, 0, [1, 1, -1]);
    const chest: SheetPoint = (t, s, out) => {
      const top = neckline(t * NECKLINE.halfWidth, front) + 0.009;
      const y = lerp(CHEST_BOTTOM, top, s);
      const x = t * lerp(0.224, NECKLINE.halfWidth, smoothstep(CHEST_BOTTOM, 0.42, y));
      out.set(x, y, trunkFront(x, y) + CLOTH_THICK);
    };
    for (const part of sheet(14, 12, chest, 0.5, 1, { sides: true, bottom: false, back: false })) {
      cloth.soft(part, trunk, tone.white, place);
    }

    const panel: SheetPoint = (t, s, out) => {
      const y = lerp(panelBottom, PANEL_TOP, s);
      const x = t * lerp(PANEL_HALF + 0.006, PANEL_HALF, s);
      // Unter dem Guertel liegt die Bahn am Rumpf an, darunter haengt sie am Gelenk.
      const tuck = smoothstep(WAIST_Y - 0.05, WAIST_Y, y);
      out.set(x, y, lerp(anchorZ + 0.004 - 0.012 * t * t, trunkFront(x, y) + CLOTH_THICK + 0.005, tuck));
    };
    const skin = panelSkin(rig, front ? 'TabardFront1' : 'TabardBack1', front ? 'TabardFront2' : 'TabardBack2');
    for (const part of sheet(8, 14, panel, 0, 0.5, { sides: true, bottom: true, back: true })) {
      cloth.soft(part, skin, tone.white, place);
    }
  }
}

// ---------------------------------------------------------------------------
// Schulterplatten und Arme
// ---------------------------------------------------------------------------

const PAULDRON = {
  /** Mittelpunkt und Halbachsen der Kuppel im Raum des Schulterknochens (linke Seite). */
  x: 0.028,
  y: 0.012,
  rx: 0.154,
  ry: 0.158,
  rz: 0.158,
  /** Schnitt innen (zum Hals) und unten. */
  innerCut: -0.058,
  lowCut: -0.092,
  rim: 0.018,
} as const;

/** Schulterplatte der linken Seite: Kuppel, innen und unten gerade abgeschnitten, mit gerolltem Rand. */
function pauldronParts(): { dome: BufferGeometry; rim: BufferGeometry } {
  const P = PAULDRON;
  const dome = new SphereGeometry(1, 28, 16);
  dome.scale(P.rx, P.ry, P.rz);
  dome.translate(P.x, P.y, 0);
  const position = dome.getAttribute('position');
  const normal = dome.getAttribute('normal');
  for (let i = 0; i < position.count; i++) {
    if (position.getX(i) < P.innerCut) {
      position.setX(i, P.innerCut);
      normal.setXYZ(i, -1, 0, 0);
    }
    if (position.getY(i) < P.lowCut) {
      position.setY(i, P.lowCut);
      normal.setXYZ(i, 0, -1, 0);
    }
  }
  // Rand: am Halsschnitt hinauf und hinunter, dann unten aussen herum.
  const innerScale = Math.sqrt(1 - ((P.innerCut - P.x) / P.rx) ** 2);
  const lowScale = Math.sqrt(1 - ((P.lowCut - P.y) / P.ry) ** 2);
  const innerEnd = Math.acos((P.lowCut - P.y) / (P.ry * innerScale));
  const lowEnd = Math.acos((P.innerCut - P.x) / (P.rx * lowScale));
  const path: Vector3[] = [];
  const innerSteps = 14;
  const lowSteps = 22;
  for (let i = 0; i < innerSteps; i++) {
    const a = lerp(-innerEnd, innerEnd, i / innerSteps) * 0.94;
    path.push(new Vector3(P.innerCut, P.y + P.ry * innerScale * Math.cos(a), P.rz * innerScale * Math.sin(a)));
  }
  for (let i = 0; i < lowSteps; i++) {
    const b = lerp(lowEnd, -lowEnd, i / lowSteps) * 0.94;
    path.push(new Vector3(P.x + P.rx * lowScale * Math.cos(b), P.lowCut, P.rz * lowScale * Math.sin(b)));
  }
  return { dome, rim: roll(path, P.rim, 60, 7) };
}

/** Stulpenhandschuh: weiter Trichter am Ellbogen, schmal am Handgelenk. */
function gloveGeometry(): BufferGeometry {
  const profile = rounded(
    [
      [0.048, -0.224],
      [0.07, -0.206],
      [0.076, -0.175],
      [0.083, -0.14],
      [0.094, -0.1],
      [0.106, -0.068],
      [0.113, -0.054],
      [0.111, -0.043],
      [0.101, -0.041],
      [0.091, -0.052],
      [0.08, -0.08],
    ],
    20,
  );
  // Die Stulpe ist schraeg geschnitten: aussen laenger.
  return revolve(profile, 24, (angle, _row, p) => {
    p.y += 0.016 * Math.sin(angle) * smoothstep(-0.12, -0.05, p.y);
  });
}

function addArm(kit: Kit, side: 'L' | 'R'): void {
  const { metal, matte, tone } = kit;
  const sx = side === 'L' ? 1 : -1;
  const mirror = put(0, 0, 0, [sx, 1, 1]);

  // Schulterplatte: sitzt auf dem Schulterknochen, der dem Arm nur ein Stueck folgt.
  const { dome, rim } = pauldronParts();
  const under = shade(tone.copper, 0.55);
  metal.rigid(dome, `Shoulder.${side}`, (_x, y) => mix(under, tone.copper, smoothstep(PAULDRON.lowCut, PAULDRON.lowCut + 0.012, y)), mirror);
  metal.rigid(rim, `Shoulder.${side}`, shade(tone.copper, 1.04), mirror);

  // Oberarm: nackt und kraeftig. Kugeln gleicher Dicke an Schulter und Ellbogen
  // halten das Gelenk in jeder Beugung geschlossen.
  const upper = rounded(
    [
      [0.083, -BODY.upperArm],
      [0.092, -0.17],
      [0.099, -0.085],
      [0.096, 0],
    ],
    10,
  );
  matte.rigid(revolve(upper, 20), `UpperArm.${side}`, tone.skin);
  matte.rigid(ball(0.098, 16, 10), `UpperArm.${side}`, tone.skin);
  matte.rigid(ball(0.083, 16, 10), `LowerArm.${side}`, tone.skin);

  // Unterarm: Haut bis in die Stulpe, darueber der Handschuh.
  const stub = rounded(
    [
      [0.07, -0.12],
      [0.078, -0.06],
      [0.083, 0],
    ],
    4,
  );
  matte.rigid(revolve(stub, 16), `LowerArm.${side}`, tone.skin);
  matte.rigid(gloveGeometry(), `LowerArm.${side}`, tone.glove, mirror);

  // Faust: runder Faeustling um den Griffpunkt - passt in jeder Lage zum Unterarm.
  matte.rigid(pillow(0.076, 0.082, 0.08, 0.86, 22, 14), `Hand.${side}`, tone.glove);
}

// ---------------------------------------------------------------------------
// Beine
// ---------------------------------------------------------------------------

/** Eine Schiene des Eisenschuhs: halbes Ei auf der Sohle. */
interface Lame {
  /** Mitte entlang des Fusses. */
  z: number;
  /** Halbe Breite, Hoehe ueber der Sohle, halbe Laenge. */
  rx: number;
  ry: number;
  rz: number;
}

/** Von hinten nach vorn: Knoechelkragen, Rist, Zehenkappe. */
const LAMES: readonly Lame[] = [
  { z: -0.008, rx: 0.088, ry: 0.142, rz: 0.072 },
  { z: 0.035, rx: 0.092, ry: 0.118, rz: 0.092 },
  { z: 0.092, rx: 0.096, ry: 0.096, rz: 0.098 },
];

/** Wie weit eine Schiene an der Stelle z in Richtung `a` des Querschnitts reicht (0 = Seite, PI/2 = oben). */
function lameReach(lame: Lame, z: number, a: number): number {
  const along = Math.sqrt(Math.max(0, 1 - ((z - lame.z) / lame.rz) ** 2));
  return along / Math.hypot(Math.cos(a) / lame.rx, Math.sin(a) / lame.ry);
}

/** Wulst auf der Vorderkante einer Schiene: dort, wo sie auf der naechsten aufliegt. */
function lameRidge(rear: Lame, front: Lame): BufferGeometry {
  const points: Vector3[] = [];
  const steps = 14;
  for (let i = 0; i <= steps; i++) {
    const a = (i / steps) * Math.PI;
    // Schnittstelle der beiden Schienen in dieser Richtung suchen.
    let lo = rear.z;
    let hi = rear.z + rear.rz;
    for (let k = 0; k < 14; k++) {
      const mid = (lo + hi) / 2;
      if (lameReach(rear, mid, a) > lameReach(front, mid, a)) lo = mid;
      else hi = mid;
    }
    const reach = lameReach(rear, lo, a);
    points.push(new Vector3(Math.cos(a) * reach, Math.sin(a) * reach, lo));
  }
  return new TubeGeometry(new CatmullRomCurve3(points), 16, 0.0065, 5, false);
}

function addLeg(kit: Kit, side: 'L' | 'R'): void {
  const { metal, matte, tone } = kit;

  // Oberschenkel im Tuch; die Hueftkugel verschwindet unter dem Waffenrock.
  // Am Knie ist er deutlich duenner als die Kniekugel - sonst flimmert die Naht.
  const thigh = rounded(
    [
      [0.078, -BODY.thigh],
      [0.095, -0.17],
      [0.105, -0.07],
      [0.102, 0],
    ],
    8,
  );
  matte.rigid(revolve(thigh, 20), `UpperLeg.${side}`, tone.thigh);
  matte.rigid(ball(0.102, 16, 10), `UpperLeg.${side}`, tone.thigh);

  // Knie: Stahlkugel als Gelenk, davor die Kniekachel mit gerolltem Rand.
  metal.rigid(ball(0.097, 20, 12), `LowerLeg.${side}`, tone.steel);
  const cop = put(0, 0.002, 0.032, [1, 1, 1], [-0.2, 0, 0]);
  metal.rigid(pillow(0.097, 0.094, 0.08, 0.8, 24, 12), `LowerLeg.${side}`, tone.steel, cop);
  const outline: Vector3[] = [];
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * TAU;
    outline.push(new Vector3(0.094 * spow(Math.cos(a), 0.8), 0.091 * spow(Math.sin(a), 0.8), 0.012));
  }
  metal.rigid(roll(outline, 0.011, 40, 6), `LowerLeg.${side}`, shade(tone.steel, 1.04), cop);

  // Beinroehre: unten eingezogen, damit man nicht hineinsieht; die Kugel im
  // Knoechel fuellt die Luecke, wenn der Fuss kippt.
  const greave = rounded(
    [
      [0.06, -BODY.shin + 0.002],
      [0.082, -BODY.shin - 0.003],
      [0.087, -BODY.shin + 0.015],
      [0.086, -0.16],
      [0.083, -0.09],
      [0.083, -0.04],
      [0.07, 0.01],
    ],
    10,
  );
  metal.rigid(revolve(greave, 20), `LowerLeg.${side}`, tone.steel);

  // Eisenschuh: drei runde Schienen hintereinander, unten platt auf der Sohle,
  // mit einem Wulst auf jeder Vorderkante.
  const sole = -BODY.ankleHeight;
  metal.rigid(ball(0.082, 16, 10), `Foot.${side}`, shade(tone.sabaton, 0.9));
  LAMES.forEach((lame, i) => {
    const shell = new SphereGeometry(1, 20, 12);
    shell.scale(lame.rx, lame.ry, lame.rz);
    metal.rigid(flattened(shell, 0), `Foot.${side}`, shade(tone.sabaton, 0.95 + i * 0.04), put(0, sole, lame.z));
    if (i > 0) metal.rigid(lameRidge(LAMES[i - 1], lame), `Foot.${side}`, shade(tone.sabaton, 1.06), put(0, sole, 0));
  });
}

// ---------------------------------------------------------------------------
// Schwert und Schild
// ---------------------------------------------------------------------------

/** Klinge: kurz und breit, flache Wangen mit breiter Fase, spitz zulaufend. Bewusst kantig. */
function bladeGeometry(): BufferGeometry {
  const half = BODY.bladeWidth / 2;
  // Querschnitt [x, z], im Umlaufsinn der Flaechen.
  const section: readonly (readonly [number, number])[] = [
    [0.0035, -half],
    [-0.0035, -half],
    [-0.013, -0.031],
    [-0.013, 0.031],
    [-0.0035, half],
    [0.0035, half],
    [0.013, 0.031],
    [0.013, -0.031],
  ];
  // Hoehe, Breite, Dicke
  const stations: readonly (readonly [number, number, number])[] = [
    [BODY.bladeStart - 0.012, 0, 0],
    [BODY.bladeStart - 0.012, 1, 1],
    [BODY.bladeEnd - 0.118, 1, 1],
    [BODY.bladeEnd - 0.004, 0.07, 0.4],
    [BODY.bladeEnd, 0, 0],
  ];
  const blade = surface(
    section.length,
    stations.length - 1,
    (col, row, out) => {
      const [x, z] = section[col % section.length];
      const [y, wide, thick] = stations[row];
      out.set(x * thick, y, z * wide);
    },
    { wrap: true },
  );
  const flat = blade.toNonIndexed();
  flat.computeVertexNormals();
  return flat;
}

function buildSword(kit: Kit, metalMaterial: MeshStandardMaterial, matteMaterial: MeshStandardMaterial): Mesh[] {
  const { tone } = kit;
  const steel = new Batch();
  steel.plain(bladeGeometry(), tone.blade);
  steel.plain(ball(0.034, 16, 12), shade(tone.blade, 0.82), put(0, -0.096, 0, [1, 0.82, 1]));

  const hilt = new Batch();
  // Parierstange quer zur Klinge, Griff, darunter der Knauf.
  hilt.plain(new RoundedBoxGeometry(0.048, 0.046, 0.25, 2, 0.015), tone.guard, put(0, BODY.bladeStart - 0.028, 0));
  const grip = rounded(
    [
      [0.019, -0.085],
      [0.023, -0.04],
      [0.023, 0.01],
      [0.02, 0.05],
    ],
    8,
  );
  hilt.plain(revolve(grip, 12), shade(tone.guard, 0.8));
  return [steel.mesh(metalMaterial), hilt.mesh(matteMaterial)];
}

/** Kreuz mit ausgestellten Enden; der untere Arm ist laenger. */
function crossShape(): Shape {
  const waist = 0.027;
  const flare = 0.052;
  // Arme: Richtung und Laenge
  const arms: readonly (readonly [number, number, number])[] = [
    [1, 0, 0.158],
    [0, 1, 0.168],
    [-1, 0, 0.158],
    [0, -1, 0.2],
  ];
  const shape = new Shape();
  arms.forEach(([dx, dy, length], i) => {
    // Seitenrichtung: 90 Grad im Uhrzeigersinn zur Armrichtung.
    const px = dy;
    const py = -dx;
    const p = (along: number, across: number): [number, number] => [dx * along + px * across, dy * along + py * across];
    const start = p(waist, waist);
    if (i === 0) shape.moveTo(start[0], start[1]);
    else shape.lineTo(start[0], start[1]);
    const mid = p(length * 0.62, waist);
    const end = p(length, flare);
    shape.quadraticCurveTo(mid[0], mid[1], end[0], end[1]);
    const far = p(length, -flare);
    shape.lineTo(far[0], far[1]);
    const back = p(length * 0.62, -waist);
    const inner = p(waist, -waist);
    shape.quadraticCurveTo(back[0], back[1], inner[0], inner[1]);
  });
  shape.closePath();
  return shape;
}

function buildShield(kit: Kit, woodMaterial: MeshStandardMaterial, metalMaterial: MeshStandardMaterial): Mesh[] {
  const { tone } = kit;
  const R = BODY.shieldRadius;
  const boardR = R - 0.034;
  const half = 0.014;

  const wood = new Batch();
  const around = 44;
  // Bretterflaeche: von aussen zur Mitte, damit sie nach vorn zeigt.
  const face = surface(
    around,
    3,
    (col, row, out) => {
      const a = (col / around) * TAU;
      const r = boardR * (1 - row / 3);
      out.set(Math.cos(a) * r, Math.sin(a) * r, 0);
    },
    { wrap: true },
  );
  const uv = face.getAttribute('uv');
  const position = face.getAttribute('position');
  for (let i = 0; i < uv.count; i++) {
    uv.setXY(i, 0.5 + (position.getX(i) / boardR) * 0.47, 0.5 + (position.getY(i) / boardR) * 0.47);
  }
  wood.plain(face, tone.white, put(0, 0, half));
  wood.plain(face, shade(tone.white, 0.82), put(0, 0, -half, [1, 1, -1]));
  // Aufgemaltes Kreuz in der Farbe der Seite, leicht erhaben.
  const cross = new ExtrudeGeometry(crossShape(), {
    depth: 0.005,
    bevelEnabled: true,
    bevelThickness: 0.004,
    bevelSize: 0.004,
    bevelSegments: 2,
    curveSegments: 8,
  });
  wood.plain(cross, tone.team, put(0, 0.012, half - 0.002), WOOD_BLANK);
  // Rueckseite: Griffstange laengs, auf zwei Kloetzen.
  const leather = shade(tone.leather, 0.9);
  const gripZ = -BODY.shieldOffset;
  wood.plain(new RoundedBoxGeometry(0.03, 0.22, 0.03, 2, 0.013), leather, put(0, 0, gripZ), WOOD_BLANK);
  for (const y of [0.1, -0.1]) {
    wood.plain(new RoundedBoxGeometry(0.04, 0.036, -gripZ - half + 0.02, 2, 0.01), leather, put(0, y, (gripZ - half) / 2), WOOD_BLANK);
  }

  const metal = new Batch();
  // Stahlreif: breites flaches Band, vorn und hinten ueber die Bretter gezogen.
  const band = rounded(
    [
      [R - 0.04, -0.017],
      [R - 0.006, -0.021],
      [R, -0.013],
      [R, 0.015],
      [R - 0.006, 0.023],
      [R - 0.038, 0.022],
      [R - 0.043, 0.014],
      [R - 0.043, -0.01],
      [R - 0.04, -0.017],
    ],
    18,
  );
  const upright = put(0, 0, 0, [1, 1, 1], [Math.PI / 2, 0, 0]);
  metal.plain(revolve(band, 48), tone.rim, upright);
  // Nieten auf dem Reif.
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * TAU + Math.PI / 2;
    const r = R - 0.022;
    metal.plain(ball(0.0115, 8, 6), shade(tone.rim, 1.25), put(Math.cos(a) * r, Math.sin(a) * r, 0.023, [1, 1, 0.6]));
  }
  return [wood.mesh(woodMaterial), metal.mesh(metalMaterial)];
}

/** Riemen des Schilds um das linke Handgelenk. */
function buildStrap(kit: Kit, matteMaterial: MeshStandardMaterial): Mesh {
  const strap = new Batch();
  strap.plain(new TorusGeometry(0.075, 0.013, 8, 24), shade(kit.tone.leather, 0.8), put(0, -0.158, 0, [1, 1, 2.1], [Math.PI / 2, 0, 0]));
  return strap.mesh(matteMaterial);
}

// ---------------------------------------------------------------------------
// Zusammenbau
// ---------------------------------------------------------------------------

/** Wie hell das Treffer-Aufblitzen die Figur faerbt. */
const FLASH = 0.85;

export const buildKnightMesh: KnightMeshBuilder = (skeleton, look) => {
  const rig = new Rig(skeleton);
  const tabard = tabardTexture(look);
  const planks = woodTexture();
  const metalMaterial = new MeshStandardMaterial({ vertexColors: true, roughness: 0.4, metalness: 0.3 });
  const matteMaterial = new MeshStandardMaterial({ vertexColors: true, roughness: 0.68 });
  const clothMaterial = new MeshStandardMaterial({ map: tabard, roughness: 0.8 });
  const woodMaterial = new MeshStandardMaterial({ map: planks, vertexColors: true, roughness: 0.66 });
  const materials = [metalMaterial, matteMaterial, clothMaterial, woodMaterial];

  const kit: Kit = { rig, tone: palette(look), metal: new Batch(rig), matte: new Batch(rig), cloth: new Batch(rig) };
  addHelmet(kit);
  addPlume(kit);
  addTrunk(kit);
  addCollar(kit);
  addTabard(kit);
  addBelt(kit);
  for (const side of ['L', 'R'] as const) {
    addArm(kit, side);
    addLeg(kit, side);
  }

  // Die gebundenen Netze haengen am Koerper; gebunden wird in der Ruhelage.
  const bones = new Skeleton(rig.bones);
  const body = [kit.metal.skinned(metalMaterial), kit.matte.skinned(matteMaterial), kit.cloth.skinned(clothMaterial)];
  for (const mesh of body) {
    skeleton.body.add(mesh);
    mesh.bind(bones);
  }

  const sword = buildSword(kit, metalMaterial, matteMaterial);
  for (const mesh of sword) skeleton.bones.Sword.add(mesh);
  const shield: Object3D[] = buildShield(kit, woodMaterial, metalMaterial);
  for (const mesh of shield) skeleton.bones.Shield.add(mesh);
  const strap = buildStrap(kit, matteMaterial);
  skeleton.bones['LowerArm.L'].add(strap);
  shield.push(strap);

  const meshes = [...body, ...sword, ...shield] as Mesh[];

  return {
    setFlash(glow) {
      for (const m of materials) m.emissive.setScalar(glow * FLASH);
    },
    setLoadout(armed, withShield) {
      for (const m of sword) m.visible = armed;
      for (const m of shield) m.visible = withShield;
    },
    dispose() {
      for (const mesh of meshes) {
        mesh.removeFromParent();
        mesh.geometry.dispose();
      }
      for (const m of materials) m.dispose();
      bones.dispose();
      tabard.dispose();
      planks.dispose();
    },
  };
};
