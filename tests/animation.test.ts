// Bewegungspruefung des Ritters.
//
// Rechnet jeden Ablauf in kleinen Schritten durch das Skelett und prueft, was
// sich ohne Hinsehen pruefen laesst: Erreicht die Hand ihr Ziel? Rutscht ein
// stehender Fuss? Steckt die Klinge im eigenen Helm? Trifft der Angriff im
// Augenblick des Einschlags den Gegner - und zwar dort, wo die Regel es sagt?
// Ob eine Bewegung GUT aussieht, entscheidet das Auge (figur.html); diese
// Pruefung faengt nur die Fehler, die man messen kann.

import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import type { ClipId, ClipPhase, FighterAnimInput } from '../src/render/fighterVisual';
import { poseForClip } from '../src/render/knight/clips';
import { POSE_KEYS, STANCE, newPose, type Loadout, type Pose } from '../src/render/knight/pose';
import { BODY, VOLUMES, type VolumeId } from '../src/render/knight/proportions';
import { KnightSkeleton, type BoneName } from '../src/render/knight/skeleton';
import { FIGHTER_GAP } from '../src/render/stage';
import { loadConfig } from './helpers';

const config = loadConfig();
const LOADOUTS: Loadout[] = ['shield', 'sword', 'fists'];
const ATTACKS = ['strike', 'left', 'right', 'kick', 'sweep', 'charge'] as const;
type Attack = (typeof ATTACKS)[number];

/** Wo der gedachte Gegner steht und wohin die Figur schaut. */
const FOCUS = new Vector3(0, 1.3, FIGHTER_GAP);

interface Sample {
  pose: Pose;
  skeleton: KnightSkeleton;
}

const skeleton = new KnightSkeleton();
const scratch = newPose();

function input(clip: ClipId, phase: ClipPhase, progress: number, durationMs: number, loadout: Loadout, clockMs = 1234): FighterAnimInput {
  return {
    clip,
    phase,
    progress,
    timeMs: progress * durationMs,
    clockMs,
    flash: 0,
    weaponBroken: loadout === 'fists',
    shield: loadout === 'shield',
    focus: null,
  };
}

/** Stellt das Skelett auf einen Augenblick eines Ablaufs (ohne Nachfuehren). */
function at(clip: ClipId, phase: ClipPhase, progress: number, durationMs: number, loadout: Loadout): Sample {
  poseForClip(input(clip, phase, progress, durationMs, loadout), scratch);
  skeleton.solve(scratch, { shield: loadout === 'shield', armed: loadout !== 'fists', focus: FOCUS });
  return { pose: scratch, skeleton };
}

const v = new Vector3();
function point(bone: BoneName, x = 0, y = 0, z = 0): Vector3 {
  return skeleton.figurePoint(bone, v, x, y, z).clone();
}

/** Punkte auf der Klinge von der Parierstange (0) bis zur Spitze (1). */
function bladePoint(u: number): Vector3 {
  return point('Sword', 0, BODY.bladeStart + (BODY.bladeEnd - BODY.bladeStart) * u, 0);
}

/** Wie tief ein Punkt in einem Koerperteil steckt: < 1 = innen, 1 = Oberflaeche. */
function depthIn(volume: VolumeId, p: Vector3): number {
  const vol = VOLUMES[volume];
  const local = skeleton.root.localToWorld(p.clone());
  skeleton.bones[vol.bone as BoneName].worldToLocal(local);
  const dx = (local.x - vol.center[0]) / vol.radius[0];
  const dy = (local.y - vol.center[1]) / vol.radius[1];
  const dz = (local.z - vol.center[2]) / vol.radius[2];
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/** Dauer einer Phase in ms, wie das Spiel sie ablaufen laesst. */
function durationOf(clip: ClipId, phase: ClipPhase): number {
  const c = config.commands;
  switch (clip) {
    case 'strike':
    case 'left':
    case 'right':
    case 'kick':
    case 'sweep':
    case 'charge':
      return phase === 'recover' ? c[clip].recoveryMs : c[clip].windupMs;
    case 'block_high':
    case 'block_left':
    case 'block_right':
      return c.block.activeMs;
    case 'roll':
      return phase === 'recover' ? c.roll.recoveryMs : c.roll.activeMs;
    case 'stagger':
      return config.fighter.interruptStaggerMs;
    case 'stunned':
      return c.kick.stunMs;
    case 'paralyzed':
      return config.block.parryStunMs;
    case 'down':
      return c.sweep.knockdownMs;
    default:
      return 2400;
  }
}

/** Alle Phasen aller Ablaeufe. */
const PHASES: [ClipId, ClipPhase][] = [
  ...ATTACKS.flatMap((a): [ClipId, ClipPhase][] => [[a, 'windup'], [a, 'recover']]),
  ['roll', 'windup'],
  ['roll', 'recover'],
  ['idle', 'hold'],
  ['block_high', 'hold'],
  ['block_left', 'hold'],
  ['block_right', 'hold'],
  ['stagger', 'hold'],
  ['stunned', 'hold'],
  ['paralyzed', 'hold'],
  ['down', 'hold'],
  ['ko', 'hold'],
  ['victory', 'hold'],
];

/** Ablaeufe, in denen die ganze Figur gedreht wird - dort gelten Boden- und Koerperregeln nicht. */
const TUMBLING: ReadonlySet<ClipId> = new Set(['roll', 'down', 'ko']);

const STEPS = 100;

function poseDistance(a: Pose, b: Pose): { key: string; delta: number } {
  let worst = { key: '', delta: 0 };
  for (const k of POSE_KEYS) {
    // Richtungen (Klinge, Schild) zaehlen nur ihrer Richtung nach - grob ueber die Differenz.
    const delta = Math.abs(a[k] - b[k]);
    if (delta > worst.delta) worst = { key: k, delta };
  }
  return worst;
}

function snapshot(clip: ClipId, phase: ClipPhase, progress: number, loadout: Loadout): Pose {
  const out = newPose();
  poseForClip(input(clip, phase, progress, durationOf(clip, phase), loadout), out);
  return out;
}

describe('Bewegungen: Grundregeln', () => {
  for (const loadout of LOADOUTS) {
    for (const [clip, phase] of PHASES) {
      it(`${clip}/${phase} (${loadout}): Haende und Fuesse erreichen ihre Ziele, nichts ist unbestimmt`, () => {
        const duration = durationOf(clip, phase);
        for (let i = 0; i <= STEPS; i++) {
          const s = at(clip, phase, i / STEPS, duration, loadout);
          for (const k of POSE_KEYS) expect(Number.isFinite(s.pose[k]), `${k} bei p=${i / STEPS}`).toBe(true);
          const o = s.skeleton.overreach;
          expect(o.armR, `rechte Hand ausser Reichweite bei p=${i / STEPS}`).toBeLessThan(0.02);
          expect(o.armL, `linke Hand ausser Reichweite bei p=${i / STEPS}`).toBeLessThan(0.02);
          expect(o.legR, `rechter Fuss ausser Reichweite bei p=${i / STEPS}`).toBeLessThan(0.02);
          expect(o.legL, `linker Fuss ausser Reichweite bei p=${i / STEPS}`).toBeLessThan(0.02);
        }
      });

      if (!TUMBLING.has(clip)) {
        it(`${clip}/${phase} (${loadout}): ein aufgesetzter Fuss rutscht nicht`, () => {
          const duration = durationOf(clip, phase);
          let last: { r: Vector3; l: Vector3; pose: Pose } | null = null;
          for (let i = 0; i <= STEPS; i++) {
            const s = at(clip, phase, i / STEPS, duration, loadout);
            const now = { r: point('Foot.R'), l: point('Foot.L'), pose: { ...s.pose } };
            if (last) {
              // Flach aufgesetzt (nicht auf der Spitze gezogen) und trotzdem unterwegs?
              const seconds = duration / STEPS / 1000;
              for (const [name, a, b, y0, y1, p0, p1] of [
                ['rechter', last.r, now.r, last.pose.footRY, now.pose.footRY, last.pose.footRPitch, now.pose.footRPitch],
                ['linker', last.l, now.l, last.pose.footLY, now.pose.footLY, last.pose.footLPitch, now.pose.footLPitch],
              ] as const) {
                const flat = y0 < 0.008 && y1 < 0.008 && p0 < 0.25 && p1 < 0.25;
                const speed = Math.hypot(b.x - a.x, b.z - a.z) / seconds;
                if (flat) expect(speed, `${name} Fuss rutscht mit ${speed.toFixed(2)} m/s bei p=${i / STEPS}`).toBeLessThan(0.25);
              }
            }
            last = now;
          }
        });

        it(`${clip}/${phase} (${loadout}): Klinge, Haende und Schild stecken nicht im eigenen Koerper`, () => {
          const duration = durationOf(clip, phase);
          for (let i = 0; i <= STEPS; i += 2) {
            at(clip, phase, i / STEPS, duration, loadout);
            const where = `bei p=${i / STEPS}`;
            for (const volume of ['helmet', 'chest', 'belly', 'hips'] as const) {
              if (loadout !== 'fists') {
                for (const u of [0.15, 0.4, 0.65, 0.9]) {
                  expect(depthIn(volume, bladePoint(u)), `Klinge (${u}) steckt in ${volume} ${where}`).toBeGreaterThan(0.9);
                }
              }
              expect(depthIn(volume, point('Hand.R')), `rechte Hand steckt in ${volume} ${where}`).toBeGreaterThan(0.8);
              expect(depthIn(volume, point('Hand.L')), `linke Hand steckt in ${volume} ${where}`).toBeGreaterThan(0.8);
            }
            if (loadout === 'shield') {
              // Schildrand gegen den Helm, Klinge gegen die Schildscheibe.
              for (let a = 0; a < 8; a++) {
                const rim = point('Shield', Math.cos((a * Math.PI) / 4) * BODY.shieldRadius, Math.sin((a * Math.PI) / 4) * BODY.shieldRadius, 0);
                expect(depthIn('helmet', rim), `Schildrand steckt im Helm ${where}`).toBeGreaterThan(0.85);
              }
              for (const u of [0.3, 0.6, 0.9]) {
                const p = skeleton.root.localToWorld(bladePoint(u));
                skeleton.bones.Shield.worldToLocal(p);
                const through = Math.abs(p.z) < 0.03 && Math.hypot(p.x, p.y) < BODY.shieldRadius * 0.9;
                expect(through, `Klinge (${u}) geht durch den eigenen Schild ${where}`).toBe(false);
              }
            }
          }
        });

        it(`${clip}/${phase} (${loadout}): das Becken bleibt ueber den Fuessen`, () => {
          const duration = durationOf(clip, phase);
          const margin = 0.38;
          for (let i = 0; i <= STEPS; i += 2) {
            const s = at(clip, phase, i / STEPS, duration, loadout);
            const p = s.pose;
            const where = `bei p=${i / STEPS}`;
            expect(p.hipZ, `Becken zu weit hinter den Fuessen ${where}`).toBeGreaterThan(Math.min(p.footRZ, p.footLZ) - margin);
            expect(p.hipZ, `Becken zu weit vor den Fuessen ${where}`).toBeLessThan(Math.max(p.footRZ, p.footLZ) + margin);
            expect(p.hipX, `Becken zu weit rechts der Fuesse ${where}`).toBeGreaterThan(Math.min(p.footRX, p.footLX) - margin);
            expect(p.hipX, `Becken zu weit links der Fuesse ${where}`).toBeLessThan(Math.max(p.footRX, p.footLX) + margin);
          }
        });
      }
    }
  }
});

describe('Bewegungen: Anschluesse', () => {
  const close = (a: Pose, b: Pose, what: string): void => {
    const worst = poseDistance(a, b);
    expect(worst.delta, `${what}: Kanal ${worst.key} springt um ${worst.delta.toFixed(3)}`).toBeLessThan(0.06);
  };
  for (const loadout of LOADOUTS) {
    for (const attack of ATTACKS) {
      it(`${attack} (${loadout}): beginnt in der Grundhaltung, Nachlauf schliesst an und endet dort`, () => {
        close(snapshot(attack, 'windup', 0, loadout), STANCE, 'Beginn des Ausholens');
        close(snapshot(attack, 'windup', 1, loadout), snapshot(attack, 'recover', 0, loadout), 'Einschlag -> Nachlauf');
        close(snapshot(attack, 'recover', 1, loadout), STANCE, 'Ende des Nachlaufs');
      });
    }
    it(`roll (${loadout}): beginnt in der Grundhaltung, Rueckweg schliesst an und endet dort`, () => {
      close(snapshot('roll', 'windup', 0, loadout), STANCE, 'Beginn der Rolle');
      const end = snapshot('roll', 'windup', 1, loadout);
      const back = snapshot('roll', 'recover', 0, loadout);
      // Eine volle Umdrehung ist dieselbe Lage.
      for (const k of ['rootPitch', 'rootYaw', 'rootRoll'] as const) {
        end[k] = ((end[k] % (Math.PI * 2)) + Math.PI * 3) % (Math.PI * 2) - Math.PI;
        back[k] = ((back[k] % (Math.PI * 2)) + Math.PI * 3) % (Math.PI * 2) - Math.PI;
      }
      close(end, back, 'Ende der Rolle -> Rueckweg');
      const done = snapshot('roll', 'recover', 1, loadout);
      for (const k of ['rootPitch', 'rootYaw', 'rootRoll'] as const) done[k] = ((done[k] % (Math.PI * 2)) + Math.PI * 3) % (Math.PI * 2) - Math.PI;
      close(done, STANCE, 'Ende des Rueckwegs');
    });
    it(`down (${loadout}): steht am Ende wieder in der Grundhaltung`, () => {
      close(snapshot('down', 'hold', 1, loadout), STANCE, 'Ende des Aufstehens');
    });
  }
});

describe('Bewegungen: Angriffe treffen, wo die Regel es sagt', () => {
  // Der Gegner steht bei z = FIGHTER_GAP; seine Vorderseite (Schild, Brust) liegt davor.
  const NEAR = FIGHTER_GAP - 0.42;
  const FAR = FIGHTER_GAP + 0.12;
  const inZone = (p: Vector3, yMin: number, yMax: number, xMax: number): boolean =>
    p.z >= NEAR && p.z <= FAR && p.y >= yMin && p.y <= yMax && Math.abs(p.x) <= xMax;

  /** Die Punkte, mit denen ein Angriff trifft. */
  function strikers(attack: Attack, loadout: Loadout): Vector3[] {
    if (attack === 'kick' || attack === 'sweep') {
      return ['Foot.R', 'Foot.L'].flatMap((f) => [point(f as BoneName, 0, -BODY.ankleHeight * 0.5, BODY.footFront), point(f as BoneName)]);
    }
    if (attack === 'charge') {
      const pts = [point('Shoulder.L'), point('Shoulder.R'), point('Hand.R'), point('Hand.L')];
      if (loadout === 'shield') pts.push(point('Shield'));
      if (loadout !== 'fists') pts.push(bladePoint(1), bladePoint(0.6));
      return pts;
    }
    if (loadout === 'fists') return [point('Hand.R'), point('Hand.L')];
    return [0.45, 0.6, 0.75, 0.9, 1].map(bladePoint);
  }

  const ZONES: Record<Attack, [number, number, number, string]> = {
    strike: [1.0, 1.8, 0.35, 'Kopf und Schultern'],
    left: [0.6, 1.5, 0.5, 'Rumpf'],
    right: [0.6, 1.5, 0.5, 'Rumpf'],
    kick: [0.4, 1.05, 0.35, 'Leib'],
    sweep: [0, 0.34, 0.45, 'Schienbein'],
    charge: [0.55, 1.55, 0.45, 'Rumpf'],
  };

  for (const loadout of LOADOUTS) {
    for (const attack of ATTACKS) {
      it(`${attack} (${loadout}): trifft im Einschlag ${ZONES[attack][3]} des Gegners`, () => {
        at(attack, 'windup', 1, durationOf(attack, 'windup'), loadout);
        const [yMin, yMax, xMax] = ZONES[attack];
        const pts = strikers(attack, loadout);
        const hit = pts.some((p) => inZone(p, yMin, yMax, xMax));
        const nearest = pts.map((p) => `(${p.x.toFixed(2)}, ${p.y.toFixed(2)}, ${p.z.toFixed(2)})`).join(' ');
        expect(hit, `kein Treffpunkt in z ${NEAR.toFixed(2)}..${FAR.toFixed(2)}, y ${yMin}..${yMax}, |x| <= ${xMax}; Treffpunkte: ${nearest}`).toBe(true);
      });
    }

    it(`left/right (${loadout}): der Hieb kommt von der angesagten Seite`, () => {
      for (const [attack, sign] of [['left', 1], ['right', -1]] as const) {
        // Kurz vor dem Einschlag ist die Waffe noch auf ihrer Seite unterwegs.
        at(attack, 'windup', 0.6, durationOf(attack, 'windup'), loadout);
        const p = loadout === 'fists' ? point('Hand.R') : bladePoint(0.8);
        const hand = loadout === 'fists' && attack === 'left' ? point('Hand.L') : p;
        expect(hand.x * sign, `${attack}: Waffe bei p=0.6 auf x=${hand.x.toFixed(2)}`).toBeGreaterThan(0.1);
      }
    });

    it(`Angriffe (${loadout}): jedes Ausholen ist frueh von jedem anderen zu unterscheiden`, () => {
      const marks = (attack: Attack, p: number): Vector3[] => {
        at(attack, 'windup', p, durationOf(attack, 'windup'), loadout);
        const pts = [point('Hand.R'), point('Hand.L'), point('Hips'), point('Head', 0, 0.3, 0), point('Foot.R'), point('Foot.L')];
        if (loadout !== 'fists') pts.push(bladePoint(1));
        return pts;
      };
      for (const p of [0.3, 0.5, 0.7]) {
        for (let i = 0; i < ATTACKS.length; i++) {
          for (let j = i + 1; j < ATTACKS.length; j++) {
            const a = marks(ATTACKS[i], p);
            const b = marks(ATTACKS[j], p);
            const apart = Math.max(...a.map((pt, k) => pt.distanceTo(b[k])));
            expect(apart, `${ATTACKS[i]} und ${ATTACKS[j]} sehen bei p=${p} zu aehnlich aus`).toBeGreaterThan(0.3);
          }
        }
      }
    });
  }
});
