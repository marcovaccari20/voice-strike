// Gemeinsames Handwerkszeug der Bewegungsablaeufe.

import type { FighterAnimInput } from '../../fighterVisual';
import { loadoutOf, sampleTrack, type Loadout, type Pose, type Track } from '../pose';

/** Ein Ablauf: schreibt die Zielhaltung fuer den Augenblick `input` nach `out`. */
export type ClipFn = (input: FighterAnimInput, out: Pose) => void;

/** Waehlt je nach Ausruestung (Schild, nur Schwert, Faeuste). */
export function byLoadout<T>(input: FighterAnimInput, table: Record<Loadout, T>): T {
  return table[loadoutOf(input)];
}

/** Ausholen und Nachlauf eines Angriffs. */
export interface AttackTracks {
  windup: Track;
  recover: Track;
}

/** Wertet Ausholen oder Nachlauf je nach Phase aus. */
export function sampleAttack(input: FighterAnimInput, tracks: AttackTracks, out: Pose): void {
  sampleTrack(input.phase === 'recover' ? tracks.recover : tracks.windup, input.progress, out);
}
