// Alle Bewegungsablaeufe des Ritters, nach Namen.

import type { ClipId, FighterAnimInput } from '../../fighterVisual';
import type { Pose } from '../pose';
import { blockHigh, blockLeft, blockRight } from './block';
import { charge } from './charge';
import type { ClipFn } from './common';
import { down, ko } from './falls';
import { idle, victory } from './idle';
import { kick } from './kick';
import { paralyzed, stagger, stunned } from './reactions';
import { roll } from './roll';
import { left, right } from './sides';
import { strike } from './strike';
import { sweep } from './sweep';

export const CLIPS: Record<ClipId, ClipFn> = {
  idle,
  strike,
  left,
  right,
  kick,
  sweep,
  charge,
  block_high: blockHigh,
  block_left: blockLeft,
  block_right: blockRight,
  roll,
  stagger,
  stunned,
  paralyzed,
  down,
  ko,
  victory,
};

/** Zielhaltung fuer den aktuellen Ablauf. */
export function poseForClip(input: FighterAnimInput, out: Pose): void {
  CLIPS[input.clip](input, out);
}
