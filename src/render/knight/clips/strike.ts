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
  windup: [
    {
      // Gewicht aufs hintere Bein, tiefer sinken - dann Abdruck und Ausfall.
      channels: PELVIS,
      track: [
        key(0),
        key(0.3, { hipX: -0.03, hipY: 0.485, hipZ: -0.06, hipYaw: -0.38, hipPitch: 0.04 }, 'smooth'),
        key(0.78, { hipX: -0.05, hipY: 0.455, hipZ: -0.105, hipYaw: -0.44, hipPitch: 0.02 }, 'out'),
        key(0.83, { hipX: -0.04, hipY: 0.47, hipZ: -0.04, hipYaw: -0.38, hipPitch: 0.05 }, 'in'),
        key(0.9, { hipX: 0, hipY: 0.505, hipZ: 0.26, hipYaw: 0, hipPitch: 0.11 }, 'linear', 0.8),
        key(0.97, { hipX: 0.02, hipY: 0.492, hipZ: 0.53, hipYaw: 0.28, hipPitch: 0.12 }, 'linear', 0.5),
        key(1, { hipX: 0.02, hipY: 0.488, hipZ: 0.55, hipYaw: 0.3, hipPitch: 0.12 }, 'linear'),
      ],
    },
    {
      // Brust oeffnet sich nach rechts; im Hieb bleibt sie hinter dem Becken zurueck und schnellt nach.
      channels: TRUNK,
      track: [
        key(0),
        key(0.27, { spinePitch: 0.05, spineYaw: -0.22, spineRoll: -0.03, shrugR: 0.3 }, 'smooth'),
        key(0.8, { spinePitch: 0.01, spineYaw: -0.3, spineRoll: -0.05, shrugR: 0.5 }, 'out'),
        key(0.87, { spinePitch: -0.01, spineYaw: -0.36, spineRoll: -0.04, shrugR: 0.6 }, 'smooth'),
        key(0.93, { spinePitch: 0.1, spineYaw: 0.05, spineRoll: 0, shrugR: 0.8 }, 'in', 0.8),
        key(0.98, { spinePitch: 0.21, spineYaw: 0.43, spineRoll: 0.03, shrugR: 0.8 }, 'linear', 0.4),
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
        key(0.8, { handRX: -0.42, handRY: 1.44, handRZ: 0.09, elbowR: -0.2 }, 'out'),
        key(0.88, { handRX: -0.42, handRY: 1.45, handRZ: 0.12, elbowR: -0.1 }, 'in'),
        key(0.94, { handRX: -0.4, handRY: 1.46, handRZ: 0.23, elbowR: 0.1 }, 'linear', 0.9),
        key(0.98, { handRX: -0.36, handRY: 1.37, handRZ: 0.31, elbowR: 0.3 }, 'linear', 0.4),
        key(1, { handRX: -0.36, handRY: 1.36, handRZ: 0.32, elbowR: 0.3 }, 'linear'),
      ],
    },
    {
      // Klinge: steil nach oben, etwas nach hinten und aussen; im Hieb legt sie sich erst zurueck, dann peitscht sie ueber.
      channels: BLADE,
      track: [
        key(0),
        key(0.13, { bladeX: -0.05, bladeY: 1, bladeZ: 0.25 }, 'in', 1),
        key(0.28, { bladeX: -0.52, bladeY: 0.84, bladeZ: -0.1 }, 'out'),
        key(0.8, { bladeX: -0.55, bladeY: 0.78, bladeZ: -0.3 }, 'out'),
        key(0.89, { bladeX: -0.35, bladeY: 0.4, bladeZ: -0.85 }, 'smooth'),
        key(0.945, { bladeX: -0.4, bladeY: 1, bladeZ: -0.1 }, 'in', 1),
        key(0.98, { bladeX: -0.66, bladeY: 0.79, bladeZ: 0.45 }, 'linear', 0.3),
        key(1, { bladeX: -0.66, bladeY: 0.745, bladeZ: 0.49 }, 'linear'),
      ],
    },
    {
      // Schild bleibt vorn als Deckung; im Hieb schwingt er als Gegengewicht zurueck.
      channels: ARM_L,
      track: [
        key(0),
        key(0.22, { handLX: 0.33, handLY: 0.99, handLZ: 0.31, shieldX: 0.56, shieldY: 0.1, shieldZ: 0.82 }, 'smooth'),
        key(0.8, { handLX: 0.36, handLY: 1, handLZ: 0.3, shieldX: 0.64, shieldY: 0.1, shieldZ: 0.76 }, 'out'),
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
        key(0.78),
        key(0.8, { footLY: 0.012, footLPitch: 0.32 }, 'linear'),
        key(0.87, { footLZ: 0.45, footLY: 0.07, footLPitch: 0.05, footLYaw: 0.08 }, 'linear'),
        key(0.935, { footLZ: 0.7, footLY: 0.012, footLPitch: -0.2, footLYaw: 0.1 }, 'linear'),
        key(0.96, { footLZ: 0.7, footLYaw: 0.1 }, 'linear'),
        key(1, { footLZ: 0.7, footLYaw: 0.1 }),
      ],
    },
    {
      // Hinterer Fuss: drueckt ab, die Ferse hebt sich, dann schleift er auf der Spitze nach.
      channels: FOOT_R,
      track: [
        key(0),
        key(0.8),
        key(0.86, { footRPitch: 0.5 }, 'linear'),
        key(0.98, { footRX: -0.15, footRZ: 0.17, footRPitch: 0.9, footRYaw: -0.25 }, 'linear'),
        key(1, { footRX: -0.15, footRZ: 0.18, footRPitch: 0.9, footRYaw: -0.25 }, 'linear'),
      ],
    },
  ],
  recover: [
    {
      // Der Koerper faengt den Hieb im vorderen Knie ab, dann drueckt er sich in einem flachen Satz zurueck.
      channels: PELVIS,
      track: [
        key(0, { hipX: 0.02, hipY: 0.488, hipZ: 0.55, hipYaw: 0.3, hipPitch: 0.12 }),
        key(0.16, { hipX: 0.025, hipY: 0.46, hipZ: 0.572, hipYaw: 0.34, hipPitch: 0.15 }, 'out'),
        key(0.42, { hipX: 0.02, hipY: 0.492, hipZ: 0.42, hipYaw: 0.18, hipPitch: 0.11 }, 'in'),
        key(0.62, { hipX: -0.01, hipY: 0.5, hipZ: 0.2, hipYaw: -0.08, hipPitch: 0.08 }, 'linear', 0.9),
        key(0.82, { hipX: -0.02, hipY: 0.476, hipZ: 0.04, hipYaw: -0.26, hipPitch: 0.07 }, 'linear', 0.6),
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
        key(0.2, { handRX: -0.37, handRY: 1.31, handRZ: 0.19, elbowR: 0.25 }, 'out'),
        key(0.5, { handRX: -0.41, handRY: 1.05, handRZ: 0.14, elbowR: 0.2 }, 'in', 0.7),
        key(1, {}, 'out'),
      ],
    },
    {
      channels: BLADE,
      track: [
        key(0, { bladeX: -0.66, bladeY: 0.745, bladeZ: 0.49 }),
        key(0.22, { bladeX: -0.69, bladeY: 0.56, bladeZ: 0.46 }, 'out'),
        key(0.55, { bladeX: -0.3, bladeY: 0.6, bladeZ: 0.74 }, 'in', 0.7),
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
        key(0, { footLZ: 0.7, footLYaw: 0.1 }),
        key(0.36, { footLZ: 0.7, footLYaw: 0.1 }),
        key(0.42, { footLZ: 0.7, footLY: 0.012, footLPitch: -0.25, footLYaw: 0.1 }, 'linear'),
        key(0.66, { footLZ: 0.44, footLY: 0.05, footLPitch: 0.1 }, 'linear'),
        key(0.88, { footLY: 0.012, footLPitch: 0.3 }, 'linear'),
        key(0.95, {}, 'linear'),
        key(1),
      ],
    },
    {
      // Hinterer Fuss: geht als Erster zurueck und faengt das Gewicht auf dem Ballen.
      channels: FOOT_R,
      track: [
        key(0, { footRX: -0.15, footRZ: 0.18, footRPitch: 0.9, footRYaw: -0.25 }),
        key(0.16, { footRX: -0.15, footRZ: 0.18, footRPitch: 0.8, footRYaw: -0.25 }),
        key(0.4, { footRX: -0.16, footRZ: 0.02, footRY: 0.04, footRPitch: 0.6, footRYaw: -0.4 }, 'linear'),
        key(0.62, { footRY: 0.012, footRPitch: 0.5 }, 'linear'),
        key(0.8, {}, 'linear'),
        key(1),
      ],
    },
  ],
};

const STRIKES: Record<Loadout, Strike> = { shield: SHIELD, sword: SHIELD, fists: SHIELD };

export const strike: ClipFn = (input: FighterAnimInput, out: Pose): void => {
  const s = byLoadout(input, STRIKES);
  if (input.phase === 'recover') {
    sampleLayers(s.recover, input.progress, out);
    return;
  }
  sampleLayers(s.windup, input.progress, out);
  // Die gehaltene Ausholhaltung lebt: Klinge und Hand schwanken, der Koerper atmet in die Spannung.
  const held = ramp(input.progress, 0.18, 0.32) * (1 - ramp(input.progress, 0.72, 0.8));
  if (held > 0) {
    const c = input.clockMs;
    out.bladeX += held * 0.035 * Math.sin(c / 410);
    out.bladeZ += held * 0.03 * Math.sin(c / 530 + 1);
    out.handRY += held * 0.006 * Math.sin(c / 370 + 2);
    out.hipY += held * 0.004 * Math.sin(c / 640);
    out.spineYaw += held * 0.012 * Math.sin(c / 760 + 0.5);
    out.handLZ += held * 0.008 * Math.sin(c / 480 + 2.4);
  }
};
