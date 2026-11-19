// Die Haltung des Ritters und wie man Haltungen aneinanderreiht.
//
// Eine `Pose` ist ein flacher Satz Zahlen ("Kanaele"). Das Skelett
// (skeleton.ts) macht daraus Gelenkwinkel; Ellbogen und Knie errechnet es
// selbst. Dadurch laesst sich eine Haltung hinschreiben als "Becken hier,
// Schwerthand dort, Klinge zeigt dahin, linker Fuss steht da".
//
// RAEUME
//   Figur-Raum   +Z zum Gegner, +X IHRE linke Seite, +Y oben, Boden y = 0,
//                Ursprung am Standpunkt. Becken und Fuesse stehen hier - ein
//                Fuss, der in zwei Stuetzhaltungen dieselben Werte hat,
//                rutscht also nicht, egal was der Rest des Koerpers tut.
//   Brust-Raum   wie der Figur-Raum, aber an den Brustkorb geheftet: Dreht
//                oder beugt sich der Rumpf, gehen Haende, Klinge und Schild
//                mit. Die Zahlen meinen die aufrecht stehende Figur
//                (Schultergelenk rechts bei x = -0.32, y = 1.03).
//
// VORZEICHEN (ueberall gleich)
//   Pitch +  nach vorn/unten neigen      Yaw +  nach links drehen
//   Roll  +  nach links neigen

import { BODY, CHEST_REST_Y } from './proportions';

export interface Pose {
  // --- ganze Figur: nur fuer Rolle, Sturz, Liegen -------------------------
  /** Verschiebung der ganzen Figur samt Fuessen. */
  rootX: number;
  rootY: number;
  rootZ: number;
  /** Drehung der ganzen Figur um den Punkt (0, pivotY, 0). */
  rootPitch: number;
  rootYaw: number;
  rootRoll: number;
  pivotY: number;

  // --- Becken (Figur-Raum) -------------------------------------------------
  hipX: number;
  /** Hoehe der Hueftgelenke; durchgestreckt 0.56, in der Grundhaltung 0.5. */
  hipY: number;
  hipZ: number;
  hipPitch: number;
  hipYaw: number;
  hipRoll: number;

  // --- Wirbelsaeule: Brust gegenueber dem Becken ---------------------------
  spinePitch: number;
  spineYaw: number;
  spineRoll: number;

  // --- Kopf gegenueber der Brust -------------------------------------------
  headPitch: number;
  headYaw: number;
  headRoll: number;
  /** 0..1: wie stark der Kopf von selbst den Gegner im Blick behaelt. */
  look: number;

  // --- Schultern hochziehen (0..1) -----------------------------------------
  shrugR: number;
  shrugL: number;

  // --- Schwerthand rechts (Brust-Raum) -------------------------------------
  /** Griffmitte der Hand. */
  handRX: number;
  handRY: number;
  handRZ: number;
  /** Ellbogen anheben/abspreizen (+) oder an den Koerper nehmen (-), in rad. */
  elbowR: number;
  /** Wohin die Klinge zeigt (Richtung, Laenge egal). */
  bladeX: number;
  bladeY: number;
  bladeZ: number;
  /** Klinge um ihre Laengsachse drehen (rad); 0 = Schneide fuehrt. */
  bladeRoll: number;

  // --- linke Hand (Brust-Raum) ---------------------------------------------
  handLX: number;
  handLY: number;
  handLZ: number;
  elbowL: number;
  /** 1 = linke Hand am Schwertgriff, 0 = am eigenen Zielpunkt (nur ohne Schild). */
  grip: number;
  /** Wohin die Schildflaeche zeigt (Richtung; nur mit Schild). */
  shieldX: number;
  shieldY: number;
  shieldZ: number;

  // --- Fuesse (Figur-Raum) -------------------------------------------------
  /** Knoechel in der Waagrechten; footY = wie hoch die Sohle ueber dem Boden ist. */
  footRX: number;
  footRY: number;
  footRZ: number;
  /** Fussspitze nach links (+) / rechts (-) gedreht. */
  footRYaw: number;
  /** Fussspitze nach unten (+): Ferse hebt sich. */
  footRPitch: number;
  /** Knie nach aussen (+) / innen (-) drehen, in rad. */
  kneeR: number;
  footLX: number;
  footLY: number;
  footLZ: number;
  footLYaw: number;
  footLPitch: number;
  kneeL: number;

  /**
   * 1 = die Fuesse halten sich an den Boden (Sohle sinkt nie ein, die Ferse
   * hebt sich, wenn das Bein sonst zu kurz waere). 0 = aus, fuer Haltungen,
   * in denen die ganze Figur gedreht wird (Rolle, Liegen).
   */
  ground: number;
}

export const POSE_KEYS = [
  'rootX', 'rootY', 'rootZ', 'rootPitch', 'rootYaw', 'rootRoll', 'pivotY',
  'hipX', 'hipY', 'hipZ', 'hipPitch', 'hipYaw', 'hipRoll',
  'spinePitch', 'spineYaw', 'spineRoll',
  'headPitch', 'headYaw', 'headRoll', 'look',
  'shrugR', 'shrugL',
  'handRX', 'handRY', 'handRZ', 'elbowR', 'bladeX', 'bladeY', 'bladeZ', 'bladeRoll',
  'handLX', 'handLY', 'handLZ', 'elbowL', 'grip', 'shieldX', 'shieldY', 'shieldZ',
  'footRX', 'footRY', 'footRZ', 'footRYaw', 'footRPitch', 'kneeR',
  'footLX', 'footLY', 'footLZ', 'footLYaw', 'footLPitch', 'kneeL',
  'ground',
] as const satisfies readonly (keyof Pose)[];

export type PoseKey = (typeof POSE_KEYS)[number];
export type PartialPose = Partial<Pose>;

/** Drehungen der ganzen Figur: Die Figur folgt ihnen auf kuerzestem Weg. */
export const ANGLE_KEYS: ReadonlySet<PoseKey> = new Set(['rootPitch', 'rootYaw', 'rootRoll']);

/**
 * Grundhaltung. JEDER Ablauf beginnt und endet hier - sie ist deshalb fest
 * und wird von keinem Ablauf veraendert.
 *
 * Schildseite vorn: linker Fuss vorn, Koerper nach rechts weggedreht, Schild
 * vor der Brust, Schwert rechts an der Huefte, Spitze schraeg nach oben vorn.
 */
export const STANCE: Pose = {
  rootX: 0, rootY: 0, rootZ: 0, rootPitch: 0, rootYaw: 0, rootRoll: 0, pivotY: 0.5,
  hipX: 0, hipY: 0.5, hipZ: 0, hipPitch: 0.06, hipYaw: -0.3, hipRoll: 0,
  spinePitch: 0.1, spineYaw: -0.12, spineRoll: 0,
  headPitch: 0, headYaw: 0, headRoll: 0, look: 1,
  shrugR: 0, shrugL: 0,
  handRX: -0.4, handRY: 0.84, handRZ: 0.16, elbowR: 0.15,
  bladeX: 0.3, bladeY: 0.72, bladeZ: 0.62, bladeRoll: 0,
  handLX: 0.27, handLY: 0.93, handLZ: 0.3, elbowL: 0.1, grip: 0,
  shieldX: 0.38, shieldY: 0.06, shieldZ: 0.92,
  footRX: -0.17, footRY: 0, footRZ: -0.17, footRYaw: -0.55, footRPitch: 0, kneeR: 0.1,
  footLX: 0.13, footLY: 0, footLZ: 0.2, footLYaw: 0.05, footLPitch: 0, kneeL: 0.05,
  ground: 1,
};

/** Grundhaltung mit Abweichungen. */
export function pose(overrides: PartialPose = {}): Pose {
  return { ...STANCE, ...overrides };
}

export function newPose(): Pose {
  return { ...STANCE };
}

export function copyPose(from: Pose, to: Pose): void {
  for (const k of POSE_KEYS) to[k] = from[k];
}

/** Geradlinig zwischen zwei Haltungen; `u` = 0 ergibt `a`, 1 ergibt `b`. */
export function mixPose(a: Pose, b: Pose, u: number, out: Pose): void {
  for (const k of POSE_KEYS) out[k] = a[k] + (b[k] - a[k]) * u;
}

/** Legt `overrides` ueber eine fertige Haltung. */
export function applyPose(out: Pose, overrides: PartialPose): void {
  for (const k of POSE_KEYS) {
    const v = overrides[k];
    if (v !== undefined) out[k] = v;
  }
}

// ---------------------------------------------------------------------------
// Zeitverlaeufe
// ---------------------------------------------------------------------------

/**
 * Wie die Zeit auf dem Weg ZU einer Stuetzhaltung verlaeuft:
 *   linear  gleichmaessig
 *   smooth  weich anfahren und abbremsen
 *   in      langsam los, dann beschleunigen (Hieb, der einschlaegt)
 *   out     schnell los, dann ausrollen (Nachschwingen)
 *   snap    sehr hart beschleunigen (Peitschenende)
 */
export type Ease = 'linear' | 'smooth' | 'in' | 'out' | 'snap';

export function ease(u: number, kind: Ease): number {
  if (u <= 0) return 0;
  if (u >= 1) return 1;
  switch (kind) {
    case 'smooth':
      return u * u * (3 - 2 * u);
    case 'in':
      return u * u * u;
    case 'out':
      return 1 - (1 - u) * (1 - u) * (1 - u);
    case 'snap':
      return u * u * u * u * u;
    default:
      return u;
  }
}

export function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** Weicher Uebergang 0..1, waehrend `v` von `from` nach `to` laeuft. */
export function ramp(v: number, from: number, to: number): number {
  if (to === from) return v >= to ? 1 : 0;
  return ease(clamp01((v - from) / (to - from)), 'smooth');
}

export interface Key {
  /** Zeitpunkt 0..1 innerhalb der Phase. */
  t: number;
  pose: Pose;
  /** Zeitverlauf auf dem Weg von der vorigen Stuetzhaltung hierher. */
  ease: Ease;
  /**
   * 0..1: wie viel Schwung durch diese Stuetzhaltung hindurchgeht.
   * 0 = die Bewegung kommt hier zur Ruhe (Halten, Einschlag).
   * 1 = sie laeuft in einem Bogen durch (Zwischenhaltung in einem Schwung).
   */
  flow: number;
}

/**
 * Eine Stuetzhaltung. `overrides` gelten gegenueber der Grundhaltung - wer
 * auf einer anderen Haltung aufbauen will, spreizt sie hinein:
 * `key(0.8, { ...RAISED, spineYaw: 0.4 })`.
 */
export function key(t: number, overrides: PartialPose = {}, easing: Ease = 'smooth', flow = 0): Key {
  return { t, pose: pose(overrides), ease: easing, flow };
}

export type Track = readonly Key[];

/**
 * Wertet eine Folge von Stuetzhaltungen bei `t` (0..1) aus.
 *
 * Zwischen zwei Stuetzhaltungen laeuft jeder Kanal auf einer Hermite-Kurve.
 * Mit `flow` = 0 an beiden Enden ist das eine gerade Ueberblendung im
 * gewaehlten Zeitverlauf; mit `flow` > 0 traegt die Kurve die Geschwindigkeit
 * aus den Nachbarhaltungen durch - Haende und Klinge laufen dann in Boegen
 * statt von Punkt zu Punkt zu ruckeln.
 */
export function sampleTrack(keys: Track, t: number, out: Pose): void {
  const last = keys.length - 1;
  if (t <= keys[0].t) {
    copyPose(keys[0].pose, out);
    return;
  }
  if (t >= keys[last].t) {
    copyPose(keys[last].pose, out);
    return;
  }
  let i = 1;
  while (i < last && t > keys[i].t) i++;
  const k0 = keys[i - 1];
  const k1 = keys[i];
  const span = k1.t - k0.t;
  const w = span > 0 ? ease((t - k0.t) / span, k1.ease) : 1;
  const before = i >= 2 ? keys[i - 2] : null;
  const after = i < last ? keys[i + 1] : null;

  const w2 = w * w;
  const w3 = w2 * w;
  const h00 = 2 * w3 - 3 * w2 + 1;
  const h10 = w3 - 2 * w2 + w;
  const h01 = -2 * w3 + 3 * w2;
  const h11 = w3 - w2;

  for (const k of POSE_KEYS) {
    const p0 = k0.pose[k];
    const p1 = k1.pose[k];
    const chord = p1 - p0;
    // Steigung an beiden Enden: gerade Sehne, mit `flow` zur Durchfahrt hin verschoben.
    let m0 = chord;
    let m1 = chord;
    if (before && k0.flow > 0) {
      const through = ((p1 - before.pose[k]) / (k1.t - before.t)) * span;
      m0 += (through - chord) * k0.flow;
    }
    if (after && k1.flow > 0) {
      const through = ((after.pose[k] - p0) / (after.t - k0.t)) * span;
      m1 += (through - chord) * k1.flow;
    }
    out[k] = h00 * p0 + h10 * m0 + h01 * p1 + h11 * m1;
  }
}

// ---------------------------------------------------------------------------
// Nachfuehren: Die Figur folgt ihrer Zielhaltung mit etwas Masse
// ---------------------------------------------------------------------------

/**
 * Exakter Schritt einer gedaempften Feder von `x` (Geschwindigkeit `v`) auf
 * `target` zu. `omega` = Steifigkeit (rad/s), `zeta` = Daempfung (1 = ohne
 * Nachschwingen). Stabil bei jeder Bildrate. Ergebnis in `SPRING`.
 */
export const SPRING = { x: 0, v: 0 };

export function springStep(x: number, v: number, target: number, omega: number, zeta: number, dt: number): void {
  const x0 = x - target;
  if (zeta >= 1) {
    const e = Math.exp(-omega * dt);
    const tmp = (v + omega * x0) * dt;
    SPRING.x = target + (x0 + tmp) * e;
    SPRING.v = (v - omega * tmp) * e;
    return;
  }
  const wd = omega * Math.sqrt(1 - zeta * zeta);
  const e = Math.exp(-zeta * omega * dt);
  const c = Math.cos(wd * dt);
  const s = Math.sin(wd * dt);
  const b = (v + zeta * omega * x0) / wd;
  SPRING.x = target + e * (x0 * c + b * s);
  SPRING.v = e * ((b * wd - zeta * omega * x0) * c - (x0 * wd + zeta * omega * b) * s);
}

/** Steifigkeit und Daempfung, mit der ein Kanal seinem Ziel folgt. */
interface Follow {
  omega: number;
  zeta: number;
}

/** Der Koerper folgt straff und ohne Nachschwingen. */
const FOLLOW_BODY: Follow = { omega: 62, zeta: 1 };
/** Die Klinge ist das Ende der Kette: Sie hinkt nach und schwingt leicht ueber. */
const FOLLOW_BLADE: Follow = { omega: 46, zeta: 0.62 };
/** Der schwere Helm kommt eine Spur spaeter als der Rumpf. */
const FOLLOW_HEAD: Follow = { omega: 38, zeta: 0.8 };
/** Der Schild haengt am Arm und pendelt kurz nach. */
const FOLLOW_SHIELD: Follow = { omega: 44, zeta: 0.7 };

const FOLLOW: Partial<Record<PoseKey, Follow>> = {
  bladeX: FOLLOW_BLADE, bladeY: FOLLOW_BLADE, bladeZ: FOLLOW_BLADE, bladeRoll: FOLLOW_BLADE,
  headPitch: FOLLOW_HEAD, headYaw: FOLLOW_HEAD, headRoll: FOLLOW_HEAD,
  shieldX: FOLLOW_SHIELD, shieldY: FOLLOW_SHIELD, shieldZ: FOLLOW_SHIELD,
};

/** Laufende Haltung samt Geschwindigkeit je Kanal. */
export class PoseFollower {
  readonly pose = newPose();
  private readonly velocity = newPose();
  private started = false;

  constructor() {
    for (const k of POSE_KEYS) this.velocity[k] = 0;
  }

  /** Sofort auf die Zielhaltung springen (Start, Neustart). */
  reset(target: Pose): void {
    copyPose(target, this.pose);
    for (const k of POSE_KEYS) this.velocity[k] = 0;
    this.started = true;
  }

  /**
   * `gain` < 1 laesst die Figur weicher folgen (z. B. beim Zuruecksinken in
   * die Grundhaltung), 1 = normal.
   */
  step(target: Pose, dtSeconds: number, gain = 1): void {
    if (!this.started || dtSeconds <= 0) {
      if (!this.started) this.reset(target);
      return;
    }
    // Lange Bilder (Tab war im Hintergrund) nicht als einen Riesenschritt rechnen.
    const dt = Math.min(dtSeconds, 0.1);
    for (const k of POSE_KEYS) {
      let goal = target[k];
      if (ANGLE_KEYS.has(k)) {
        const delta = goal - this.pose[k];
        goal = this.pose[k] + ((((delta + Math.PI) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)) - Math.PI;
      }
      const f = FOLLOW[k] ?? FOLLOW_BODY;
      springStep(this.pose[k], this.velocity[k], goal, f.omega * gain, f.zeta, dt);
      this.pose[k] = SPRING.x;
      this.velocity[k] = SPRING.v;
    }
  }
}

// ---------------------------------------------------------------------------
// Was ein Ablauf wissen muss
// ---------------------------------------------------------------------------

/** Ausruestung: Sie entscheidet, was die Arme tun. */
export type Loadout = 'shield' | 'sword' | 'fists';

export function loadoutOf(input: { shield: boolean; weaponBroken: boolean }): Loadout {
  if (input.weaponBroken) return 'fists';
  return input.shield ? 'shield' : 'sword';
}

/** Bezugspunkt der Hand-Zielpunkte: Brustknochen der aufrechten Figur. */
export const CHEST_REST = { x: 0, y: CHEST_REST_Y, z: 0 } as const;
/** Rechtes Schultergelenk im Brust-Raum (links: x gespiegelt). */
export const SHOULDER_REST = { x: -BODY.shoulderX, y: CHEST_REST_Y + BODY.shoulderY, z: 0 } as const;
