// Federnde Teile: Helmbusch und Wappenrock.
//
// Sie werden nicht von Hand bewegt. Jedes Glied ist eine kleine Masse an
// einem Faden fester Laenge; sie will weiter dorthin, wo sie eben noch war
// (Traegheit), faellt nach unten (Schwerkraft) und wird zu ihrer Ruhelage
// zurueckgezogen (Steifigkeit). Bewegt sich der Koerper, schwingen sie nach.
// Gerechnet wird in Weltkoordinaten mit festem Zeitschritt - das Ergebnis
// haengt nicht von der Bildrate ab.

import { Quaternion, Vector3, type Bone, type Object3D } from 'three';

export interface ChainSettings {
  /** Laenge eines Glieds (m). */
  segment: number;
  /** Richtung der Kette im Raum des Elternknochens: +1 = nach oben (+Y), -1 = nach unten. */
  direction: 1 | -1;
  /** Rueckstellkraft zur Ruhelage (1/s^2). 0 = haengt nur an der Schwerkraft. */
  stiffness: number;
  /** Bremse (1/s). */
  damping: number;
  /** Schwerkraft (m/s^2). */
  gravity: number;
}

/** Fester Rechenschritt (s) und Obergrenze je Bild. */
const STEP = 1 / 240;
const MAX_STEPS = 12;
/** Springt der Ansatzpunkt weiter als das (m), wird die Kette neu angelegt statt gezerrt. */
const TELEPORT = 0.9;
/** Rechenschritte, mit denen eine neu angelegte Kette zur Ruhe kommt. */
const SETTLE_STEPS = 160;

/**
 * Darf eine Masse verschieben, damit sie nicht in den Koerper eindringt.
 * `point` und `anchor` (das Gelenk, an dem das Glied haengt) liegen im Raum
 * des Elternknochens; `point` wird an Ort und Stelle geaendert.
 */
export type Collider = (point: Vector3, anchor: Vector3, index: number) => void;

export class SpringChain {
  private readonly parent: Object3D;
  private readonly bones: readonly Bone[];
  private readonly settings: ChainSettings;
  private readonly collider: Collider | null;
  private readonly points: Vector3[] = [];
  private readonly previous: Vector3[] = [];
  private readonly axis: Vector3;
  private readonly hinge = new Vector3();
  private readonly lastHinge = new Vector3();
  private readonly rest = new Vector3();
  private readonly tmp = new Vector3();
  private readonly dir = new Vector3();
  private readonly localAnchor = new Vector3();
  private readonly qParent = new Quaternion();
  private readonly qInv = new Quaternion();
  private readonly qBone = new Quaternion();
  private carry = 0;
  private ready = false;

  /**
   * `bones[0]` haengt am Elternknochen, jeder weitere am vorigen, jeweils um
   * `segment` entlang der Kettenrichtung versetzt.
   */
  constructor(bones: readonly Bone[], settings: ChainSettings, collider: Collider | null = null) {
    if (!bones[0].parent) throw new Error('SpringChain: Der erste Knochen braucht einen Elternknochen.');
    this.parent = bones[0].parent;
    this.bones = bones;
    this.settings = settings;
    this.collider = collider;
    this.axis = new Vector3(0, settings.direction, 0);
    for (let i = 0; i < bones.length; i++) {
      this.points.push(new Vector3());
      this.previous.push(new Vector3());
    }
  }

  /** Kette in die Ruhelage legen (Start, Neustart, Sprung der Figur). */
  reset(): void {
    this.ready = false;
  }

  update(dtSeconds: number): void {
    this.parent.updateWorldMatrix(true, false);
    this.hinge.copy(this.bones[0].position).applyMatrix4(this.parent.matrixWorld);
    this.parent.getWorldQuaternion(this.qParent);
    this.rest.copy(this.axis).applyQuaternion(this.qParent);

    if (!this.ready || this.hinge.distanceTo(this.lastHinge) > TELEPORT) {
      for (let i = 0; i < this.points.length; i++) {
        this.points[i].copy(this.hinge).addScaledVector(this.rest, this.settings.segment * (i + 1));
        this.previous[i].copy(this.points[i]);
      }
      this.ready = true;
      this.carry = 0;
      // Einschwingen, damit die Kette nicht sichtbar aus der Geraden faellt.
      for (let i = 0; i < SETTLE_STEPS; i++) this.integrate();
    }
    this.lastHinge.copy(this.hinge);

    this.carry += Math.min(Math.max(dtSeconds, 0), STEP * MAX_STEPS);
    while (this.carry >= STEP) {
      this.carry -= STEP;
      this.integrate();
    }
    this.pose();
  }

  private integrate(): void {
    const s = this.settings;
    const keep = Math.max(0, 1 - s.damping * STEP);
    const h2 = STEP * STEP;
    for (let i = 0; i < this.points.length; i++) {
      const p = this.points[i];
      const prev = this.previous[i];
      this.tmp.subVectors(p, prev).multiplyScalar(keep);
      prev.copy(p);
      p.add(this.tmp);
      p.y -= s.gravity * h2;
      if (s.stiffness > 0) {
        // Ruhelage dieses Glieds: gerade Verlaengerung des Elternknochens.
        this.tmp.copy(this.hinge).addScaledVector(this.rest, s.segment * (i + 1)).sub(p);
        p.addScaledVector(this.tmp, s.stiffness * h2);
      }
      // Fadenlaenge zum vorigen Glied halten.
      const anchor = i === 0 ? this.hinge : this.points[i - 1];
      this.tmp.subVectors(p, anchor);
      const len = this.tmp.length();
      if (len > 1e-6) p.copy(anchor).addScaledVector(this.tmp, s.segment / len);
      else p.copy(anchor).addScaledVector(this.rest, s.segment);
      if (this.collider) {
        // Im Raum des Elternknochens pruefen, zurueck in die Welt.
        this.parent.worldToLocal(p);
        this.parent.worldToLocal(this.localAnchor.copy(anchor));
        this.collider(p, this.localAnchor, i);
        this.parent.localToWorld(p);
      }
    }
  }

  /** Knochen auf die Massen ausrichten. */
  private pose(): void {
    // `qBone` laeuft als Welt-Lage des jeweils vorigen Knochens mit.
    this.qBone.copy(this.qParent);
    for (let i = 0; i < this.bones.length; i++) {
      const anchor = i === 0 ? this.hinge : this.points[i - 1];
      this.dir.subVectors(this.points[i], anchor).normalize();
      this.dir.applyQuaternion(this.qInv.copy(this.qBone).invert());
      this.bones[i].quaternion.setFromUnitVectors(this.axis, this.dir);
      this.qBone.multiply(this.bones[i].quaternion);
    }
  }
}
