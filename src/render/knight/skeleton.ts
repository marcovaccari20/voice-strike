// Das Skelett des Ritters: Knochen, Gelenke und die Rechnung, die aus einer
// Haltung (pose.ts) Gelenkwinkel macht.
//
// Die Knochen bilden eine echte Hierarchie (Becken -> Wirbelsaeule -> Brust ->
// Hals -> Kopf, Schulter -> Oberarm -> Unterarm -> Hand, Oberschenkel ->
// Unterschenkel -> Fuss). Das Netz (mesh.ts) haengt seine Teile nur an diese
// Knochen; es kennt keine Haltungen. Die Namen folgen Unitys Humanoid-Schema,
// damit sich die Figur spaeter als Modell mit Skelett ausgeben laesst.
//
// Ohne Browser lauffaehig (nur three.js-Mathematik) - die Bewegungspruefung
// in tests/animation.test.ts rechnet damit.

import { Bone, Euler, Group, Matrix4, Quaternion, Vector3 } from 'three';
import { BODY, CHEST_REST_Y, LEG_REACH } from './proportions';
import type { Pose } from './pose';

export const BONE_NAMES = [
  'Hips', 'Spine', 'Chest', 'Neck', 'Head',
  'Shoulder.L', 'UpperArm.L', 'LowerArm.L', 'Hand.L', 'Shield',
  'Shoulder.R', 'UpperArm.R', 'LowerArm.R', 'Hand.R', 'Sword',
  'UpperLeg.L', 'LowerLeg.L', 'Foot.L',
  'UpperLeg.R', 'LowerLeg.R', 'Foot.R',
  'Plume1', 'Plume2', 'Plume3',
  'TabardFront1', 'TabardFront2', 'TabardBack1', 'TabardBack2',
] as const;

export type BoneName = (typeof BONE_NAMES)[number];

export interface SolveOptions {
  /** Traegt links einen Schild. */
  shield: boolean;
  /** Haelt ein Schwert (sonst Faeuste). */
  armed: boolean;
  /**
   * Worauf der Kopf schaut, im Figur-Raum (meist der Helm des Gegners).
   * `null` = geradeaus.
   */
  focus: Vector3 | null;
}

/** Was die letzte Rechnung nicht erreichen konnte (m); 0 = alles erreicht. */
export interface Overreach {
  armR: number;
  armL: number;
  legR: number;
  legL: number;
}

const DOWN = new Vector3(0, -1, 0);
/** Wohin der Ellbogen von sich aus zeigt (Brust-Raum, rechter Arm): aussen, unten, hinten. */
const ELBOW_POLE = new Vector3(-0.55, -0.75, -0.35).normalize();
/** Anteil, mit dem die Schulterplatte dem Oberarm folgt. */
const PAULDRON_FOLLOW = 0.4;
/** Wie weit eine hochgezogene Schulter steigt (m). */
const SHRUG_RISE = 0.07;
/** Der Kopf dreht hoechstens so weit gegen die Brust (rad). */
const HEAD_YAW_MAX = 1.35;
const HEAD_PITCH_MAX = 0.75;
const LOOK_YAW_MAX = 1.2;
const LOOK_PITCH_MAX = 0.55;
/** Anteil der Kopfdrehung, den der Hals uebernimmt. */
const NECK_SHARE = 0.4;
/** Fussballen: Drehpunkt, um den sich die Ferse hebt (vor dem Knoechel). */
const BALL_FRONT = 0.13;
/** So weit hebt sich die Ferse hoechstens von selbst (rad). */
const HEEL_LIFT_MAX = 1.25;
/** Bis zu dieser Sohlenhoehe gilt ein Fuss als aufgesetzt (m). */
const PLANTED_HEIGHT = 0.05;

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export class KnightSkeleton {
  /** In die Szene zu haengen; Position und Blickrichtung setzt die Szene. */
  readonly root = new Group();
  /** Traegt die Drehung der ganzen Figur (Rolle, Sturz). */
  readonly body = new Group();
  readonly bones: Record<BoneName, Bone>;
  readonly overreach: Overreach = { armR: 0, armL: 0, legR: 0, legL: 0 };

  // Zwischenwerte, einmal angelegt statt je Bild. Alles im Raum von `body`.
  private readonly e = new Euler();
  private readonly m = new Matrix4();
  private readonly qBody = new Quaternion();
  private readonly qHips = new Quaternion();
  private readonly qHalf = new Quaternion();
  private readonly qSpineW = new Quaternion();
  private readonly qChestW = new Quaternion();
  private readonly qInv = new Quaternion();
  private readonly qA = new Quaternion();
  private readonly qB = new Quaternion();
  private readonly qC = new Quaternion();
  private readonly qSword = new Quaternion();
  private readonly pHips = new Vector3();
  private readonly pChest = new Vector3();
  private readonly pShoulder = new Vector3();
  private readonly pTarget = new Vector3();
  private readonly pJoint = new Vector3();
  private readonly pEnd = new Vector3();
  private readonly pHandR = new Vector3();
  private readonly vBlade = new Vector3();
  private readonly vPole = new Vector3();
  private readonly vAxis = new Vector3();
  private readonly vX = new Vector3();
  private readonly vY = new Vector3();
  private readonly vZ = new Vector3();
  private readonly vTmp = new Vector3();
  private readonly vTmp2 = new Vector3();
  private readonly vEdge = new Vector3(0, 0, 1);
  private readonly vBall = new Vector3();

  constructor() {
    const bones = {} as Record<BoneName, Bone>;
    for (const name of BONE_NAMES) {
      const bone = new Bone();
      bone.name = name;
      bones[name] = bone;
    }
    this.bones = bones;

    const link = (parent: BoneName, child: BoneName, x: number, y: number, z: number): void => {
      bones[child].position.set(x, y, z);
      bones[parent].add(bones[child]);
    };
    link('Hips', 'Spine', 0, BODY.waist, 0);
    link('Spine', 'Chest', 0, BODY.chest, 0);
    link('Chest', 'Neck', 0, BODY.neck, 0);
    link('Neck', 'Head', 0, BODY.head, 0);
    for (const [side, sx] of [['L', 1], ['R', -1]] as const) {
      link('Chest', `Shoulder.${side}`, sx * BODY.shoulderX, BODY.shoulderY, 0);
      link(`Shoulder.${side}`, `UpperArm.${side}`, 0, 0, 0);
      link(`UpperArm.${side}`, `LowerArm.${side}`, 0, -BODY.upperArm, 0);
      link(`LowerArm.${side}`, `Hand.${side}`, 0, -BODY.forearm, 0);
      link('Hips', `UpperLeg.${side}`, sx * BODY.hipWidth, 0, 0);
      link(`UpperLeg.${side}`, `LowerLeg.${side}`, 0, -BODY.thigh, 0);
      link(`LowerLeg.${side}`, `Foot.${side}`, 0, -BODY.shin, 0);
    }
    // Schwert: Ursprung in der Griffmitte, Klinge entlang +Y, Schneiden nach +-Z.
    link('Hand.R', 'Sword', 0, 0, 0);
    // Schild: Scheibe in der XY-Ebene, Aussenseite nach +Z, Bretter entlang Y.
    link('Hand.L', 'Shield', 0, 0, BODY.shieldOffset);
    // Helmbusch: drei Glieder nach oben.
    link('Head', 'Plume1', 0, BODY.helmetHeight - 0.015, -0.01);
    link('Plume1', 'Plume2', 0, BODY.plumeSegment, 0);
    link('Plume2', 'Plume3', 0, BODY.plumeSegment, 0);
    // Wappenrock unter dem Guertel: je zwei Glieder nach unten, vorn und hinten.
    link('Hips', 'TabardFront1', 0, BODY.waist - 0.02, 0.185);
    link('TabardFront1', 'TabardFront2', 0, -BODY.tabardSegment, 0);
    link('Hips', 'TabardBack1', 0, BODY.waist - 0.02, -0.185);
    link('TabardBack1', 'TabardBack2', 0, -BODY.tabardSegment, 0);

    this.body.add(bones.Hips);
    this.root.add(this.body);
  }

  /** Stellt alle Gelenke auf die Haltung ein. */
  solve(p: Pose, options: SolveOptions): void {
    const b = this.bones;

    // --- ganze Figur ------------------------------------------------------
    this.qBody.setFromEuler(this.e.set(p.rootPitch, p.rootYaw, -p.rootRoll, 'YXZ'));
    this.vTmp.set(0, p.pivotY, 0).applyQuaternion(this.qBody);
    this.body.position.set(p.rootX - this.vTmp.x, p.rootY + p.pivotY - this.vTmp.y, p.rootZ - this.vTmp.z);
    this.body.quaternion.copy(this.qBody);

    // --- Becken, Wirbelsaeule, Brust --------------------------------------
    this.qHips.setFromEuler(this.e.set(p.hipPitch, p.hipYaw, -p.hipRoll, 'YXZ'));
    this.pHips.set(p.hipX, p.hipY, p.hipZ);
    b.Hips.position.copy(this.pHips);
    b.Hips.quaternion.copy(this.qHips);

    this.qHalf.setFromEuler(this.e.set(p.spinePitch / 2, p.spineYaw / 2, -p.spineRoll / 2, 'YXZ'));
    b.Spine.quaternion.copy(this.qHalf);
    b.Chest.quaternion.copy(this.qHalf);
    this.qSpineW.copy(this.qHips).multiply(this.qHalf);
    this.qChestW.copy(this.qSpineW).multiply(this.qHalf);
    this.pChest
      .set(0, BODY.chest, 0)
      .applyQuaternion(this.qSpineW)
      .add(this.vTmp.set(0, BODY.waist, 0).applyQuaternion(this.qHips))
      .add(this.pHips);

    this.solveHead(p, options.focus);

    // --- Arme -------------------------------------------------------------
    // rechts: Schwerthand
    this.chestToBody(p.handRX, p.handRY, p.handRZ, this.pTarget);
    this.overreach.armR = this.solveArm(-1, p.shrugR, p.elbowR, this.pTarget);
    this.pHandR.copy(this.pEnd);
    // Schwert: Klinge entlang +Y, die Schneide fuehrt in Richtung des Unterarms.
    this.vBlade.set(p.bladeX, p.bladeY, p.bladeZ);
    if (this.vBlade.lengthSq() < 1e-8) this.vBlade.set(0, 1, 0);
    this.vBlade.normalize().applyQuaternion(this.qChestW);
    this.vTmp.subVectors(this.pEnd, this.pJoint).normalize();
    this.vZ.copy(this.vTmp).addScaledVector(this.vBlade, -this.vTmp.dot(this.vBlade));
    if (this.vZ.lengthSq() < 0.01) {
      // Stich: Klinge in Verlaengerung des Unterarms - letzte Schneidenrichtung behalten.
      this.vZ.copy(this.vEdge).addScaledVector(this.vBlade, -this.vEdge.dot(this.vBlade));
      if (this.vZ.lengthSq() < 1e-6) this.vZ.set(0, 1, 0).addScaledVector(this.vBlade, -this.vBlade.y);
    }
    this.vZ.normalize();
    this.vEdge.copy(this.vZ);
    this.vX.crossVectors(this.vBlade, this.vZ);
    this.qSword.setFromRotationMatrix(this.m.makeBasis(this.vX, this.vBlade, this.vZ));
    if (p.bladeRoll !== 0) this.qSword.multiply(this.qA.setFromAxisAngle(this.vY.set(0, 1, 0), p.bladeRoll));
    // `qB` haelt nach solveArm die Lage des Unterarms.
    if (options.armed) b['Hand.R'].quaternion.copy(this.qInv.copy(this.qB).invert()).multiply(this.qSword);
    else b['Hand.R'].quaternion.identity();

    // links: Schild, zweite Hand am Griff oder frei
    this.chestToBody(p.handLX, p.handLY, p.handLZ, this.pTarget);
    const grip = options.armed && !options.shield ? clamp(p.grip, 0, 1) : 0;
    if (grip > 0) {
      this.vTmp.copy(this.pHandR).addScaledVector(this.vBlade, -BODY.secondGrip);
      this.pTarget.lerp(this.vTmp, grip);
    }
    this.overreach.armL = this.solveArm(1, p.shrugL, p.elbowL, this.pTarget);
    if (options.shield) {
      // Schildflaeche: gewuenschte Richtung, aber nie so, dass der Unterarm hindurchgeht.
      this.vZ.set(p.shieldX, p.shieldY, p.shieldZ);
      if (this.vZ.lengthSq() < 1e-8) this.vZ.set(0, 0, 1);
      this.vZ.normalize().applyQuaternion(this.qChestW);
      this.vTmp.subVectors(this.pEnd, this.pJoint).normalize();
      const facing = this.vTmp.dot(this.vZ);
      if (facing < -0.2) this.vZ.addScaledVector(this.vTmp, -0.2 - facing).normalize();
      // Bretter bleiben zur Brust aufrecht.
      this.vY.set(0, 1, 0).applyQuaternion(this.qChestW);
      this.vY.addScaledVector(this.vZ, -this.vY.dot(this.vZ));
      if (this.vY.lengthSq() < 1e-4) this.vY.copy(this.vTmp).addScaledVector(this.vZ, -this.vTmp.dot(this.vZ));
      this.vY.normalize();
      this.vX.crossVectors(this.vY, this.vZ);
      this.qA.setFromRotationMatrix(this.m.makeBasis(this.vX, this.vY, this.vZ));
      b['Hand.L'].quaternion.copy(this.qInv.copy(this.qB).invert()).multiply(this.qA);
    } else if (grip > 0) {
      this.qA.copy(this.qInv.copy(this.qB).invert()).multiply(this.qSword);
      b['Hand.L'].quaternion.identity().slerp(this.qA, grip);
    } else {
      b['Hand.L'].quaternion.identity();
    }

    // --- Beine ------------------------------------------------------------
    const grounded = p.ground >= 0.5;
    this.overreach.legR = this.solveLeg(-1, p.footRX, p.footRY, p.footRZ, p.footRYaw, p.footRPitch, p.kneeR, p.hipYaw, grounded);
    this.overreach.legL = this.solveLeg(1, p.footLX, p.footLY, p.footLZ, p.footLYaw, p.footLPitch, p.kneeL, p.hipYaw, grounded);
  }

  /** Position eines Knochens (plus Versatz in seinem Raum) in Weltkoordinaten. */
  worldPoint(name: BoneName, out: Vector3, x = 0, y = 0, z = 0): Vector3 {
    this.root.updateWorldMatrix(true, true);
    return out.set(x, y, z).applyMatrix4(this.bones[name].matrixWorld);
  }

  /** Dasselbe im Figur-Raum (unabhaengig davon, wo die Figur in der Szene steht). */
  figurePoint(name: BoneName, out: Vector3, x = 0, y = 0, z = 0): Vector3 {
    this.worldPoint(name, out, x, y, z);
    return this.root.worldToLocal(out);
  }

  /** Richtung einer Knochenachse im Figur-Raum. */
  figureDirection(name: BoneName, out: Vector3, x: number, y: number, z: number): Vector3 {
    this.root.updateWorldMatrix(true, true);
    out.set(x, y, z).transformDirection(this.bones[name].matrixWorld);
    this.m.copy(this.root.matrixWorld).invert();
    return out.transformDirection(this.m);
  }

  // -------------------------------------------------------------------------

  /** Punkt aus dem Brust-Raum in den Raum von `body`. */
  private chestToBody(x: number, y: number, z: number, out: Vector3): Vector3 {
    return out.set(x, y - CHEST_REST_Y, z).applyQuaternion(this.qChestW).add(this.pChest);
  }

  private solveHead(p: Pose, focus: Vector3 | null): void {
    let yaw = p.headYaw;
    let pitch = p.headPitch;
    if (focus && p.look > 0) {
      // Ziel aus dem Figur-Raum in den Brust-Raum holen.
      this.vTmp.copy(focus).sub(this.body.position).applyQuaternion(this.qInv.copy(this.qBody).invert());
      this.vTmp2.set(0, BODY.neck + BODY.head + BODY.helmetHeight * 0.55, 0).applyQuaternion(this.qChestW).add(this.pChest);
      this.vTmp.sub(this.vTmp2).applyQuaternion(this.qInv.copy(this.qChestW).invert());
      const flat = Math.hypot(this.vTmp.x, this.vTmp.z);
      if (flat > 1e-4 || Math.abs(this.vTmp.y) > 1e-4) {
        yaw += p.look * clamp(Math.atan2(this.vTmp.x, this.vTmp.z), -LOOK_YAW_MAX, LOOK_YAW_MAX);
        pitch += p.look * clamp(Math.atan2(-this.vTmp.y, flat), -LOOK_PITCH_MAX, LOOK_PITCH_MAX);
      }
    }
    yaw = clamp(yaw, -HEAD_YAW_MAX, HEAD_YAW_MAX);
    pitch = clamp(pitch, -HEAD_PITCH_MAX, HEAD_PITCH_MAX);
    const head = 1 - NECK_SHARE;
    this.bones.Neck.quaternion.setFromEuler(this.e.set(pitch * NECK_SHARE, yaw * NECK_SHARE, -p.headRoll * NECK_SHARE, 'YXZ'));
    this.bones.Head.quaternion.setFromEuler(this.e.set(pitch * head, yaw * head, -p.headRoll * head, 'YXZ'));
  }

  /**
   * Schulter, Ober- und Unterarm einer Seite auf `target` ausrichten.
   * Hinterlaesst den Ellbogen in `pJoint`, die erreichte Hand in `pEnd` und
   * die Lage des Unterarms in `qB`. Liefert, um wie viel das Ziel ausser
   * Reichweite lag.
   */
  private solveArm(sx: number, shrug: number, swivel: number, target: Vector3): number {
    const side = sx > 0 ? 'L' : 'R';
    const shoulder = this.bones[`Shoulder.${side}`];
    const rise = clamp(shrug, 0, 1) * SHRUG_RISE;
    shoulder.position.set(sx * BODY.shoulderX, BODY.shoulderY + rise, 0);
    this.pShoulder.copy(shoulder.position).applyQuaternion(this.qChestW).add(this.pChest);

    // Ellbogenrichtung: aussen-unten-hinten, um die Achse Schulter-Hand geschwenkt.
    this.vAxis.subVectors(target, this.pShoulder);
    const distance = this.vAxis.length();
    if (distance < 1e-5) this.vAxis.set(0, -1, 0);
    else this.vAxis.multiplyScalar(1 / distance);
    this.vPole.set(ELBOW_POLE.x * -sx, ELBOW_POLE.y, ELBOW_POLE.z).applyQuaternion(this.qChestW);
    if (swivel !== 0) this.vPole.applyAxisAngle(this.vAxis, sx * swivel);

    const over = this.twoBone(this.pShoulder, target, BODY.upperArm, BODY.forearm, this.vPole);

    // Oberarm: -Y entlang des Knochens, +Z dorthin, wohin der Unterarm einknickt.
    this.vY.subVectors(this.pShoulder, this.pJoint).normalize();
    this.vZ.copy(this.vPole).addScaledVector(this.vY, -this.vPole.dot(this.vY));
    if (this.vZ.lengthSq() < 1e-8) this.vZ.set(0, 0, -1).addScaledVector(this.vY, this.vY.z);
    this.vZ.normalize().negate();
    this.vX.crossVectors(this.vY, this.vZ);
    this.qA.setFromRotationMatrix(this.m.makeBasis(this.vX, this.vY, this.vZ));
    // Unterarm: gleiche Scharnierachse.
    this.vY.subVectors(this.pJoint, this.pEnd).normalize();
    this.vZ.crossVectors(this.vX, this.vY).normalize();
    this.qB.setFromRotationMatrix(this.m.makeBasis(this.vX, this.vY, this.vZ));

    // Schulterplatte folgt dem Oberarm ein Stueck (nur Schwenk, keine Verdrehung).
    this.qInv.copy(this.qChestW).invert();
    this.vTmp.subVectors(this.pJoint, this.pShoulder).normalize().applyQuaternion(this.qInv);
    this.qC.setFromUnitVectors(DOWN, this.vTmp);
    shoulder.quaternion.identity().slerp(this.qC, PAULDRON_FOLLOW);
    // Lokale Drehungen: Eltern herausrechnen.
    this.qC.copy(this.qChestW).multiply(shoulder.quaternion).invert();
    this.bones[`UpperArm.${side}`].quaternion.copy(this.qC).multiply(this.qA);
    this.bones[`LowerArm.${side}`].quaternion.copy(this.qInv.copy(this.qA).invert()).multiply(this.qB);
    return over;
  }

  /** Bein einer Seite auf den Fuss-Zielpunkt stellen; liefert die fehlende Reichweite. */
  private solveLeg(
    sx: number,
    footX: number,
    footY: number,
    footZ: number,
    footYaw: number,
    footPitch: number,
    knee: number,
    hipYaw: number,
    grounded: boolean,
  ): number {
    const side = sx > 0 ? 'L' : 'R';
    const hip = this.pShoulder.set(sx * BODY.hipWidth, 0, 0).applyQuaternion(this.qHips).add(this.pHips);
    const ankle = this.pTarget.set(footX, footY + BODY.ankleHeight, footZ);
    let pitch = footPitch;

    if (grounded) {
      // Die Sohle sinkt nie in den Boden: tiefsten Punkt (Spitze oder Ferse) anheben.
      this.qA.setFromEuler(this.e.set(pitch, footYaw, 0, 'YXZ'));
      const toe = this.vTmp.set(0, -BODY.ankleHeight, BODY.footFront).applyQuaternion(this.qA).y;
      const heel = this.vTmp.set(0, -BODY.ankleHeight, -BODY.footBack).applyQuaternion(this.qA).y;
      const low = ankle.y + Math.min(toe, heel);
      if (low < 0) ankle.y -= low;

      // Reicht das Bein nicht, hebt ein aufgesetzter Fuss die Ferse: Der
      // Knoechel wandert auf einem Kreis um den Ballen zur Huefte hin.
      if (footY < PLANTED_HEIGHT && ankle.distanceTo(hip) > LEG_REACH * 0.995) {
        this.vBall.set(0, -BODY.ankleHeight, BALL_FRONT).applyQuaternion(this.qA).add(ankle);
        let lo = pitch;
        let hi = Math.max(pitch, HEEL_LIFT_MAX);
        for (let i = 0; i < 10; i++) {
          const mid = (lo + hi) / 2;
          this.qA.setFromEuler(this.e.set(mid, footYaw, 0, 'YXZ'));
          this.vTmp.set(0, BODY.ankleHeight, -BALL_FRONT).applyQuaternion(this.qA).add(this.vBall);
          if (this.vTmp.distanceTo(hip) > LEG_REACH * 0.995) lo = mid;
          else hi = mid;
        }
        pitch = hi;
        this.qA.setFromEuler(this.e.set(pitch, footYaw, 0, 'YXZ'));
        ankle.set(0, BODY.ankleHeight, -BALL_FRONT).applyQuaternion(this.qA).add(this.vBall);
      }
    }

    // Knie zeigt dorthin, wohin Fuss und Becken schauen; leicht nach oben,
    // damit ein nach vorn gestrecktes Bein das Knie hebt statt zu kippen.
    const facing = footYaw * 0.6 + hipYaw * 0.4 + sx * knee;
    this.vPole.set(Math.sin(facing), 0.6, Math.cos(facing));

    const over = this.twoBone(hip, ankle, BODY.thigh, BODY.shin, this.vPole);

    // Oberschenkel: -Y entlang des Knochens, +Z dorthin, wohin das Knie zeigt.
    this.vY.subVectors(hip, this.pJoint).normalize();
    this.vZ.copy(this.vPole).addScaledVector(this.vY, -this.vPole.dot(this.vY));
    if (this.vZ.lengthSq() < 1e-8) this.vZ.set(0, 0, 1).addScaledVector(this.vY, -this.vY.z);
    this.vZ.normalize();
    this.vX.crossVectors(this.vY, this.vZ);
    this.qA.setFromRotationMatrix(this.m.makeBasis(this.vX, this.vY, this.vZ));
    this.vY.subVectors(this.pJoint, this.pEnd).normalize();
    this.vZ.crossVectors(this.vX, this.vY).normalize();
    this.qB.setFromRotationMatrix(this.m.makeBasis(this.vX, this.vY, this.vZ));

    this.bones[`UpperLeg.${side}`].quaternion.copy(this.qInv.copy(this.qHips).invert()).multiply(this.qA);
    this.bones[`LowerLeg.${side}`].quaternion.copy(this.qInv.copy(this.qA).invert()).multiply(this.qB);
    this.qC.setFromEuler(this.e.set(pitch, footYaw, 0, 'YXZ'));
    this.bones[`Foot.${side}`].quaternion.copy(this.qInv.copy(this.qB).invert()).multiply(this.qC);
    return over;
  }

  /**
   * Zwei-Knochen-Kette von `root` nach `target`; Gelenk nach `pJoint`,
   * erreichtes Ende nach `pEnd`. Liefert die fehlende Reichweite (m).
   */
  private twoBone(root: Vector3, target: Vector3, a: number, b: number, pole: Vector3): number {
    const dir = this.pEnd.subVectors(target, root);
    let len = dir.length();
    if (len < 1e-5) {
      dir.set(0, -1, 0);
      len = 1e-5;
    } else {
      dir.multiplyScalar(1 / len);
    }
    const max = a + b - 1e-3;
    const reach = Math.min(Math.max(len, Math.abs(a - b) + 1e-3), max);
    const along = (a * a - b * b + reach * reach) / (2 * reach);
    const height = Math.sqrt(Math.max(0, a * a - along * along));
    // Beugerichtung: Anteil des Polvektors senkrecht zur Gliedachse.
    this.pJoint.copy(pole).addScaledVector(dir, -pole.dot(dir));
    if (this.pJoint.lengthSq() < 1e-8) this.pJoint.set(0, 0, 1).addScaledVector(dir, -dir.z);
    this.pJoint.normalize().multiplyScalar(height).addScaledVector(dir, along).add(root);
    // `pEnd` hielt bisher die Richtung; jetzt den erreichbaren Endpunkt.
    this.pEnd.multiplyScalar(reach).add(root);
    return Math.max(0, len - max);
  }
}
