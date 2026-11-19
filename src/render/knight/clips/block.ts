// VORLAEUFIG: steht nur in der Grundhaltung, bis der Ablauf ausgearbeitet ist.
import { STANCE, copyPose } from '../pose';
import type { ClipFn } from './common';

export const blockHigh: ClipFn = (_input, out) => copyPose(STANCE, out);
export const blockLeft: ClipFn = (_input, out) => copyPose(STANCE, out);
export const blockRight: ClipFn = (_input, out) => copyPose(STANCE, out);
