// VORLAEUFIG: steht nur in der Grundhaltung, bis der Ablauf ausgearbeitet ist.
import { STANCE, copyPose } from '../pose';
import type { ClipFn } from './common';

export const idle: ClipFn = (_input, out) => copyPose(STANCE, out);
export const victory: ClipFn = (_input, out) => copyPose(STANCE, out);
