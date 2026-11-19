// VORLAEUFIG: steht nur in der Grundhaltung, bis der Ablauf ausgearbeitet ist.
import { STANCE, copyPose } from '../pose';
import type { ClipFn } from './common';

export const stagger: ClipFn = (_input, out) => copyPose(STANCE, out);
export const stunned: ClipFn = (_input, out) => copyPose(STANCE, out);
export const paralyzed: ClipFn = (_input, out) => copyPose(STANCE, out);
