// Die Figur aus Grundformen: Rumpf, Kopf, Arme, Beine, Schwert.
//
// Keine externen Dateien. Die Haltung kommt aus poses.ts; Ellbogen und Knie
// werden je Bild aus Schulter/Hand bzw. Huefte/Fuss errechnet (Zwei-Knochen-IK),
// die Gliedmassen sind gestreckte Zylinder zwischen den Gelenkpunkten.

import {
  BoxGeometry,
  Color,
  CylinderGeometry,
  Euler,
  Group,
  Mesh,
  MeshStandardMaterial,
  Quaternion,
  SphereGeometry,
  Vector3,
} from 'three';
import type {
  FighterAnimInput,
  FighterVisual,
  FighterVisualFactory,
  FighterVisualOptions,
} from './fighterVisual';
import { ANGLE_KEYS, POSE_KEYS, newPose, poseFor, type Pose } from './poses';

// Koerpermasse in Metern.
const SHOULDER_X = 0.24;
const SHOULDER_Y = 0.5; // ueber dem Becken
const HEAD_Y = 0.76;
const HIP_X = 0.11;
const UPPER_ARM = 0.3;
const FOREARM = 0.28;
const THIGH = 0.46;
const SHIN = 0.46;
const BLADE_LENGTH = 0.92;
const SHIELD_RADIUS = 0.3;
/** Wie weit die linke Hand unter der rechten am Griff sitzt. */
const GRIP_OFFSET = 0.13;
/** Zeitkonstante, mit der die Figur ihrer Zielhaltung folgt (s). */
const FOLLOW_SECONDS = 0.03;
/** Hoehe des Warnzeichens ueber dem Kopf (m). */
const HEAD_ANCHOR_UP = 0.42;

const UP = new Vector3(0, 1, 0);
const SKIN = 0xe0b48c;
const STEEL = 0xcfd6de;
const LEATHER = 0x4a3524;
const DARK = 0x2b2f3a;

/** Gelenkpunkt eines Zwei-Knochen-Glieds. */
function solveTwoBone(
  root: Vector3,
  target: Vector3,
  a: number,
  b: number,
  pole: Vector3,
  outJoint: Vector3,
  outEnd: Vector3,
): void {
  const dir = outEnd.subVectors(target, root);
  let len = dir.length();
  if (len < 1e-5) {
    dir.set(0, -1, 0);
    len = 1e-5;
  } else {
    dir.multiplyScalar(1 / len);
  }
  const reach = Math.min(Math.max(len, Math.abs(a - b) + 1e-3), a + b - 1e-3);
  const along = (a * a - b * b + reach * reach) / (2 * reach);
  const height = Math.sqrt(Math.max(0, a * a - along * along));
  // Beugerichtung: Anteil des Polvektors senkrecht zur Gliedachse.
  outJoint.copy(pole).addScaledVector(dir, -pole.dot(dir));
  if (outJoint.lengthSq() < 1e-8) outJoint.set(0, 0, 1);
  outJoint.normalize().multiplyScalar(height).addScaledVector(dir, along).add(root);
  // `outEnd` hielt bisher die Richtung; jetzt den erreichbaren Endpunkt.
  outEnd.multiplyScalar(reach).add(root);
}

class PrimitiveFighter implements FighterVisual {
  readonly root = new Group();
  private readonly body = new Group();
  private readonly materials: MeshStandardMaterial[] = [];
  private readonly geometries: { dispose(): void }[] = [];

  private readonly pelvis: Mesh;
  private readonly torso: Mesh;
  private readonly sash: Mesh;
  private readonly head = new Group();
  private readonly shoulderR: Mesh;
  private readonly shoulderL: Mesh;
  private readonly upperArmR: Mesh;
  private readonly forearmR: Mesh;
  private readonly upperArmL: Mesh;
  private readonly forearmL: Mesh;
  private readonly handR: Mesh;
  private readonly handL: Mesh;
  private readonly thighR: Mesh;
  private readonly shinR: Mesh;
  private readonly thighL: Mesh;
  private readonly shinL: Mesh;
  private readonly footR: Mesh;
  private readonly footL: Mesh;
  private readonly sword = new Group();
  private readonly shield = new Group();

  private readonly target = newPose();
  private readonly current = newPose();
  private started = false;

  // Zwischenwerte, einmal angelegt statt je Bild.
  private readonly qTorso = new Quaternion();
  private readonly qPelvis = new Quaternion();
  private readonly qHead = new Quaternion();
  private readonly qBody = new Quaternion();
  private readonly euler = new Euler();
  private readonly vPelvis = new Vector3();
  private readonly vShoulderR = new Vector3();
  private readonly vShoulderL = new Vector3();
  private readonly vHipR = new Vector3();
  private readonly vHipL = new Vector3();
  private readonly vHead = new Vector3();
  private readonly vChest = new Vector3();
  private readonly vTarget = new Vector3();
  private readonly vJoint = new Vector3();
  private readonly vEnd = new Vector3();
  private readonly vHandR = new Vector3();
  private readonly vBlade = new Vector3();
  private readonly vPole = new Vector3();
  private readonly vShield = new Vector3();
  private readonly vTmp = new Vector3();

  constructor(options: FighterVisualOptions) {
    const cloth = this.material(options.color, 0.85);
    const accent = this.material(options.accent, 0.7);
    const skin = this.material(SKIN, 0.8);
    const leather = this.material(LEATHER, 0.9);
    const dark = this.material(DARK, 0.85);
    const steel = this.material(STEEL, 0.35, 0.85);

    this.pelvis = this.box(0.36, 0.2, 0.24, dark);
    this.torso = this.box(0.46, 0.54, 0.27, cloth);
    this.sash = this.box(0.48, 0.07, 0.29, accent);
    this.shoulderR = this.sphere(0.09, cloth);
    this.shoulderL = this.sphere(0.09, cloth);
    this.upperArmR = this.limb(0.065, cloth);
    this.upperArmL = this.limb(0.065, cloth);
    this.forearmR = this.limb(0.055, leather);
    this.forearmL = this.limb(0.055, leather);
    this.handR = this.sphere(0.06, skin);
    this.handL = this.sphere(0.06, skin);
    this.thighR = this.limb(0.085, dark);
    this.thighL = this.limb(0.085, dark);
    this.shinR = this.limb(0.07, leather);
    this.shinL = this.limb(0.07, leather);
    this.footR = this.box(0.12, 0.08, 0.26, leather);
    this.footL = this.box(0.12, 0.08, 0.26, leather);

    // Kopf mit Helm: Nasenschutz und Helmbusch zeigen, wohin die Figur schaut.
    const face = this.sphere(0.15, skin);
    const helmetGeo = new SphereGeometry(0.165, 20, 12, 0, Math.PI * 2, 0, Math.PI * 0.55);
    this.geometries.push(helmetGeo);
    const helmet = new Mesh(helmetGeo, steel);
    helmet.castShadow = true;
    const nose = this.box(0.035, 0.13, 0.03, steel);
    nose.position.set(0, 0.02, 0.155);
    const crest = this.box(0.035, 0.1, 0.26, accent);
    crest.position.set(0, 0.2, -0.02);
    this.head.add(face, helmet, nose, crest);
    this.body.add(this.head);

    // Schwert: Ursprung in der Hand, Klinge entlang +Y.
    const blade = this.box(0.05, BLADE_LENGTH, 0.018, steel);
    blade.position.y = 0.1 + BLADE_LENGTH / 2;
    const guard = this.box(0.24, 0.035, 0.05, accent);
    guard.position.y = 0.09;
    const grip = this.limb(0.022, leather);
    grip.scale.y = 0.2;
    grip.position.y = -0.02;
    const pommel = this.sphere(0.035, accent);
    pommel.position.y = -0.14;
    this.sword.add(blade, guard, grip, pommel);
    this.body.add(this.sword);

    // Rundschild: Scheibe, deren Achse (+Y) nach aussen zeigt; Ursprung an der Hand.
    const faceGeo = new CylinderGeometry(SHIELD_RADIUS, SHIELD_RADIUS, 0.05, 28);
    const rimGeo = new CylinderGeometry(SHIELD_RADIUS + 0.03, SHIELD_RADIUS + 0.03, 0.035, 28);
    this.geometries.push(faceGeo, rimGeo);
    const shieldFace = new Mesh(faceGeo, cloth);
    shieldFace.position.y = 0.075;
    shieldFace.castShadow = true;
    const shieldRim = new Mesh(rimGeo, steel);
    shieldRim.position.y = 0.06;
    shieldRim.castShadow = true;
    const boss = this.sphere(0.075, steel);
    boss.position.y = 0.1;
    boss.scale.y = 0.6;
    const stripe = this.box(SHIELD_RADIUS * 1.9, 0.012, 0.07, accent);
    stripe.position.y = 0.103;
    this.shield.add(shieldRim, shieldFace, boss, stripe);
    this.body.add(this.shield);

    this.root.add(this.body);
  }

  update(input: FighterAnimInput, dtSeconds: number): void {
    poseFor(input, this.target);

    // Der Zielhaltung weich folgen; Drehungen der ganzen Figur auf kuerzestem Weg.
    const follow = this.started ? 1 - Math.exp(-dtSeconds / FOLLOW_SECONDS) : 1;
    this.started = true;
    for (const k of POSE_KEYS) {
      let delta = this.target[k] - this.current[k];
      if (ANGLE_KEYS.has(k)) {
        delta = ((((delta + Math.PI) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)) - Math.PI;
      }
      this.current[k] += delta * follow;
    }

    this.applyPose(this.current, input.weaponBroken, input.shield && !input.weaponBroken);

    const glow = Math.max(0, Math.min(1, input.flash));
    for (const m of this.materials) m.emissive.setScalar(glow * 0.9);
  }

  getHeadAnchor(out: Vector3): Vector3 {
    this.root.updateWorldMatrix(true, true);
    out.copy(this.vHead);
    this.body.localToWorld(out);
    out.y += HEAD_ANCHOR_UP;
    return out;
  }

  getChestAnchor(out: Vector3): Vector3 {
    this.root.updateWorldMatrix(true, true);
    out.copy(this.vChest);
    return this.body.localToWorld(out);
  }

  getWeaponAnchor(out: Vector3): Vector3 {
    this.root.updateWorldMatrix(true, true);
    // Mit Schild wird dort geblockt, sonst an der Klinge.
    if (this.shield.visible) out.copy(this.shield.position).addScaledVector(this.vShield, 0.1);
    else out.copy(this.vHandR).addScaledVector(this.vBlade, 0.1 + BLADE_LENGTH * 0.45);
    return this.body.localToWorld(out);
  }

  dispose(): void {
    for (const g of this.geometries) g.dispose();
    for (const m of this.materials) m.dispose();
    this.root.removeFromParent();
  }

  // -------------------------------------------------------------------------

  private applyPose(p: Pose, weaponBroken: boolean, withShield: boolean): void {
    // ganze Figur
    this.qBody.setFromEuler(this.euler.set(p.rotX, p.rotY, p.rotZ, 'YXZ'));
    this.vTmp.set(0, p.pivotY, 0).applyQuaternion(this.qBody);
    this.body.position.set(p.offX - this.vTmp.x, p.offY + p.pivotY - this.vTmp.y, p.offZ - this.vTmp.z);
    this.body.quaternion.copy(this.qBody);

    // Becken und Rumpf
    this.vPelvis.set(p.pelvisX, p.pelvisY, p.pelvisZ);
    this.qPelvis.setFromEuler(this.euler.set(0, p.torsoYaw * 0.35, 0, 'YXZ'));
    this.qTorso.setFromEuler(this.euler.set(p.torsoPitch, p.torsoYaw, -p.torsoRoll, 'YXZ'));

    this.pelvis.position.copy(this.vPelvis);
    this.pelvis.quaternion.copy(this.qPelvis);

    this.torso.position.set(0, 0.31, 0).applyQuaternion(this.qTorso).add(this.vPelvis);
    this.torso.quaternion.copy(this.qTorso);
    this.sash.position.set(0, 0.07, 0).applyQuaternion(this.qTorso).add(this.vPelvis);
    this.sash.quaternion.copy(this.qTorso);
    this.vChest.copy(this.torso.position);

    this.vShoulderR.set(-SHOULDER_X, SHOULDER_Y, 0).applyQuaternion(this.qTorso).add(this.vPelvis);
    this.vShoulderL.set(SHOULDER_X, SHOULDER_Y, 0).applyQuaternion(this.qTorso).add(this.vPelvis);
    this.shoulderR.position.copy(this.vShoulderR);
    this.shoulderL.position.copy(this.vShoulderL);

    this.vHead.set(0, HEAD_Y, 0.02).applyQuaternion(this.qTorso).add(this.vPelvis);
    this.qHead.setFromEuler(this.euler.set(p.headPitch, p.headYaw, 0, 'YXZ'));
    this.head.position.copy(this.vHead);
    this.head.quaternion.copy(this.qTorso).multiply(this.qHead);

    // Schwertarm (rechts): Ellbogen nach aussen-unten-hinten
    this.vTarget.set(p.handRX, p.handRY, p.handRZ);
    this.vPole.set(-0.5, -0.8, -0.4);
    solveTwoBone(this.vShoulderR, this.vTarget, UPPER_ARM, FOREARM, this.vPole, this.vJoint, this.vEnd);
    this.segment(this.upperArmR, this.vShoulderR, this.vJoint);
    this.segment(this.forearmR, this.vJoint, this.vEnd);
    this.handR.position.copy(this.vEnd);
    this.vHandR.copy(this.vEnd);

    // Schwert
    this.vBlade.set(p.bladeX, p.bladeY, p.bladeZ);
    if (this.vBlade.lengthSq() < 1e-6) this.vBlade.set(0, 1, 0);
    this.vBlade.normalize();
    this.sword.position.copy(this.vHandR);
    this.sword.quaternion.setFromUnitVectors(UP, this.vBlade);
    this.sword.visible = !weaponBroken;
    // Ohne Schwert: geballte Faeuste.
    const fist = weaponBroken ? 1.35 : 1;
    this.handR.scale.setScalar(fist);
    this.handL.scale.setScalar(fist);

    // linker Arm: frei oder am Griff unter der rechten Hand
    const grip = weaponBroken || withShield ? 0 : Math.max(0, Math.min(1, p.grip));
    this.vTarget.set(p.handLX, p.handLY, p.handLZ);
    this.vTmp.copy(this.vHandR).addScaledVector(this.vBlade, -GRIP_OFFSET);
    this.vTarget.lerp(this.vTmp, grip);
    this.vPole.set(0.5, -0.8, -0.4);
    solveTwoBone(this.vShoulderL, this.vTarget, UPPER_ARM, FOREARM, this.vPole, this.vJoint, this.vEnd);
    this.segment(this.upperArmL, this.vShoulderL, this.vJoint);
    this.segment(this.forearmL, this.vJoint, this.vEnd);
    this.handL.position.copy(this.vEnd);

    // Schild an der linken Hand, Flaeche in die vorgegebene Richtung
    this.shield.visible = withShield;
    if (withShield) {
      this.vShield.set(p.shieldX, p.shieldY, p.shieldZ);
      if (this.vShield.lengthSq() < 1e-6) this.vShield.set(0, 0, 1);
      this.vShield.normalize();
      this.shield.position.copy(this.vEnd);
      this.shield.quaternion.setFromUnitVectors(UP, this.vShield);
    }

    // Beine: Knie nach vorn, leicht nach aussen
    this.vHipR.set(-HIP_X, 0, 0).applyQuaternion(this.qPelvis).add(this.vPelvis);
    this.vHipL.set(HIP_X, 0, 0).applyQuaternion(this.qPelvis).add(this.vPelvis);

    this.vTarget.set(p.footRX, p.footRY, p.footRZ);
    this.vPole.set(-0.25, 0.1, 1);
    solveTwoBone(this.vHipR, this.vTarget, THIGH, SHIN, this.vPole, this.vJoint, this.vEnd);
    this.segment(this.thighR, this.vHipR, this.vJoint);
    this.segment(this.shinR, this.vJoint, this.vEnd);
    this.footR.position.set(this.vEnd.x, this.vEnd.y - 0.03, this.vEnd.z + 0.06);

    this.vTarget.set(p.footLX, p.footLY, p.footLZ);
    this.vPole.set(0.25, 0.1, 1);
    solveTwoBone(this.vHipL, this.vTarget, THIGH, SHIN, this.vPole, this.vJoint, this.vEnd);
    this.segment(this.thighL, this.vHipL, this.vJoint);
    this.segment(this.shinL, this.vJoint, this.vEnd);
    this.footL.position.set(this.vEnd.x, this.vEnd.y - 0.03, this.vEnd.z + 0.06);
  }

  /** Streckt einen Zylinder der Laenge 1 von `from` nach `to`. */
  private segment(mesh: Mesh, from: Vector3, to: Vector3): void {
    this.vTmp.subVectors(to, from);
    const len = Math.max(1e-4, this.vTmp.length());
    mesh.position.copy(from).addScaledVector(this.vTmp, 0.5);
    mesh.quaternion.setFromUnitVectors(UP, this.vTmp.multiplyScalar(1 / len));
    mesh.scale.set(1, len, 1);
  }

  private material(color: number, roughness: number, metalness = 0): MeshStandardMaterial {
    const m = new MeshStandardMaterial({ color: new Color(color), roughness, metalness });
    this.materials.push(m);
    return m;
  }

  private box(w: number, h: number, d: number, material: MeshStandardMaterial): Mesh {
    const g = new BoxGeometry(w, h, d);
    this.geometries.push(g);
    const mesh = new Mesh(g, material);
    mesh.castShadow = true;
    this.body.add(mesh);
    return mesh;
  }

  private sphere(radius: number, material: MeshStandardMaterial): Mesh {
    const g = new SphereGeometry(radius, 16, 12);
    this.geometries.push(g);
    const mesh = new Mesh(g, material);
    mesh.castShadow = true;
    this.body.add(mesh);
    return mesh;
  }

  /** Zylinder der Laenge 1 entlang Y, Mitte im Ursprung. */
  private limb(radius: number, material: MeshStandardMaterial): Mesh {
    const g = new CylinderGeometry(radius, radius * 0.88, 1, 12);
    this.geometries.push(g);
    const mesh = new Mesh(g, material);
    mesh.castShadow = true;
    this.body.add(mesh);
    return mesh;
  }
}

/** Fabrik fuer die Figur aus Grundformen. */
export const createPrimitiveFighter: FighterVisualFactory = (options) => new PrimitiveFighter(options);
