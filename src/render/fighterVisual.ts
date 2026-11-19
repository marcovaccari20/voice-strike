// Die Naht zwischen Spiel und Figur.
//
// Die Szene kennt eine Figur nur ueber `FighterVisual`. Heute steckt dahinter
// der Ritter mit eigenem Skelett (render/knight). Fuer ein fertiges GLB-Modell
// eine zweite Fabrik schreiben, die das Modell laedt und in `update` je `clip`
// den passenden AnimationClip auf `progress` bzw. `timeMs` stellt, und sie in
// main.ts an `ArenaView` uebergeben. Am Spiel aendert sich nichts.

import type { Object3D, Vector3 } from 'three';

/**
 * Bewegungsablaeufe. Die Namen sind zugleich die empfohlenen Clip-Namen im
 * GLB-Modell.
 */
export type ClipId =
  | 'idle'
  | 'strike'
  | 'left'
  | 'right'
  | 'kick'
  | 'sweep'
  | 'charge'
  | 'block_high'
  | 'block_left'
  | 'block_right'
  | 'roll'
  | 'stagger'
  | 'stunned'
  | 'paralyzed'
  | 'down'
  | 'ko'
  | 'victory';

/**
 * - `windup`: Ausholen bis zum Einschlag; `progress` 0..1, bei 1 trifft der Schlag
 * - `recover`: Nachlauf zurueck in die Grundhaltung; `progress` 0..1
 * - `hold`: Zustand ohne festes Ziel (Block, Grundhaltung, Sieg); es zaehlt `timeMs`
 */
export type ClipPhase = 'windup' | 'recover' | 'hold';

export interface FighterAnimInput {
  clip: ClipId;
  phase: ClipPhase;
  /** Fortschritt 0..1 innerhalb der Phase. */
  progress: number;
  /** Zeit seit Beginn der Phase in ms. */
  timeMs: number;
  /** Laufende Uhr fuer Dauerbewegungen (Atmen, Zittern) in ms. */
  clockMs: number;
  /** Treffer-Aufblitzen 0..1. */
  flash: number;
  /** Ohne Schwert: Faustkampf. */
  weaponBroken: boolean;
  /** Traegt links einen Schild und blockt damit (Waffe "Schwert + Schild"). */
  shield: boolean;
  /**
   * Worauf die Figur schaut, in Weltkoordinaten - ueblicherweise der Kopf des
   * Gegners. `null` = geradeaus.
   */
  focus: Vector3 | null;
}

export interface FighterVisualOptions {
  /** Farbe des Wappenrocks und des Schildkreuzes. */
  color: number;
  /** Farbe der Borte. */
  accent: number;
  /** Farbe des Helmbuschs. */
  plume: number;
}

export interface FighterVisual {
  /**
   * In die Szene zu haengen. Position und Blickrichtung setzt die Szene;
   * die Figur schaut in ihrem eigenen Koordinatensystem nach +Z, ihre linke
   * Seite ist +X.
   */
  readonly root: Object3D;
  update(input: FighterAnimInput, dtSeconds: number): void;
  /** Punkt ueber dem Kopf in Weltkoordinaten (fuer das Warnzeichen). */
  getHeadAnchor(out: Vector3): Vector3;
  /** Brustmitte in Weltkoordinaten (fuer Treffer-Effekte). */
  getChestAnchor(out: Vector3): Vector3;
  /** Schwertmitte in Weltkoordinaten (fuer Funken beim Block). */
  getWeaponAnchor(out: Vector3): Vector3;
  dispose(): void;
}

export type FighterVisualFactory = (options: FighterVisualOptions) => FighterVisual;
