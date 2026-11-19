// VORLAEUFIG: steht nur in der Grundhaltung, bis der Ablauf ausgearbeitet ist.
import { STANCE, copyPose } from '../pose';
import type { ClipFn } from './common';

export const sweep: ClipFn = (_input, out) => copyPose(STANCE, out);
