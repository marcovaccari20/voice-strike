// Gelenkfigur: der Ritter als nackte Grundformen, genau in den Massen aus
// proportions.ts. Sie zeigt das Skelett ohne Verkleidung - in der
// Figuren-Werkstatt (figur.html) laesst sich damit pruefen, ob eine Bewegung
// stimmt, unabhaengig vom Aussehen.

import {
  BoxGeometry,
  CapsuleGeometry,
  ConeGeometry,
  CylinderGeometry,
  Mesh,
  MeshStandardMaterial,
  SphereGeometry,
  type BufferGeometry,
  type Object3D,
} from 'three';
import { BODY, VOLUMES, type VolumeId } from './proportions';
import type { BoneName } from './skeleton';
import type { KnightMeshBuilder } from './types';

export const buildBlockout: KnightMeshBuilder = (skeleton, look) => {
  const geometries: BufferGeometry[] = [];
  const materials: MeshStandardMaterial[] = [];
  const b = skeleton.bones;

  const material = (color: number, roughness = 0.7, metalness = 0): MeshStandardMaterial => {
    const m = new MeshStandardMaterial({ color, roughness, metalness });
    materials.push(m);
    return m;
  };
  const steel = material(0xb9b4ad, 0.45, 0.6);
  const bronze = material(0xb9794f, 0.5, 0.5);
  const skin = material(0xe59a62, 0.75);
  const glove = material(0xf0b98c, 0.8);
  const cloth = material(look.tabard, 0.8);
  const trim = material(look.trim, 0.7);
  const plume = material(look.plume, 0.9);
  const wood = material(0x9a6238, 0.85);
  const leather = material(0x8a5a36, 0.8);

  const add = (parent: Object3D, geometry: BufferGeometry, mat: MeshStandardMaterial, x = 0, y = 0, z = 0): Mesh => {
    geometries.push(geometry);
    const mesh = new Mesh(geometry, mat);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    parent.add(mesh);
    return mesh;
  };
  /** Glied entlang -Y vom Gelenk aus. */
  const limb = (bone: BoneName, length: number, radius: number, mat: MeshStandardMaterial): Mesh =>
    add(b[bone], new CapsuleGeometry(radius, length, 6, 14), mat, 0, -length / 2, 0);
  const volume = (id: VolumeId, mat: MeshStandardMaterial): Mesh => {
    const v = VOLUMES[id];
    const mesh = add(b[v.bone], new SphereGeometry(1, 24, 16), mat, v.center[0], v.center[1], v.center[2]);
    mesh.scale.set(v.radius[0], v.radius[1], v.radius[2]);
    return mesh;
  };

  volume('helmet', steel);
  volume('chest', cloth);
  volume('belly', cloth);
  volume('hips', bronze);
  volume('pauldronL', bronze).removeFromParent();
  volume('pauldronR', bronze).removeFromParent();
  // Schulterplatten sitzen auf dem Schulterknochen, der dem Oberarm nur teilweise folgt.
  for (const [side, sx] of [['L', 1], ['R', -1]] as const) {
    const pad = add(b[`Shoulder.${side}`], new SphereGeometry(1, 20, 14), bronze, sx * 0.03, 0.02, 0);
    pad.scale.set(0.15, 0.13, 0.15);
    limb(`UpperArm.${side}`, BODY.upperArm, 0.09, skin);
    limb(`LowerArm.${side}`, BODY.forearm, 0.085, glove);
    add(b[`Hand.${side}`], new SphereGeometry(0.085, 16, 12), glove);
    limb(`UpperLeg.${side}`, BODY.thigh, 0.105, bronze);
    limb(`LowerLeg.${side}`, BODY.shin, 0.095, steel);
    add(b[`LowerLeg.${side}`], new SphereGeometry(0.105, 16, 12), steel, 0, 0, 0.02);
    const sole = (BODY.footFront - BODY.footBack) / 2;
    add(
      b[`Foot.${side}`],
      new BoxGeometry(BODY.footWidth, BODY.ankleHeight, BODY.footFront + BODY.footBack),
      steel,
      0,
      -BODY.ankleHeight / 2,
      sole,
    );
  }
  // Visier: zeigt, wohin der Kopf schaut.
  add(b.Head, new BoxGeometry(0.3, 0.035, 0.05), material(0x30241c, 0.9), 0, 0.3, 0.215);

  const blade = BODY.bladeEnd - BODY.bladeStart;
  const sword = [
    add(b.Sword, new BoxGeometry(0.022, blade, BODY.bladeWidth), steel, 0, BODY.bladeStart + blade / 2, 0),
    add(b.Sword, new BoxGeometry(0.05, 0.045, 0.27), leather, 0, BODY.bladeStart - 0.02, 0),
    add(b.Sword, new CylinderGeometry(0.025, 0.025, 0.2, 10), leather, 0, -0.03, 0),
  ];
  const disc = add(b.Shield, new CylinderGeometry(BODY.shieldRadius, BODY.shieldRadius, 0.05, 32), wood);
  disc.rotation.x = Math.PI / 2;
  const cross = [
    add(b.Shield, new BoxGeometry(0.1, BODY.shieldRadius * 1.5, 0.012), cloth, 0, 0, 0.028),
    add(b.Shield, new BoxGeometry(BODY.shieldRadius * 1.1, 0.1, 0.012), cloth, 0, 0.05, 0.028),
  ];
  const shield = [disc, ...cross];

  for (const name of ['Plume1', 'Plume2', 'Plume3'] as const) {
    add(b[name], new ConeGeometry(0.06, BODY.plumeSegment * 1.3, 10), plume, 0, BODY.plumeSegment / 2, 0);
  }
  for (const name of ['TabardFront1', 'TabardFront2', 'TabardBack1', 'TabardBack2'] as const) {
    add(b[name], new BoxGeometry(0.3, BODY.tabardSegment, 0.03), name.endsWith('1') ? cloth : trim, 0, -BODY.tabardSegment / 2, 0);
  }

  return {
    setFlash(glow) {
      for (const m of materials) m.emissive.setScalar(glow * 0.9);
    },
    setLoadout(armed, withShield) {
      for (const m of sword) m.visible = armed;
      for (const m of shield) m.visible = withShield;
    },
    dispose() {
      for (const g of geometries) g.dispose();
      for (const m of materials) m.dispose();
    },
  };
};
