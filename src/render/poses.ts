// Prozedurale Haltungen der Grundformen-Figur.
//
// Eine Haltung (`Pose`) beschreibt die Figur in ihrem eigenen Koordinatensystem:
// +Z zeigt zum Gegner, +X ist IHRE linke Seite, +Y ist oben, Masse in Metern.
// Haende und Fuesse werden als Zielpunkte angegeben; Ellbogen und Knie
// errechnet die Figur selbst (primitiveFighter.ts). Dadurch laesst sich eine
// Haltung als "Schwerthand hier, Klinge zeigt dorthin" hinschreiben.
//
// Jeder Angriff hat eine eigene, gut lesbare Ausholhaltung, die frueh
// erreicht und dann gehalten wird; der eigentliche Hieb liegt im letzten
// Fuenftel des Ausholens:
//   strike  Schwert mit beiden Haenden hoch ueber dem Kopf
//   left    Koerper verdreht, Schwert waagrecht weit auf der LINKEN Seite
//   right   dasselbe auf der RECHTEN Seite
//   kick    zurueckgelehnt, rechtes Knie hochgezogen
//   sweep   tief in der Hocke, rechtes Bein weit nach hinten-aussen gestreckt
//   charge  ein Schritt zurueck, geduckt, Schwert wie eine Lanze nach vorn

import type { FighterAnimInput } from './fighterVisual';

export interface Pose {
  // ganze Figur: Verschiebung und Drehung um den Punkt (0, pivotY, 0)
  offX: number;
  offY: number;
  offZ: number;
  rotX: number;
  rotY: number;
  rotZ: number;
  pivotY: number;
  // Becken
  pelvisX: number;
  pelvisY: number;
  pelvisZ: number;
  // Rumpf: vorbeugen (+), nach links drehen (+), nach links neigen (+)
  torsoPitch: number;
  torsoYaw: number;
  torsoRoll: number;
  headPitch: number;
  headYaw: number;
  // Schwerthand (rechts) und Klingenrichtung
  handRX: number;
  handRY: number;
  handRZ: number;
  bladeX: number;
  bladeY: number;
  bladeZ: number;
  // linke Hand; grip 1 = am Schwertgriff, 0 = am freien Zielpunkt
  handLX: number;
  handLY: number;
  handLZ: number;
  grip: number;
  // Knoechel
  footRX: number;
  footRY: number;
  footRZ: number;
  footLX: number;
  footLY: number;
  footLZ: number;
}

export const POSE_KEYS = [
  'offX', 'offY', 'offZ', 'rotX', 'rotY', 'rotZ', 'pivotY',
  'pelvisX', 'pelvisY', 'pelvisZ',
  'torsoPitch', 'torsoYaw', 'torsoRoll', 'headPitch', 'headYaw',
  'handRX', 'handRY', 'handRZ', 'bladeX', 'bladeY', 'bladeZ',
  'handLX', 'handLY', 'handLZ', 'grip',
  'footRX', 'footRY', 'footRZ', 'footLX', 'footLY', 'footLZ',
] as const satisfies readonly (keyof Pose)[];

/** Drehungen der ganzen Figur: werden auf kuerzestem Weg ueberblendet. */
export const ANGLE_KEYS: ReadonlySet<keyof Pose> = new Set(['rotX', 'rotY', 'rotZ']);

type P = Partial<Pose>;

/** Grundhaltung: Schwertseite vorn, Klinge zeigt auf den Gegner. */
export const GUARD: Pose = {
  offX: 0, offY: 0, offZ: 0, rotX: 0, rotY: 0, rotZ: 0, pivotY: 0.5,
  pelvisX: 0, pelvisY: 0.88, pelvisZ: 0,
  torsoPitch: 0.1, torsoYaw: 0.3, torsoRoll: 0, headPitch: 0, headYaw: -0.25,
  handRX: -0.16, handRY: 1.08, handRZ: 0.42,
  bladeX: 0.12, bladeY: 0.8, bladeZ: 0.58,
  handLX: 0.3, handLY: 1.02, handLZ: 0.12, grip: 0,
  footRX: -0.15, footRY: 0.07, footRZ: 0.2,
  footLX: 0.17, footLY: 0.07, footLZ: -0.18,
};

function pose(overrides: P): Pose {
  return { ...GUARD, ...overrides };
}

export function copyPose(from: Pose, to: Pose): void {
  for (const k of POSE_KEYS) to[k] = from[k];
}

export function newPose(): Pose {
  return { ...GUARD };
}

type Ease = 'smooth' | 'in' | 'out' | 'linear';

interface Key {
  t: number;
  pose: Pose;
  ease: Ease;
}

function key(t: number, overrides: P, ease: Ease = 'smooth'): Key {
  return { t, pose: pose(overrides), ease };
}

function easeValue(u: number, ease: Ease): number {
  if (u <= 0) return 0;
  if (u >= 1) return 1;
  switch (ease) {
    case 'in':
      return u * u * u;
    case 'out':
      return 1 - (1 - u) * (1 - u) * (1 - u);
    case 'linear':
      return u;
    default:
      return u * u * (3 - 2 * u);
  }
}

function mix(a: Pose, b: Pose, u: number, out: Pose): void {
  for (const k of POSE_KEYS) out[k] = a[k] + (b[k] - a[k]) * u;
}

/** Wertet eine Folge von Stuetzhaltungen bei `t` (0..1) aus. */
function track(keys: readonly Key[], t: number, out: Pose): void {
  if (t <= keys[0].t) {
    copyPose(keys[0].pose, out);
    return;
  }
  for (let i = 1; i < keys.length; i++) {
    if (t <= keys[i].t) {
      const span = keys[i].t - keys[i - 1].t;
      const u = span > 0 ? (t - keys[i - 1].t) / span : 1;
      mix(keys[i - 1].pose, keys[i].pose, easeValue(u, keys[i].ease), out);
      return;
    }
  }
  copyPose(keys[keys.length - 1].pose, out);
}

// ---------------------------------------------------------------------------
// strike: Schlag von oben
// ---------------------------------------------------------------------------

const STRIKE_RAISED: P = {
  offZ: -0.12, pelvisY: 0.9, torsoPitch: -0.2, torsoYaw: 0.05, headYaw: 0,
  handRX: -0.1, handRY: 1.9, handRZ: -0.12, bladeX: 0, bladeY: 0.7, bladeZ: -0.72, grip: 1,
  footRX: -0.15, footRZ: 0.1, footLX: 0.17, footLZ: -0.3,
};
const STRIKE_IMPACT: P = {
  offZ: 0.92, pelvisY: 0.8, torsoPitch: 0.42, torsoYaw: 0, headYaw: 0, headPitch: -0.25,
  handRX: -0.06, handRY: 1.32, handRZ: 0.58, bladeX: 0, bladeY: -0.12, bladeZ: 0.99, grip: 1,
  footRX: -0.15, footRZ: 0.48, footLX: 0.17, footLZ: -0.35,
};
const STRIKE_WINDUP: Key[] = [
  key(0, {}),
  key(0.26, STRIKE_RAISED),
  key(0.78, { ...STRIKE_RAISED, torsoPitch: -0.27, handRY: 1.92, bladeY: 0.5, bladeZ: -0.87 }),
  key(1, STRIKE_IMPACT, 'in'),
];
const STRIKE_RECOVER: Key[] = [
  key(0, STRIKE_IMPACT),
  key(0.4, { ...STRIKE_IMPACT, offZ: 0.75, pelvisY: 0.78, torsoPitch: 0.5, handRY: 0.85, handRZ: 0.55, bladeY: -0.65, bladeZ: 0.76 }, 'out'),
  key(1, {}),
];

// ---------------------------------------------------------------------------
// left / right: Schlag von der Seite
// ---------------------------------------------------------------------------

const LEFT_RAISED: P = {
  offX: 0.14, offZ: -0.08, pelvisY: 0.86, torsoPitch: 0.05, torsoYaw: 0.85, torsoRoll: 0.12, headYaw: -0.7,
  handRX: 0.4, handRY: 1.42, handRZ: 0.12, bladeX: 0.92, bladeY: 0.38, bladeZ: -0.1, grip: 1,
  footRX: -0.12, footRZ: 0.22, footLX: 0.3, footLZ: -0.22,
};
const LEFT_IMPACT: P = {
  offZ: 0.92, pelvisY: 0.82, torsoPitch: 0.2, torsoYaw: -0.15, headYaw: 0,
  handRX: -0.02, handRY: 1.28, handRZ: 0.6, bladeX: 0.18, bladeY: 0, bladeZ: 0.98, grip: 1,
  footRX: -0.15, footRZ: 0.48, footLX: 0.17, footLZ: -0.35,
};
const LEFT_WINDUP: Key[] = [
  key(0, {}),
  key(0.26, LEFT_RAISED),
  key(0.78, { ...LEFT_RAISED, torsoYaw: 0.95, bladeX: 0.95, bladeY: 0.28, bladeZ: -0.16 }),
  key(0.9, { ...LEFT_IMPACT, offX: 0.06, offZ: 0.45, torsoYaw: 0.35, handRX: 0.2, handRY: 1.34, handRZ: 0.5, bladeX: 0.8, bladeY: 0.05, bladeZ: 0.6 }, 'in'),
  key(1, LEFT_IMPACT, 'linear'),
];
const LEFT_RECOVER: Key[] = [
  key(0, LEFT_IMPACT),
  key(0.35, { ...LEFT_IMPACT, offZ: 0.8, torsoYaw: -0.7, handRX: -0.42, handRY: 1.18, handRZ: 0.38, bladeX: -0.85, bladeY: -0.12, bladeZ: 0.5, grip: 0.4 }, 'out'),
  key(1, {}),
];

const RIGHT_RAISED: P = {
  offX: -0.14, offZ: -0.08, pelvisY: 0.86, torsoPitch: 0.05, torsoYaw: -0.75, torsoRoll: -0.12, headYaw: 0.6,
  handRX: -0.66, handRY: 1.42, handRZ: 0, bladeX: -0.92, bladeY: 0.38, bladeZ: -0.1, grip: 0,
  handLX: 0.22, handLY: 1.25, handLZ: 0.4,
  footRX: -0.3, footRZ: -0.2, footLX: 0.12, footLZ: 0.22,
};
const RIGHT_IMPACT: P = {
  offZ: 0.92, pelvisY: 0.82, torsoPitch: 0.2, torsoYaw: 0.35, headYaw: -0.3,
  handRX: -0.1, handRY: 1.28, handRZ: 0.6, bladeX: -0.18, bladeY: 0, bladeZ: 0.98, grip: 0,
  handLX: 0.32, handLY: 1.1, handLZ: 0.05,
  footRX: -0.15, footRZ: 0.48, footLX: 0.17, footLZ: -0.35,
};
const RIGHT_WINDUP: Key[] = [
  key(0, {}),
  key(0.26, RIGHT_RAISED),
  key(0.78, { ...RIGHT_RAISED, torsoYaw: -0.85, bladeX: -0.95, bladeY: 0.28, bladeZ: -0.16 }),
  key(0.9, { ...RIGHT_IMPACT, offX: -0.06, offZ: 0.45, torsoYaw: -0.2, handRX: -0.4, handRY: 1.34, handRZ: 0.42, bladeX: -0.8, bladeY: 0.05, bladeZ: 0.6 }, 'in'),
  key(1, RIGHT_IMPACT, 'linear'),
];
const RIGHT_RECOVER: Key[] = [
  key(0, RIGHT_IMPACT),
  key(0.35, { ...RIGHT_IMPACT, offZ: 0.8, torsoYaw: 0.8, handRX: 0.3, handRY: 1.18, handRZ: 0.45, bladeX: 0.85, bladeY: -0.12, bladeZ: 0.5 }, 'out'),
  key(1, {}),
];

// ---------------------------------------------------------------------------
// kick: Tritt
// ---------------------------------------------------------------------------

const KICK_CHAMBER: P = {
  offZ: 0.15, pelvisY: 0.92, torsoPitch: -0.22, torsoYaw: 0.1, headYaw: -0.1,
  handRX: -0.52, handRY: 1.05, handRZ: -0.12, bladeX: -0.35, bladeY: 0.55, bladeZ: -0.75,
  handLX: 0.34, handLY: 1.22, handLZ: 0.28,
  footRX: -0.1, footRY: 0.78, footRZ: 0.3, footLX: 0.1, footLZ: -0.05,
};
const KICK_IMPACT: P = {
  ...KICK_CHAMBER,
  offZ: 1.42, torsoPitch: -0.42, handRZ: -0.2, handLZ: 0.2,
  footRX: -0.06, footRY: 1.02, footRZ: 0.88, footLZ: -0.1,
};
const KICK_WINDUP: Key[] = [
  key(0, {}),
  key(0.28, KICK_CHAMBER),
  key(0.8, { ...KICK_CHAMBER, torsoPitch: -0.28, footRY: 0.86, footRZ: 0.28 }),
  key(1, KICK_IMPACT, 'in'),
];
const KICK_RECOVER: Key[] = [
  key(0, KICK_IMPACT),
  key(0.4, { ...KICK_CHAMBER, offZ: 1.0, torsoPitch: -0.1, footRY: 0.55, footRZ: 0.35 }, 'out'),
  key(1, {}),
];

// ---------------------------------------------------------------------------
// sweep: Beinfeger
// ---------------------------------------------------------------------------

const SWEEP_COIL: P = {
  offZ: 0.1, pelvisY: 0.46, torsoPitch: 0.55, torsoYaw: -0.75, headYaw: 0.5, headPitch: -0.3,
  handRX: -0.5, handRY: 0.62, handRZ: -0.22, bladeX: -0.55, bladeY: 0.25, bladeZ: -0.8,
  handLX: 0.32, handLY: 0.1, handLZ: 0.3,
  footRX: -0.78, footRZ: -0.28, footLX: 0.12, footLZ: 0.1,
};
const SWEEP_IMPACT: P = {
  ...SWEEP_COIL,
  offZ: 1.5, pelvisY: 0.44, torsoPitch: 0.35, torsoYaw: 0.6, headYaw: -0.3,
  handRX: -0.45, handRY: 0.7, handRZ: -0.1, handLZ: 0.2,
  footRX: 0.1, footRY: 0.1, footRZ: 0.88, footLX: 0.14, footLZ: -0.05,
};
const SWEEP_WINDUP: Key[] = [
  key(0, {}),
  key(0.28, SWEEP_COIL),
  key(0.8, { ...SWEEP_COIL, torsoYaw: -0.9, pelvisY: 0.43 }),
  key(0.9, { ...SWEEP_IMPACT, offZ: 0.9, torsoYaw: 0, footRX: -0.6, footRZ: 0.5 }, 'in'),
  key(1, SWEEP_IMPACT, 'linear'),
];
const SWEEP_RECOVER: Key[] = [
  key(0, SWEEP_IMPACT),
  key(0.5, { offZ: 0.9, pelvisY: 0.6, torsoPitch: 0.3, footRX: -0.15, footRZ: 0.3 }, 'out'),
  key(1, {}),
];

// ---------------------------------------------------------------------------
// charge: Ansturm
// ---------------------------------------------------------------------------

const CHARGE_RUN_FROM = 0.52;
const CHARGE_RUN_TO = 0.96;
const CHARGE_COIL: P = {
  offZ: -0.55, pelvisY: 0.7, torsoPitch: 0.55, torsoYaw: 0.2, headPitch: -0.4, headYaw: -0.15,
  handRX: -0.3, handRY: 0.8, handRZ: 0.1, bladeX: 0.05, bladeY: 0.06, bladeZ: 1, grip: 1,
  footRX: -0.16, footRZ: -0.5, footLX: 0.15, footLZ: 0.22,
};
const CHARGE_IMPACT: P = {
  offZ: 1.02, pelvisY: 0.76, torsoPitch: 0.5, torsoYaw: 0.1, headPitch: -0.35, headYaw: -0.1,
  handRX: -0.14, handRY: 1.12, handRZ: 0.62, bladeX: 0, bladeY: 0.02, bladeZ: 1, grip: 1,
  footRX: -0.15, footRZ: 0.5, footLX: 0.17, footLZ: -0.4,
};
const CHARGE_WINDUP: Key[] = [
  key(0, {}),
  key(0.2, CHARGE_COIL),
  key(CHARGE_RUN_FROM, { ...CHARGE_COIL, offZ: -0.62, pelvisY: 0.66 }),
  key(CHARGE_RUN_TO, { ...CHARGE_COIL, offZ: 0.85, pelvisY: 0.74, torsoPitch: 0.6, handRY: 0.85, handRZ: 0.2, footRZ: 0, footLZ: 0 }, 'in'),
  key(1, CHARGE_IMPACT, 'linear'),
];
const CHARGE_RECOVER: Key[] = [
  key(0, CHARGE_IMPACT),
  key(0.3, { ...CHARGE_IMPACT, offZ: 0.9, handRZ: 0.5 }, 'out'),
  key(1, {}),
];

// ---------------------------------------------------------------------------
// Block, Rolle, Treffer-Zustaende
// ---------------------------------------------------------------------------

/** Schwert waagrecht ueber dem Kopf. */
const BLOCK_HIGH = pose({
  pelvisY: 0.82, torsoPitch: -0.02, torsoYaw: 0, headYaw: 0,
  handRX: -0.4, handRY: 1.74, handRZ: 0.34, bladeX: 1, bladeY: 0.1, bladeZ: 0,
  handLX: 0.36, handLY: 1.78, handLZ: 0.34,
  footRX: -0.2, footRZ: 0.12, footLX: 0.2, footLZ: -0.12,
});
/** Schwert senkrecht auf der linken Seite. */
const BLOCK_LEFT = pose({
  offX: 0.05, pelvisY: 0.84, torsoYaw: 0.5, headYaw: -0.3,
  handRX: 0.26, handRY: 1.08, handRZ: 0.36, bladeX: 0.1, bladeY: 1, bladeZ: 0.05, grip: 1,
  footRX: -0.12, footRZ: 0.2, footLX: 0.28, footLZ: -0.05,
});
/** Schwert senkrecht auf der rechten Seite. */
const BLOCK_RIGHT = pose({
  offX: -0.05, pelvisY: 0.84, torsoYaw: -0.4, headYaw: 0.3,
  handRX: -0.52, handRY: 1.02, handRZ: 0.32, bladeX: -0.1, bladeY: 1, bladeZ: 0.05,
  handLX: 0.05, handLY: 1.15, handLZ: 0.42,
  footRX: -0.28, footRZ: 0.05, footLX: 0.14, footLZ: 0.12,
});
/** So schnell steht die Blockhaltung (ms). Reine Darstellung; die Regel gilt ab Befehl. */
const BLOCK_SNAP_MS = 90;

const ROLL_TUCK = pose({
  pelvisY: 0.46, pivotY: 0.46, torsoPitch: 1.0, torsoYaw: 0, headPitch: 0.5, headYaw: 0,
  handRX: -0.16, handRY: 0.62, handRZ: 0.34, bladeX: 0.6, bladeY: 0.3, bladeZ: 0.7,
  handLX: 0.16, handLY: 0.62, handLZ: 0.34,
  footRX: -0.12, footRY: 0.16, footRZ: 0.22, footLX: 0.12, footLY: 0.16, footLZ: 0.22,
});
/** Wie weit die Rolle zur Seite traegt (m). */
const ROLL_DISTANCE = 1.15;

const STAGGER = pose({
  offZ: -0.18, pelvisY: 0.84, torsoPitch: -0.32, headPitch: -0.3,
  handRX: -0.45, handRY: 1.25, handRZ: 0.1, bladeX: -0.3, bladeY: 0.8, bladeZ: 0.3,
  handLX: 0.45, handLY: 1.2, handLZ: 0.05,
});
const STUNNED = pose({
  offZ: -0.28, pelvisY: 0.76, torsoPitch: 0.78, torsoYaw: 0, headPitch: 0.5, headYaw: 0,
  handRX: -0.14, handRY: 0.8, handRZ: 0.22, bladeX: 0.5, bladeY: -0.75, bladeZ: 0.3,
  handLX: 0.14, handLY: 0.8, handLZ: 0.24,
  footRX: -0.2, footRZ: 0.05, footLX: 0.2, footLZ: -0.08,
});
const PARALYZED = pose({
  offZ: -0.22, pelvisY: 0.86, torsoPitch: -0.34, torsoYaw: -0.35, headPitch: -0.35, headYaw: 0.2,
  handRX: -0.7, handRY: 1.62, handRZ: -0.22, bladeX: -0.45, bladeY: 0.65, bladeZ: -0.6,
  handLX: 0.62, handLY: 1.15, handLZ: -0.05,
  footRX: -0.22, footRZ: -0.1, footLX: 0.2, footLZ: 0.15,
});
const LYING = pose({
  rotX: -Math.PI / 2, offY: 0.16, offZ: -0.35, pivotY: 0,
  pelvisY: 0.9, torsoPitch: 0, torsoYaw: 0, headPitch: -0.1, headYaw: 0,
  handRX: -0.62, handRY: 1.25, handRZ: 0.05, bladeX: -0.9, bladeY: 0.2, bladeZ: 0.1,
  handLX: 0.62, handLY: 1.25, handLZ: 0.05,
  footRX: -0.2, footRZ: 0, footLX: 0.2, footLZ: 0,
});
const GET_UP = pose({
  offZ: -0.2, pivotY: 0, pelvisY: 0.55, torsoPitch: 0.6, headPitch: -0.2,
  handLX: 0.3, handLY: 0.15, handLZ: 0.2,
  footRX: -0.2, footRZ: 0.1, footLX: 0.2, footLZ: -0.15,
});
const DOWN_TRACK: Key[] = [
  { t: 0, pose: pose({ pivotY: 0 }), ease: 'smooth' },
  { t: 0.16, pose: LYING, ease: 'in' },
  { t: 0.7, pose: LYING, ease: 'linear' },
  { t: 0.88, pose: GET_UP, ease: 'smooth' },
  { t: 1, pose: pose({ pivotY: 0 }), ease: 'smooth' },
];
/** Dauer des Umfallens beim K.o. (ms). */
const KO_FALL_MS = 450;
const KO_LYING = pose({
  ...LYING, offZ: -0.5,
  handRX: -0.75, handRY: 1.05, handLX: 0.7, handLY: 1.4,
  footRX: -0.3, footLX: 0.26,
});
const VICTORY = pose({
  pelvisY: 0.9, torsoPitch: -0.08, torsoYaw: 0.1, headPitch: -0.2, headYaw: 0,
  handRX: -0.3, handRY: 1.92, handRZ: 0.05, bladeX: 0, bladeY: 1, bladeZ: 0,
  handLX: 0.36, handLY: 1.0, handLZ: 0.1,
});

const WINDUP_TRACKS: Record<string, Key[]> = {
  strike: STRIKE_WINDUP,
  left: LEFT_WINDUP,
  right: RIGHT_WINDUP,
  kick: KICK_WINDUP,
  sweep: SWEEP_WINDUP,
  charge: CHARGE_WINDUP,
};
const RECOVER_TRACKS: Record<string, Key[]> = {
  strike: STRIKE_RECOVER,
  left: LEFT_RECOVER,
  right: RIGHT_RECOVER,
  kick: KICK_RECOVER,
  sweep: SWEEP_RECOVER,
  charge: CHARGE_RECOVER,
};

function smooth01(u: number): number {
  return easeValue(u, 'smooth');
}

/** Berechnet die Zielhaltung fuer den aktuellen Ablauf. */
export function poseFor(input: FighterAnimInput, out: Pose): void {
  const p = input.progress;
  const clock = input.clockMs;

  switch (input.clip) {
    case 'strike':
    case 'left':
    case 'right':
    case 'kick':
    case 'sweep':
    case 'charge': {
      const tracks = input.phase === 'recover' ? RECOVER_TRACKS : WINDUP_TRACKS;
      track(tracks[input.clip], p, out);
      if (input.phase === 'windup') {
        // Spannung in der gehaltenen Ausholhaltung: leichtes Zittern.
        out.handRX += 0.008 * Math.sin(clock * 0.045);
        out.handRY += 0.006 * Math.sin(clock * 0.038);
        if (input.clip === 'charge' && p > CHARGE_RUN_FROM && p < CHARGE_RUN_TO) {
          // Laufschritte waehrend des Anlaufs.
          const u = (p - CHARGE_RUN_FROM) / (CHARGE_RUN_TO - CHARGE_RUN_FROM);
          const stride = u * Math.PI * 2 * 2.5;
          out.footRZ += 0.38 * Math.sin(stride);
          out.footRY += 0.2 * Math.max(0, Math.cos(stride));
          out.footLZ -= 0.38 * Math.sin(stride);
          out.footLY += 0.2 * Math.max(0, -Math.cos(stride));
          out.pelvisY += 0.03 * Math.abs(Math.sin(stride));
        }
      }
      return;
    }
    case 'block_high':
    case 'block_left':
    case 'block_right': {
      const target =
        input.clip === 'block_left' ? BLOCK_LEFT : input.clip === 'block_right' ? BLOCK_RIGHT : BLOCK_HIGH;
      mix(GUARD, target, smooth01(input.timeMs / BLOCK_SNAP_MS), out);
      return;
    }
    case 'roll': {
      if (input.phase === 'windup') {
        // Einkugeln, einmal um die Laengsachse zur rechten Seite rollen.
        const tuck = Math.min(smooth01(p / 0.15), 1 - smooth01((p - 0.85) / 0.15));
        mix(GUARD, ROLL_TUCK, tuck, out);
        const travel = smooth01(p);
        out.pivotY = ROLL_TUCK.pivotY;
        out.offX = -ROLL_DISTANCE * travel;
        out.rotZ = Math.PI * 2 * travel;
      } else {
        // Zurueck auf den Platz.
        copyPose(GUARD, out);
        out.pelvisY = 0.7 + 0.18 * smooth01(p);
        out.offX = -ROLL_DISTANCE * (1 - smooth01(p));
      }
      return;
    }
    case 'stagger':
      copyPose(STAGGER, out);
      return;
    case 'stunned':
      copyPose(STUNNED, out);
      out.torsoRoll = 0.14 * Math.sin(clock * 0.011);
      out.offX = 0.05 * Math.sin(clock * 0.007);
      return;
    case 'paralyzed':
      copyPose(PARALYZED, out);
      out.handRX += 0.012 * Math.sin(clock * 0.09);
      out.torsoRoll = 0.02 * Math.sin(clock * 0.07);
      return;
    case 'down':
      track(DOWN_TRACK, p, out);
      return;
    case 'ko':
      mix(pose({ pivotY: 0 }), KO_LYING, easeValue(input.timeMs / KO_FALL_MS, 'in'), out);
      return;
    case 'victory':
      copyPose(VICTORY, out);
      out.handRY += 0.03 * Math.sin(clock * 0.006);
      out.pelvisY += 0.015 * Math.sin(clock * 0.006);
      return;
    case 'idle':
    default:
      copyPose(GUARD, out);
      // Atmen.
      out.pelvisY += 0.012 * Math.sin(clock * 0.0028);
      out.handRY += 0.015 * Math.sin(clock * 0.0028 + 1);
      out.bladeX += 0.03 * Math.sin(clock * 0.0019);
      return;
  }
}
