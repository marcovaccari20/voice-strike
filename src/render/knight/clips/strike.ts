// Der Hieb von oben ("strike", Linie "high").
//
// Lesbar soll er sein, lange bevor er faellt: Die Waffe steht hoch neben dem
// Helm, die Brust oeffnet sich nach rechts, das Gewicht sitzt auf dem hinteren
// Bein. Erst im letzten Sechstel des Ausholens faellt der Hieb - aus dem
// hinteren Bein heraus, ueber Becken, Brust und Schulter in die Klinge - und
// landet bei Fortschritt 1 auf Helm und Schultern des Gegners.
//
// Die Haltung ist aus Schichten gebaut (Becken, Rumpf, Schwertarm, Klinge,
// linker Arm, je ein Fuss), jede mit eigenen Stuetzhaltungen. So kommen die
// Glieder der Kette nacheinander an, und ein stehender Fuss bleibt stehen,
// auch wenn der Arm gerade in einem Bogen durch seine Stuetzhaltung laeuft.

import type { FighterAnimInput } from '../../fighterVisual';
import { STANCE, copyPose, key, newPose, ramp, sampleTrack, type Loadout, type Pose, type PoseKey, type Track } from '../pose';
import { byLoadout, type ClipFn } from './common';

/** Eine Schicht: Welche Kanaele sie stellt und wie sie verlaufen. */
interface Layer {
  channels: readonly PoseKey[];
  track: Track;
}

/** Ausholen und Nachlauf als Schichten. */
interface Strike {
  /** Fortschritt, bei dem die Beine losbrechen; bis dahin lebt die gehaltene Haltung. */
  launch: number;
  windup: readonly Layer[];
  recover: readonly Layer[];
}

const PELVIS: readonly PoseKey[] = ['hipX', 'hipY', 'hipZ', 'hipPitch', 'hipYaw', 'hipRoll'];
const TRUNK: readonly PoseKey[] = ['spinePitch', 'spineYaw', 'spineRoll', 'headPitch', 'headYaw', 'headRoll', 'shrugR', 'shrugL'];
const ARM_R: readonly PoseKey[] = ['handRX', 'handRY', 'handRZ', 'elbowR'];
const BLADE: readonly PoseKey[] = ['bladeX', 'bladeY', 'bladeZ', 'bladeRoll'];
const ARM_L: readonly PoseKey[] = ['handLX', 'handLY', 'handLZ', 'elbowL', 'grip', 'shieldX', 'shieldY', 'shieldZ'];
const FOOT_R: readonly PoseKey[] = ['footRX', 'footRY', 'footRZ', 'footRYaw', 'footRPitch', 'kneeR'];
const FOOT_L: readonly PoseKey[] = ['footLX', 'footLY', 'footLZ', 'footLYaw', 'footLPitch', 'kneeL'];

const scratch = newPose();

function sampleLayers(layers: readonly Layer[], t: number, out: Pose): void {
  copyPose(STANCE, out);
  for (const layer of layers) {
    sampleTrack(layer.track, t, scratch);
    for (const k of layer.channels) out[k] = scratch[k];
  }
}

// ---------------------------------------------------------------------------
// Schwert und Schild
// ---------------------------------------------------------------------------

const SHIELD: Strike = {
  launch: 0.78,
  windup: [
    {
      // Gewicht aufs hintere Bein, tiefer sinken - dann Abdruck und Ausfall.
      channels: PELVIS,
      track: [
        key(0),
        key(0.3, { hipX: -0.03, hipY: 0.488, hipZ: -0.05, hipYaw: -0.38, hipPitch: 0.04 }, 'smooth'),
        key(0.78, { hipX: -0.06, hipY: 0.442, hipZ: -0.12, hipYaw: -0.43, hipPitch: 0.02 }, 'linear'),
        key(0.83, { hipX: -0.05, hipY: 0.455, hipZ: -0.045, hipYaw: -0.345, hipPitch: 0.05 }, 'in'),
        key(0.9, { hipX: -0.01, hipY: 0.48, hipZ: 0.26, hipYaw: 0.02, hipPitch: 0.11 }, 'linear', 0.8),
        key(0.96, { hipX: 0.015, hipY: 0.488, hipZ: 0.5, hipYaw: 0.27, hipPitch: 0.12 }, 'linear', 0.6),
        key(1, { hipX: 0.02, hipY: 0.488, hipZ: 0.55, hipYaw: 0.3, hipPitch: 0.12 }, 'linear'),
      ],
    },
    {
      // Brust oeffnet sich nach rechts; im Hieb bleibt sie hinter dem Becken zurueck und schnellt nach.
      channels: TRUNK,
      track: [
        key(0),
        key(0.27, { spinePitch: 0.05, spineYaw: -0.22, spineRoll: -0.03, shrugR: 0.3 }, 'smooth'),
        key(0.8, { spinePitch: 0, spineYaw: -0.28, spineRoll: -0.05, shrugR: 0.5 }, 'linear'),
        key(0.87, { spinePitch: -0.02, spineYaw: -0.36, spineRoll: -0.04, shrugR: 0.6 }, 'smooth'),
        key(0.92, { spinePitch: 0.03, spineYaw: -0.19, spineRoll: -0.02, shrugR: 0.7 }, 'in'),
        key(0.975, { spinePitch: 0.2, spineYaw: 0.42, spineRoll: 0.03, shrugR: 0.8 }, 'linear', 0.5),
        key(1, { spinePitch: 0.22, spineYaw: 0.45, spineRoll: 0.03, shrugR: 0.8 }, 'linear'),
      ],
    },
    {
      // Schwerthand: in einem Bogen aussen hoch neben den Helm, im Hieb ueber die Schulter nach vorn.
      channels: ARM_R,
      track: [
        key(0),
        key(0.12, { handRX: -0.5, handRY: 1.08, handRZ: 0.16, elbowR: 0.1 }, 'in', 1),
        key(0.25, { handRX: -0.4, handRY: 1.41, handRZ: 0.14, elbowR: -0.1 }, 'out'),
        key(0.8, { handRX: -0.43, handRY: 1.45, handRZ: 0.13, elbowR: -0.2 }, 'linear'),
        key(0.88, { handRX: -0.42, handRY: 1.46, handRZ: 0.11, elbowR: -0.1 }, 'in'),
        key(0.94, { handRX: -0.4, handRY: 1.46, handRZ: 0.23, elbowR: 0.1 }, 'linear', 0.9),
        key(0.978, { handRX: -0.36, handRY: 1.37, handRZ: 0.31, elbowR: 0.3 }, 'linear', 0.4),
        key(1, { handRX: -0.36, handRY: 1.36, handRZ: 0.32, elbowR: 0.3 }, 'linear'),
      ],
    },
    {
      // Klinge: steil nach oben, etwas nach hinten und aussen; im Hieb legt sie sich erst zurueck, dann peitscht sie ueber.
      channels: BLADE,
      track: [
        key(0),
        key(0.13, { bladeX: -0.05, bladeY: 1, bladeZ: 0.25, bladeRoll: 0.2 }, 'in', 1),
        key(0.28, { bladeX: -0.52, bladeY: 0.84, bladeZ: -0.1, bladeRoll: 0.5 }, 'out'),
        key(0.8, { bladeX: -0.66, bladeY: 0.76, bladeZ: -0.04, bladeRoll: 0.5 }, 'linear'),
        key(0.89, { bladeX: -0.35, bladeY: 0.4, bladeZ: -0.85, bladeRoll: 0.15 }, 'smooth'),
        key(0.94, { bladeX: -0.47, bladeY: 0.6, bladeZ: -0.62 }, 'in'),
        key(0.985, { bladeX: -0.66, bladeY: 0.77, bladeZ: 0.47 }, 'linear', 0.3),
        key(1, { bladeX: -0.66, bladeY: 0.745, bladeZ: 0.49 }, 'linear'),
      ],
    },
    {
      // Schild bleibt vorn als Deckung; im Hieb schwingt er als Gegengewicht zurueck.
      channels: ARM_L,
      track: [
        key(0),
        key(0.22, { handLX: 0.33, handLY: 0.99, handLZ: 0.31, shieldX: 0.56, shieldY: 0.1, shieldZ: 0.82 }, 'smooth'),
        key(0.8, { handLX: 0.37, handLY: 1.02, handLZ: 0.3, shieldX: 0.66, shieldY: 0.12, shieldZ: 0.74 }, 'linear'),
        key(0.89, { handLX: 0.35, handLY: 0.98, handLZ: 0.31, shieldX: 0.6, shieldY: 0.1, shieldZ: 0.8 }, 'smooth'),
        key(0.98, { handLX: 0.3, handLY: 0.86, handLZ: 0.24, shieldX: -0.1, shieldY: 0.05, shieldZ: 1 }, 'in'),
        key(1, { handLX: 0.3, handLY: 0.86, handLZ: 0.24, shieldX: -0.1, shieldY: 0.05, shieldZ: 1 }),
      ],
    },
    {
      // Vorderer Fuss: abrollen, Ausfallschritt, mit der Ferse zuerst aufsetzen.
      channels: FOOT_L,
      track: [
        key(0),
        key(0.5),
        key(0.78, { footLPitch: 0.12 }, 'smooth'),
        key(0.8, { footLY: 0.012, footLPitch: 0.32 }, 'linear'),
        key(0.87, { footLZ: 0.4, footLY: 0.065, footLPitch: 0.05, footLYaw: 0.08 }, 'linear'),
        key(0.92, { footLZ: 0.56, footLY: 0.05, footLPitch: -0.15, footLYaw: 0.1 }, 'linear'),
        key(0.955, { footLZ: 0.68, footLY: 0.012, footLPitch: -0.2, footLYaw: 0.1 }, 'linear'),
        key(0.975, { footLZ: 0.68, footLYaw: 0.1 }, 'linear'),
        key(1, { footLZ: 0.68, footLYaw: 0.1 }),
      ],
    },
    {
      // Hinterer Fuss: drueckt ab, die Ferse hebt sich, dann schleift er auf der Spitze nach.
      channels: FOOT_R,
      track: [
        key(0),
        key(0.8),
        key(0.86, { footRPitch: 0.5 }, 'linear'),
        key(0.97, { footRX: -0.15, footRZ: 0.22, footRPitch: 0.9, footRYaw: -0.25 }, 'linear'),
        key(1, { footRX: -0.15, footRZ: 0.23, footRPitch: 0.9, footRYaw: -0.25 }, 'linear'),
      ],
    },
  ],
  recover: [
    {
      // Der Koerper faengt den Hieb im vorderen Knie ab, dann drueckt er sich in einem flachen Satz zurueck.
      channels: PELVIS,
      track: [
        key(0, { hipX: 0.02, hipY: 0.488, hipZ: 0.55, hipYaw: 0.3, hipPitch: 0.12 }),
        key(0.16, { hipX: 0.025, hipY: 0.46, hipZ: 0.565, hipYaw: 0.34, hipPitch: 0.15 }, 'out'),
        key(0.3, { hipX: 0.025, hipY: 0.475, hipZ: 0.525, hipYaw: 0.3, hipPitch: 0.13 }, 'in'),
        key(0.42, { hipX: 0.02, hipY: 0.494, hipZ: 0.42, hipYaw: 0.18, hipPitch: 0.11 }, 'linear', 1),
        key(0.55, { hipX: 0, hipY: 0.505, hipZ: 0.28, hipYaw: 0, hipPitch: 0.09 }, 'linear', 1),
        key(0.7, { hipX: -0.015, hipY: 0.49, hipZ: 0.12, hipYaw: -0.18, hipPitch: 0.07 }, 'linear', 1),
        key(0.84, { hipX: -0.02, hipY: 0.472, hipZ: 0.03, hipYaw: -0.28, hipPitch: 0.07 }, 'linear', 1),
        key(1, {}, 'out'),
      ],
    },
    {
      channels: TRUNK,
      track: [
        key(0, { spinePitch: 0.22, spineYaw: 0.45, spineRoll: 0.03, shrugR: 0.8 }),
        key(0.18, { spinePitch: 0.27, spineYaw: 0.49, spineRoll: 0.04, shrugR: 0.6 }, 'out'),
        key(0.6, { spinePitch: 0.17, spineYaw: 0.12, spineRoll: 0, shrugR: 0.2 }, 'in', 0.8),
        key(1, {}, 'out'),
      ],
    },
    {
      // Die Klinge beisst sich fest, der Arm gibt nach; dann zieht der Ellbogen das Schwert an die Huefte zurueck.
      channels: ARM_R,
      track: [
        key(0, { handRX: -0.36, handRY: 1.36, handRZ: 0.32, elbowR: 0.3 }),
        key(0.14, { handRX: -0.37, handRY: 1.33, handRZ: 0.23, elbowR: 0.25 }, 'out'),
        key(0.4, { handRX: -0.4, handRY: 1.13, handRZ: 0.13, elbowR: 0.2 }, 'linear', 1),
        key(0.7, { handRX: -0.4, handRY: 0.912, handRZ: 0.152, elbowR: 0.16 }, 'linear'),
        key(1, {}, 'out'),
      ],
    },
    {
      channels: BLADE,
      track: [
        key(0, { bladeX: -0.66, bladeY: 0.745, bladeZ: 0.49 }),
        key(0.16, { bladeX: -0.68, bladeY: 0.66, bladeZ: 0.47 }, 'out'),
        key(0.45, { bladeX: -0.34, bladeY: 0.65, bladeZ: 0.67 }, 'linear', 1),
        key(0.75, { bladeX: 0.16, bladeY: 0.71, bladeZ: 0.63 }, 'linear'),
        key(1, {}, 'out'),
      ],
    },
    {
      // Der Schild kommt als Erstes wieder vor den Leib.
      channels: ARM_L,
      track: [
        key(0, { handLX: 0.3, handLY: 0.86, handLZ: 0.24, shieldX: -0.1, shieldY: 0.05, shieldZ: 1 }),
        key(0.16, { handLX: 0.3, handLY: 0.85, handLZ: 0.23, shieldX: -0.1, shieldY: 0.05, shieldZ: 1 }, 'out'),
        key(0.75, { handLX: 0.28, handLY: 0.94, handLZ: 0.3, shieldX: 0.3, shieldY: 0.06, shieldZ: 0.95 }, 'smooth'),
        key(1, {}, 'smooth'),
      ],
    },
    {
      // Vorderer Fuss: drueckt ueber die Ferse ab und setzt zurueck.
      channels: FOOT_L,
      track: [
        key(0, { footLZ: 0.68, footLYaw: 0.1 }),
        key(0.3, { footLZ: 0.68, footLYaw: 0.1 }),
        key(0.36, { footLZ: 0.68, footLY: 0.012, footLPitch: -0.25, footLYaw: 0.1 }, 'linear'),
        key(0.5, { footLZ: 0.56, footLY: 0.055, footLPitch: -0.05, footLYaw: 0.08 }, 'linear'),
        key(0.68, { footLZ: 0.36, footLY: 0.055, footLPitch: 0.2 }, 'linear'),
        key(0.86, { footLY: 0.012, footLPitch: 0.3 }, 'linear'),
        key(0.94, {}, 'linear'),
        key(1),
      ],
    },
    {
      // Hinterer Fuss: geht als Erster zurueck und faengt das Gewicht auf dem Ballen.
      channels: FOOT_R,
      track: [
        key(0, { footRX: -0.15, footRZ: 0.23, footRPitch: 0.9, footRYaw: -0.25 }),
        key(0.16, { footRX: -0.15, footRZ: 0.23, footRPitch: 0.8, footRYaw: -0.25 }),
        key(0.2, { footRX: -0.15, footRZ: 0.23, footRY: 0.012, footRPitch: 0.8, footRYaw: -0.25 }, 'linear'),
        key(0.42, { footRX: -0.16, footRZ: 0.12, footRY: 0.045, footRPitch: 0.65, footRYaw: -0.35 }, 'linear'),
        key(0.55, { footRX: -0.165, footRZ: -0.03, footRY: 0.05, footRPitch: 0.6, footRYaw: -0.45 }, 'linear'),
        key(0.68, { footRY: 0.012, footRPitch: 0.5 }, 'linear'),
        key(0.82, {}, 'linear'),
        key(1),
      ],
    },
  ],
};

// ---------------------------------------------------------------------------
// Nur Schwert: beidhaendig von der rechten Schulter
// ---------------------------------------------------------------------------

const SWORD: Strike = {
  launch: 0.76,
  windup: [
    {
      // Erst richtet er sich mit dem Schwert auf, dann setzt er sich ins hintere Bein; der Ausfall ist laenger.
      channels: PELVIS,
      track: [
        key(0),
        key(0.3, { hipX: -0.02, hipY: 0.518, hipZ: -0.04, hipYaw: -0.38, hipPitch: 0.04 }, 'smooth'),
        key(0.76, { hipX: -0.055, hipY: 0.47, hipZ: -0.11, hipYaw: -0.46, hipPitch: 0.02 }, 'linear'),
        key(0.81, { hipX: -0.045, hipY: 0.472, hipZ: -0.03, hipYaw: -0.4, hipPitch: 0.05 }, 'in'),
        key(0.89, { hipX: -0.01, hipY: 0.482, hipZ: 0.33, hipYaw: -0.16, hipPitch: 0.1 }, 'linear', 0.8),
        key(0.97, { hipX: 0.02, hipY: 0.488, hipZ: 0.68, hipYaw: 0.03, hipPitch: 0.12 }, 'linear', 0.5),
        key(1, { hipX: 0.02, hipY: 0.488, hipZ: 0.7, hipYaw: 0.04, hipPitch: 0.12 }, 'linear'),
      ],
    },
    {
      // Der Kopf neigt sich dem Schwert aus dem Weg; der Rumpf lehnt zurueck und klappt im Hieb nach vorn.
      channels: TRUNK,
      track: [
        key(0),
        key(0.27, { spinePitch: 0.04, spineYaw: -0.26, spineRoll: -0.02, shrugL: 0.8, shrugR: 0.6, headRoll: 0.15 }, 'smooth'),
        key(0.78, { spinePitch: -0.02, spineYaw: -0.34, spineRoll: -0.04, shrugL: 0.8, shrugR: 0.7, headRoll: 0.17 }, 'linear'),
        key(0.86, { spinePitch: -0.04, spineYaw: -0.36, spineRoll: -0.03, shrugL: 0.8, shrugR: 0.7, headRoll: 0.18 }, 'smooth'),
        key(0.92, { spinePitch: 0.01, spineYaw: -0.27, spineRoll: -0.02, shrugL: 0.75, shrugR: 0.65, headRoll: 0.15 }, 'in'),
        key(0.98, { spinePitch: 0.19, spineYaw: 0.07, shrugL: 0.6, shrugR: 0.5 }, 'linear', 0.4),
        key(1, { spinePitch: 0.2, spineYaw: 0.08, shrugL: 0.6, shrugR: 0.5 }, 'linear'),
      ],
    },
    {
      // Rechte Hand: erst zur Mitte, wo die linke zugreift, dann beide vor die rechte Schulter; im Hieb nach vorn.
      channels: ARM_R,
      track: [
        key(0),
        key(0.1, { handRX: -0.08, handRY: 1.1, handRZ: 0.3, elbowR: 0.1 }, 'in', 1),
        key(0.18, { handRX: -0.12, handRY: 1.2, handRZ: 0.2, elbowR: 0 }, 'linear', 1),
        key(0.27, { handRX: -0.175, handRY: 1.24, handRZ: 0.1, elbowR: 0 }, 'out'),
        key(0.78, { handRX: -0.17, handRY: 1.25, handRZ: 0.08, elbowR: 0 }, 'linear'),
        key(0.87, { handRX: -0.12, handRY: 1.25, handRZ: 0.15, elbowR: 0 }, 'in'),
        key(0.93, { handRX: -0.075, handRY: 1.26, handRZ: 0.26, elbowR: 0 }, 'linear', 0.9),
        key(0.98, { handRX: -0.07, handRY: 1.21, handRZ: 0.345, elbowR: 0 }, 'linear', 0.4),
        key(1, { handRX: -0.07, handRY: 1.2, handRZ: 0.35, elbowR: 0 }, 'linear'),
      ],
    },
    {
      // Klinge: aussen am Helm vorbei ueber die rechte Schulter; im Hieb zurueckgelegt, dann uebergepeitscht.
      channels: BLADE,
      track: [
        key(0),
        key(0.1, { bladeX: -0.1, bladeY: 1, bladeZ: 0.1 }, 'in', 1),
        key(0.18, { bladeX: -0.45, bladeY: 0.88, bladeZ: 0.1 }, 'linear', 1),
        key(0.29, { bladeX: -0.375, bladeY: 0.91, bladeZ: 0.15 }, 'out'),
        key(0.78, { bladeX: -0.42, bladeY: 0.88, bladeZ: -0.04 }, 'linear'),
        key(0.88, { bladeX: -0.52, bladeY: 0.7, bladeZ: -0.5 }, 'smooth'),
        key(0.935, { bladeX: -0.46, bladeY: 0.88, bladeZ: -0.26 }, 'in'),
        key(0.985, { bladeX: -0.1, bladeY: 0.79, bladeZ: 0.6 }, 'linear', 0.3),
        key(1, { bladeX: -0.09, bladeY: 0.76, bladeZ: 0.64 }, 'linear'),
      ],
    },
    {
      // Linke Hand greift unter der rechten an den Griff und bleibt dort.
      channels: ARM_L,
      track: [
        key(0),
        key(0.08, { handLX: 0.05, handLY: 1, handLZ: 0.33, grip: 0.3 }, 'in', 1),
        key(0.14, { handLX: -0.05, handLY: 1.02, handLZ: 0.3, grip: 1 }, 'out'),
        key(1, { handLX: -0.05, handLY: 1.02, handLZ: 0.3, grip: 1 }),
      ],
    },
    {
      channels: FOOT_L,
      track: [
        key(0),
        key(0.5),
        key(0.76, { footLPitch: 0.12 }, 'smooth'),
        key(0.78, { footLY: 0.012, footLPitch: 0.32 }, 'linear'),
        key(0.85, { footLZ: 0.43, footLY: 0.065, footLPitch: 0.05, footLYaw: 0.08 }, 'linear'),
        key(0.91, { footLZ: 0.65, footLY: 0.05, footLPitch: -0.15, footLYaw: 0.1 }, 'linear'),
        key(0.955, { footLZ: 0.83, footLY: 0.012, footLPitch: -0.2, footLYaw: 0.1 }, 'linear'),
        key(0.975, { footLZ: 0.83, footLYaw: 0.1 }, 'linear'),
        key(1, { footLZ: 0.83, footLYaw: 0.1 }),
      ],
    },
    {
      channels: FOOT_R,
      track: [
        key(0),
        key(0.78),
        key(0.84, { footRPitch: 0.5 }, 'linear'),
        key(0.97, { footRX: -0.15, footRZ: 0.35, footRPitch: 0.9, footRYaw: -0.3 }, 'linear'),
        key(1, { footRX: -0.15, footRZ: 0.36, footRPitch: 0.9, footRYaw: -0.3 }, 'linear'),
      ],
    },
  ],
  recover: [
    {
      channels: PELVIS,
      track: [
        key(0, { hipX: 0.02, hipY: 0.488, hipZ: 0.7, hipYaw: 0.04, hipPitch: 0.12 }),
        key(0.16, { hipX: 0.025, hipY: 0.46, hipZ: 0.715, hipYaw: 0.06, hipPitch: 0.15 }, 'out'),
        key(0.3, { hipX: 0.025, hipY: 0.474, hipZ: 0.65, hipYaw: 0.04, hipPitch: 0.13 }, 'in'),
        key(0.42, { hipX: 0.02, hipY: 0.494, hipZ: 0.51, hipYaw: -0.02, hipPitch: 0.11 }, 'linear', 1),
        key(0.55, { hipX: 0, hipY: 0.505, hipZ: 0.33, hipYaw: -0.1, hipPitch: 0.09 }, 'linear', 1),
        key(0.7, { hipX: -0.015, hipY: 0.49, hipZ: 0.13, hipYaw: -0.2, hipPitch: 0.07 }, 'linear', 1),
        key(0.84, { hipX: -0.02, hipY: 0.472, hipZ: 0.03, hipYaw: -0.28, hipPitch: 0.07 }, 'linear', 1),
        key(1, {}, 'out'),
      ],
    },
    {
      channels: TRUNK,
      track: [
        key(0, { spinePitch: 0.2, spineYaw: 0.08, shrugL: 0.6, shrugR: 0.5 }),
        key(0.18, { spinePitch: 0.27, spineYaw: 0.1, shrugL: 0.5, shrugR: 0.4 }, 'out'),
        key(0.6, { spinePitch: 0.16, spineYaw: 0, shrugL: 0.2, shrugR: 0.2 }, 'in', 0.8),
        key(1, {}, 'out'),
      ],
    },
    {
      channels: ARM_R,
      track: [
        key(0, { handRX: -0.07, handRY: 1.2, handRZ: 0.35, elbowR: 0 }),
        key(0.14, { handRX: -0.065, handRY: 1.22, handRZ: 0.28, elbowR: 0 }, 'out'),
        key(0.42, { handRX: -0.08, handRY: 1.06, handRZ: 0.27, elbowR: 0.05 }, 'linear', 1),
        key(0.7, { handRX: -0.316, handRY: 0.9, handRZ: 0.19, elbowR: 0.12 }, 'linear'),
        key(1, {}, 'out'),
      ],
    },
    {
      channels: BLADE,
      track: [
        key(0, { bladeX: -0.09, bladeY: 0.76, bladeZ: 0.64 }),
        key(0.16, { bladeX: -0.12, bladeY: 0.73, bladeZ: 0.68 }, 'out'),
        key(0.45, { bladeX: -0.02, bladeY: 0.72, bladeZ: 0.7 }, 'linear', 1),
        key(0.75, { bladeX: 0.23, bladeY: 0.72, bladeZ: 0.637 }, 'linear'),
        key(1, {}, 'out'),
      ],
    },
    {
      // Die linke Hand laesst den Griff erst los, wenn das Schwert wieder vor dem Leib ist.
      channels: ARM_L,
      track: [
        key(0, { handLX: -0.05, handLY: 1.02, handLZ: 0.3, grip: 1 }),
        key(0.4, { handLX: -0.02, handLY: 0.98, handLZ: 0.3, grip: 1 }),
        key(0.66, { handLX: 0.12, handLY: 0.94, handLZ: 0.32, grip: 0.2 }, 'smooth'),
        key(1, {}, 'smooth'),
      ],
    },
    {
      channels: FOOT_L,
      track: [
        key(0, { footLZ: 0.83, footLYaw: 0.1 }),
        key(0.28, { footLZ: 0.83, footLYaw: 0.1 }),
        key(0.34, { footLZ: 0.83, footLY: 0.012, footLPitch: -0.25, footLYaw: 0.1 }, 'linear'),
        key(0.5, { footLZ: 0.64, footLY: 0.055, footLPitch: -0.05, footLYaw: 0.08 }, 'linear'),
        key(0.68, { footLZ: 0.38, footLY: 0.055, footLPitch: 0.2 }, 'linear'),
        key(0.86, { footLY: 0.012, footLPitch: 0.3 }, 'linear'),
        key(0.94, {}, 'linear'),
        key(1),
      ],
    },
    {
      channels: FOOT_R,
      track: [
        key(0, { footRX: -0.15, footRZ: 0.36, footRPitch: 0.9, footRYaw: -0.3 }),
        key(0.16, { footRX: -0.15, footRZ: 0.36, footRPitch: 0.8, footRYaw: -0.3 }),
        key(0.2, { footRX: -0.15, footRZ: 0.36, footRY: 0.012, footRPitch: 0.8, footRYaw: -0.3 }, 'linear'),
        key(0.42, { footRX: -0.16, footRZ: 0.21, footRY: 0.045, footRPitch: 0.65, footRYaw: -0.35 }, 'linear'),
        key(0.56, { footRX: -0.165, footRZ: 0.02, footRY: 0.05, footRPitch: 0.6, footRYaw: -0.45 }, 'linear'),
        key(0.7, { footRY: 0.012, footRPitch: 0.5 }, 'linear'),
        key(0.83, {}, 'linear'),
        key(1),
      ],
    },
  ],
};

// ---------------------------------------------------------------------------
// Faeuste: Anlauf in zwei Schritten, dann der Hammerschlag ueber die Schulter
// ---------------------------------------------------------------------------

const FISTS: Strike = {
  launch: 0.6,
  windup: [
    {
      // Die Faust reicht nicht weit: Er muss heran - Abdruck hinten, der rechte Fuss geht durch, der linke setzt zum Schlag vor.
      channels: PELVIS,
      track: [
        key(0),
        key(0.28, { hipX: -0.03, hipY: 0.48, hipZ: -0.06, hipYaw: -0.4, hipPitch: 0.05 }, 'smooth'),
        key(0.6, { hipX: -0.055, hipY: 0.45, hipZ: -0.11, hipYaw: -0.46, hipPitch: 0.04 }, 'linear'),
        key(0.68, { hipX: 0.02, hipY: 0.47, hipZ: -0.015, hipYaw: -0.36, hipPitch: 0.08 }, 'in'),
        key(0.8, { hipX: 0.01, hipY: 0.478, hipZ: 0.42, hipYaw: -0.14, hipPitch: 0.1 }, 'linear', 1),
        key(0.89, { hipX: -0.02, hipY: 0.485, hipZ: 0.72, hipYaw: 0.14, hipPitch: 0.14 }, 'linear', 1),
        key(0.97, { hipX: 0.03, hipY: 0.476, hipZ: 0.93, hipYaw: 0.43, hipPitch: 0.18 }, 'linear', 0.5),
        key(1, { hipX: 0.03, hipY: 0.475, hipZ: 0.95, hipYaw: 0.45, hipPitch: 0.18 }, 'linear'),
      ],
    },
    {
      // Im Anlauf dreht das Becken schon ein, die Brust bleibt offen - erst im Schlag schnellt sie herum und legt sich hinein.
      channels: TRUNK,
      track: [
        key(0),
        key(0.26, { spinePitch: 0.06, spineYaw: -0.26, spineRoll: -0.03, shrugR: 0.7, shrugL: 0.3 }, 'smooth'),
        key(0.6, { spinePitch: 0.03, spineYaw: -0.34, spineRoll: -0.05, shrugR: 0.8, shrugL: 0.4 }, 'linear'),
        key(0.8, { spinePitch: 0.08, spineYaw: -0.44, spineRoll: -0.04, shrugR: 0.8, shrugL: 0.4 }, 'smooth'),
        key(0.88, { spinePitch: 0.1, spineYaw: -0.42, spineRoll: -0.03, shrugR: 0.9, shrugL: 0.4 }, 'smooth'),
        key(0.925, { spinePitch: 0.15, spineYaw: -0.22, spineRoll: -0.01, shrugR: 1, shrugL: 0.35 }, 'in'),
        key(0.98, { spinePitch: 0.33, spineYaw: 0.53, spineRoll: 0.08, shrugR: 1, shrugL: 0.3 }, 'linear', 0.4),
        key(1, { spinePitch: 0.34, spineYaw: 0.55, spineRoll: 0.08, shrugR: 1, shrugL: 0.3 }, 'linear'),
      ],
    },
    {
      // Rechte Faust: hoch neben den Helm, im Schlag in weitem Bogen ueber die Schulter.
      channels: ARM_R,
      track: [
        key(0),
        key(0.12, { handRX: -0.5, handRY: 1.1, handRZ: 0.14, elbowR: 0.1 }, 'in', 1),
        key(0.25, { handRX: -0.4, handRY: 1.49, handRZ: 0.1, elbowR: -0.1 }, 'out'),
        key(0.82, { handRX: -0.42, handRY: 1.52, handRZ: 0.05, elbowR: -0.2 }, 'linear'),
        key(0.89, { handRX: -0.44, handRY: 1.52, handRZ: 0.1, elbowR: 0 }, 'in'),
        key(0.94, { handRX: -0.52, handRY: 1.5, handRZ: 0.13, elbowR: 0.3 }, 'linear', 0.9),
        key(0.98, { handRX: -0.65, handRY: 1.45, handRZ: 0.08, elbowR: 0.5 }, 'linear', 0.4),
        key(1, { handRX: -0.655, handRY: 1.44, handRZ: 0.08, elbowR: 0.5 }, 'linear'),
      ],
    },
    {
      // Linker Unterarm steht als Deckung vor Kinn und Brust; im Schlag zieht er an die Rippen.
      channels: ARM_L,
      track: [
        key(0),
        key(0.2, { handLX: 0.2, handLY: 1.16, handLZ: 0.33, elbowL: 0.3 }, 'smooth'),
        key(0.84, { handLX: 0.22, handLY: 1.18, handLZ: 0.32, elbowL: 0.3 }, 'linear'),
        key(0.98, { handLX: 0.24, handLY: 1.1, handLZ: 0.22, elbowL: 0.2 }, 'smooth'),
        key(1, { handLX: 0.24, handLY: 1.1, handLZ: 0.22, elbowL: 0.2 }),
      ],
    },
    {
      // Rechter Fuss: drueckt ab, schwingt am Standbein vorbei und setzt vorn mit der Ferse auf.
      channels: FOOT_R,
      track: [
        key(0),
        key(0.6),
        key(0.67, { footRPitch: 0.55 }, 'linear'),
        key(0.69, { footRY: 0.02, footRPitch: 0.6 }, 'linear'),
        key(0.745, { footRX: -0.16, footRZ: 0.2, footRY: 0.07, footRPitch: 0.2, footRYaw: -0.2 }, 'linear'),
        key(0.8, { footRX: -0.15, footRZ: 0.63, footRY: 0.012, footRPitch: -0.2, footRYaw: -0.1 }, 'linear'),
        key(0.82, { footRX: -0.15, footRZ: 0.63, footRYaw: -0.1 }, 'linear'),
        key(0.9, { footRX: -0.15, footRZ: 0.63, footRYaw: -0.1 }),
        key(0.97, { footRX: -0.15, footRZ: 0.63, footRYaw: -0.1, footRPitch: 0.75 }, 'linear'),
        key(1, { footRX: -0.15, footRZ: 0.63, footRYaw: -0.1, footRPitch: 0.8 }, 'linear'),
      ],
    },
    {
      // Linker Fuss: Standbein des ersten Schritts, dann der Ausfallschritt zum Schlag.
      channels: FOOT_L,
      track: [
        key(0),
        key(0.76),
        key(0.8, { footLPitch: 0.45 }, 'linear'),
        key(0.82, { footLY: 0.02, footLPitch: 0.5 }, 'linear'),
        key(0.89, { footLZ: 0.66, footLY: 0.07, footLPitch: 0.1, footLYaw: 0.08 }, 'linear'),
        key(0.955, { footLZ: 1.08, footLY: 0.012, footLPitch: -0.2, footLYaw: 0.1 }, 'linear'),
        key(0.975, { footLZ: 1.08, footLYaw: 0.1 }, 'linear'),
        key(1, { footLZ: 1.08, footLYaw: 0.1 }),
      ],
    },
  ],
  recover: [
    {
      // Zurueck in zwei Schritten: erst der vordere Fuss hinter den hinteren, dann der andere.
      channels: PELVIS,
      track: [
        key(0, { hipX: 0.03, hipY: 0.475, hipZ: 0.95, hipYaw: 0.45, hipPitch: 0.18 }),
        key(0.12, { hipX: 0.03, hipY: 0.452, hipZ: 0.962, hipYaw: 0.48, hipPitch: 0.2 }, 'out'),
        key(0.22, { hipX: 0.01, hipY: 0.47, hipZ: 0.88, hipYaw: 0.4, hipPitch: 0.16 }, 'in'),
        key(0.4, { hipX: -0.03, hipY: 0.49, hipZ: 0.64, hipYaw: 0.15, hipPitch: 0.11 }, 'linear', 1),
        key(0.55, { hipX: 0, hipY: 0.485, hipZ: 0.46, hipYaw: -0.05, hipPitch: 0.09 }, 'linear', 1),
        key(0.72, { hipX: 0.02, hipY: 0.49, hipZ: 0.24, hipYaw: -0.2, hipPitch: 0.07 }, 'linear', 1),
        key(0.88, { hipX: -0.01, hipY: 0.476, hipZ: 0.05, hipYaw: -0.28, hipPitch: 0.07 }, 'linear', 1),
        key(1, {}, 'out'),
      ],
    },
    {
      channels: TRUNK,
      track: [
        key(0, { spinePitch: 0.34, spineYaw: 0.55, spineRoll: 0.08, shrugR: 1, shrugL: 0.3 }),
        key(0.14, { spinePitch: 0.4, spineYaw: 0.6, spineRoll: 0.1, shrugR: 0.8, shrugL: 0.3 }, 'out'),
        key(0.55, { spinePitch: 0.2, spineYaw: 0.15, spineRoll: 0.02, shrugR: 0.3, shrugL: 0.2 }, 'in', 0.8),
        key(1, {}, 'out'),
      ],
    },
    {
      channels: ARM_R,
      track: [
        key(0, { handRX: -0.655, handRY: 1.44, handRZ: 0.08, elbowR: 0.5 }),
        key(0.14, { handRX: -0.66, handRY: 1.38, handRZ: 0.05, elbowR: 0.4 }, 'out'),
        key(0.4, { handRX: -0.52, handRY: 1.14, handRZ: 0.1, elbowR: 0.25 }, 'linear', 1),
        key(0.7, { handRX: -0.43, handRY: 0.915, handRZ: 0.145, elbowR: 0.16 }, 'linear'),
        key(1, {}, 'out'),
      ],
    },
    {
      channels: ARM_L,
      track: [
        key(0, { handLX: 0.24, handLY: 1.1, handLZ: 0.22, elbowL: 0.2 }),
        key(0.4, { handLX: 0.24, handLY: 1.08, handLZ: 0.26, elbowL: 0.2 }, 'smooth'),
        key(1, {}, 'smooth'),
      ],
    },
    {
      // Linker Fuss: vom Ausfall zurueck bis auf seinen Platz.
      channels: FOOT_L,
      track: [
        key(0, { footLZ: 1.08, footLYaw: 0.1 }),
        key(0.14, { footLZ: 1.08, footLYaw: 0.1 }),
        key(0.2, { footLZ: 1.08, footLY: 0.012, footLPitch: -0.25, footLYaw: 0.1 }, 'linear'),
        key(0.36, { footLZ: 0.7, footLY: 0.065, footLPitch: 0.1, footLYaw: 0.08 }, 'linear'),
        key(0.52, { footLY: 0.012, footLPitch: 0.45 }, 'linear'),
        key(0.6, {}, 'linear'),
        key(1),
      ],
    },
    {
      // Rechter Fuss: traegt den ersten Schritt, geht dann selbst zurueck.
      channels: FOOT_R,
      track: [
        key(0, { footRX: -0.15, footRZ: 0.63, footRYaw: -0.1, footRPitch: 0.8 }),
        key(0.2, { footRX: -0.15, footRZ: 0.63, footRYaw: -0.1, footRPitch: 0.65 }, 'linear'),
        key(0.4, { footRX: -0.15, footRZ: 0.63, footRYaw: -0.1 }, 'linear'),
        key(0.5, { footRX: -0.15, footRZ: 0.63, footRYaw: -0.1 }),
        key(0.56, { footRX: -0.15, footRZ: 0.63, footRY: 0.012, footRPitch: -0.25, footRYaw: -0.1 }, 'linear'),
        key(0.7, { footRX: -0.16, footRZ: 0.26, footRY: 0.065, footRPitch: 0.2, footRYaw: -0.3 }, 'linear'),
        key(0.86, { footRY: 0.012, footRPitch: 0.45 }, 'linear'),
        key(0.94, {}, 'linear'),
        key(1),
      ],
    },
  ],
};

const STRIKES: Record<Loadout, Strike> = { shield: SHIELD, sword: SWORD, fists: FISTS };

export const strike: ClipFn = (input: FighterAnimInput, out: Pose): void => {
  const s = byLoadout(input, STRIKES);
  if (input.phase === 'recover') {
    sampleLayers(s.recover, input.progress, out);
    return;
  }
  sampleLayers(s.windup, input.progress, out);
  // Die gehaltene Ausholhaltung lebt: Klinge und Hand schwanken, der Koerper atmet in die Spannung.
  const held = ramp(input.progress, 0.18, 0.32) * (1 - ramp(input.progress, s.launch - 0.08, s.launch));
  if (held > 0) {
    const c = input.clockMs;
    out.bladeX += held * 0.05 * Math.sin(c / 410);
    out.bladeZ += held * 0.045 * Math.sin(c / 530 + 1);
    out.handRY += held * 0.008 * Math.sin(c / 370 + 2);
    out.handRX += held * 0.006 * Math.sin(c / 450 + 0.7);
    out.hipY += held * 0.005 * Math.sin(c / 640);
    out.spineYaw += held * 0.016 * Math.sin(c / 760 + 0.5);
    out.spinePitch += held * 0.01 * Math.sin(c / 690 + 1.9);
    out.handLZ += held * 0.01 * Math.sin(c / 480 + 2.4);
    out.handLY += held * 0.006 * Math.sin(c / 560 + 0.3);
  }
};
