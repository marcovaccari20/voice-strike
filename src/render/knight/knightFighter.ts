// Der Ritter als Figur fuer die Szene: Skelett + Netz + Bewegung.
//
// Je Bild:
//   1. Der Ablauf (clips/) nennt die Zielhaltung fuer diesen Augenblick.
//   2. Die Figur folgt ihr mit etwas Masse (PoseFollower): Der Koerper
//      straff, Klinge, Kopf und Schild schwingen leicht nach.
//   3. Darueber liegen Atmen und der Ruck eines Treffers.
//   4. Das Skelett rechnet daraus die Gelenke (Arme, Beine, Fussaufsatz,
//      Blick zum Gegner).
//   5. Helmbusch und Wappenrock federn hinterher.

import { Vector3 } from 'three';
import type { FighterAnimInput, FighterVisual, FighterVisualFactory, FighterVisualOptions } from '../fighterVisual';
import { poseForClip } from './clips';
import { SpringChain, type ChainSettings } from './dynamics';
import { PoseFollower, SPRING, copyPose, newPose, springStep } from './pose';
import { BODY } from './proportions';
import { KnightSkeleton } from './skeleton';
import type { KnightMesh, KnightMeshBuilder } from './types';

/** Hoehe des Warnzeichens ueber dem Helm (m). */
const HEAD_ANCHOR_UP = 0.36;

/** Atemzug in Ruhe (ms) und wie weit er Schultern und Brust bewegt. */
const BREATH_MS = 3100;
const BREATH_SHRUG = 0.16;
const BREATH_PITCH = 0.012;

/** Treffer-Ruck: Feder, die nach einem Schlag zurueckschwingt. */
const RECOIL_OMEGA = 21;
const RECOIL_ZETA = 0.42;
/** Stoss je voller Trefferstaerke (1/s). */
const RECOIL_KICK = 11;
/** Wie weit der Ruck Rumpf, Kopf und Becken auslenkt. */
const RECOIL_SPINE = 0.42;
const RECOIL_HEAD = 0.3;
const RECOIL_HIP = 0.06;
const RECOIL_ROLL = 0.16;

/**
 * In diese Ablaeufe sinkt die Figur weich zurueck, statt hineinzuschnappen:
 * Ein abgebrochener Scheinangriff oder ein beendeter Block geht in Ruhe in
 * die Grundhaltung ueber. Alles andere (Block, Treffer) kommt sofort.
 */
const SOFT_ENTRY: ReadonlySet<string> = new Set(['idle', 'victory']);
/** So lange dauert das weiche Zuruecksinken (s) und so viel schwaecher folgt die Figur anfangs. */
const SOFT_SECONDS = 0.32;
const SOFT_GAIN = 0.34;

/** Helmbusch: steif, schwingt kurz nach. */
const PLUME: ChainSettings = { segment: BODY.plumeSegment, direction: 1, stiffness: 900, damping: 9, gravity: 4 };
/** Wappenrock: haengt, pendelt mit den Beinen. */
const TABARD: ChainSettings = { segment: BODY.tabardSegment, direction: -1, stiffness: 60, damping: 5, gravity: 14 };
/** Der Wappenrock haengt so viel steiler als der Oberschenkel, ehe dieser ihn mitnimmt (rad). */
const TABARD_CLEARANCE = 0.42;
/** So weit schwingt eine Bahn hoechstens zum Koerper hin / vom Koerper weg (rad). */
const TABARD_INWARD = -0.08;
const TABARD_OUTWARD = 1.9;
/** Seitliches Pendeln je Glied (m). */
const TABARD_SIDE = 0.035;

class KnightFighter implements FighterVisual {
  readonly root;
  private readonly skeleton = new KnightSkeleton();
  private readonly mesh: KnightMesh;
  private readonly target = newPose();
  private readonly working = newPose();
  private readonly follower = new PoseFollower();
  private readonly chains: SpringChain[];
  private readonly focus = new Vector3();
  private readonly knee = new Vector3();

  private recoil = 0;
  private recoilSpeed = 0;
  private recoilSide = 1;
  private lastFlash = 0;
  private armed = true;
  private shield = false;
  private lastClip = '';
  private soften = 0;

  constructor(options: FighterVisualOptions, build: KnightMeshBuilder) {
    this.root = this.skeleton.root;
    this.mesh = build(this.skeleton, { tabard: options.color, trim: options.accent, plume: options.plume });
    const b = this.skeleton.bones;
    this.chains = [
      new SpringChain([b.Plume1, b.Plume2, b.Plume3], PLUME),
      new SpringChain([b.TabardFront1, b.TabardFront2], TABARD, (p, anchor, i) => this.drape(p, anchor, i, 1)),
      new SpringChain([b.TabardBack1, b.TabardBack2], TABARD, (p, anchor, i) => this.drape(p, anchor, i, -1)),
    ];
    this.mesh.setLoadout(this.armed, this.shield);
  }

  update(input: FighterAnimInput, dtSeconds: number): void {
    poseForClip(input, this.target);
    if (input.clip !== this.lastClip) {
      this.soften = this.lastClip !== '' && SOFT_ENTRY.has(input.clip) ? SOFT_SECONDS : 0;
      this.lastClip = input.clip;
    }
    const gain = 1 - (1 - SOFT_GAIN) * Math.max(0, this.soften / SOFT_SECONDS);
    this.soften -= dtSeconds;
    this.follower.step(this.target, dtSeconds, gain);
    copyPose(this.follower.pose, this.working);
    const p = this.working;

    // Atmen: Schultern heben sich, die Brust richtet sich eine Spur auf.
    const breath = Math.sin((input.clockMs / BREATH_MS) * Math.PI * 2);
    p.shrugR += BREATH_SHRUG * (0.5 + 0.5 * breath);
    p.shrugL += BREATH_SHRUG * (0.5 + 0.5 * breath);
    p.spinePitch -= BREATH_PITCH * breath;

    // Treffer: Das Aufblitzen springt hoch - der Koerper bekommt einen Stoss.
    if (input.flash > this.lastFlash + 0.05) {
      this.recoilSpeed += RECOIL_KICK * input.flash;
      this.recoilSide = -this.recoilSide;
    }
    this.lastFlash = input.flash;
    springStep(this.recoil, this.recoilSpeed, 0, RECOIL_OMEGA, RECOIL_ZETA, Math.min(Math.max(dtSeconds, 0), 0.1));
    this.recoil = Math.max(-0.6, Math.min(1.2, SPRING.x));
    this.recoilSpeed = SPRING.v;
    if (this.recoil !== 0) {
      p.spinePitch -= RECOIL_SPINE * this.recoil;
      p.headPitch -= RECOIL_HEAD * this.recoil;
      p.spineRoll += RECOIL_ROLL * this.recoil * this.recoilSide;
      p.hipZ -= RECOIL_HIP * this.recoil;
      p.shrugR += this.recoil;
      p.shrugL += this.recoil;
    }

    const armed = !input.weaponBroken;
    const shield = input.shield && armed;
    if (armed !== this.armed || shield !== this.shield) {
      this.armed = armed;
      this.shield = shield;
      this.mesh.setLoadout(armed, shield);
    }

    let focus: Vector3 | null = null;
    if (input.focus) {
      this.root.updateWorldMatrix(true, false);
      focus = this.root.worldToLocal(this.focus.copy(input.focus));
    }
    this.skeleton.solve(p, { shield, armed, focus });
    for (const chain of this.chains) chain.update(dtSeconds);
    this.mesh.setFlash(Math.max(0, Math.min(1, input.flash)));
  }

  getHeadAnchor(out: Vector3): Vector3 {
    this.skeleton.worldPoint('Head', out, 0, BODY.helmetHeight * 0.5, 0);
    out.y += BODY.helmetHeight * 0.5 + HEAD_ANCHOR_UP;
    return out;
  }

  getChestAnchor(out: Vector3): Vector3 {
    return this.skeleton.worldPoint('Chest', out, 0, 0.1, 0.12);
  }

  getWeaponAnchor(out: Vector3): Vector3 {
    // Mit Schild wird dort geblockt, sonst an der Klinge, ohne Schwert an der Faust.
    if (this.shield) return this.skeleton.worldPoint('Shield', out, 0, 0, 0.04);
    if (this.armed) return this.skeleton.worldPoint('Sword', out, 0, (BODY.bladeStart + BODY.bladeEnd) * 0.5, 0);
    return this.skeleton.worldPoint('Hand.R', out);
  }

  dispose(): void {
    this.mesh.dispose();
    this.root.removeFromParent();
  }

  /**
   * Haelt eine Bahn des Wappenrocks vor (bzw. hinter) den Oberschenkeln und
   * laesst sie nicht in den Leib schwingen. Gerechnet wird mit dem Winkel des
   * Glieds in der Seitenansicht des Beckens: 0 = haengt gerade herab,
   * positiv = schwingt vom Koerper weg. `front` = +1 fuer die vordere Bahn,
   * -1 fuer die hintere.
   */
  private drape(point: Vector3, anchor: Vector3, index: number, front: 1 | -1): void {
    const b = this.skeleton.bones;
    // Das weiter angehobene Bein bestimmt, wie weit die Bahn mindestens absteht.
    let lifted = -Math.PI;
    for (const side of ['L', 'R'] as const) {
      this.knee.set(0, -BODY.thigh, 0).applyQuaternion(b[`UpperLeg.${side}`].quaternion);
      lifted = Math.max(lifted, Math.atan2(front * this.knee.z, -this.knee.y));
    }
    const min = Math.max(TABARD_INWARD, lifted - (index === 0 ? TABARD_CLEARANCE : TABARD_CLEARANCE * 0.4));
    const dx = Math.max(-TABARD_SIDE, Math.min(TABARD_SIDE, point.x - anchor.x));
    const angle = Math.max(min, Math.min(TABARD_OUTWARD, Math.atan2(front * (point.z - anchor.z), anchor.y - point.y)));
    const reach = Math.sqrt(Math.max(0, BODY.tabardSegment * BODY.tabardSegment - dx * dx));
    point.set(anchor.x + dx, anchor.y - Math.cos(angle) * reach, anchor.z + front * Math.sin(angle) * reach);
  }
}

/** Fabrik fuer den Ritter mit einem bestimmten Netz. */
export function knightFactory(build: KnightMeshBuilder): FighterVisualFactory {
  return (options) => new KnightFighter(options, build);
}
