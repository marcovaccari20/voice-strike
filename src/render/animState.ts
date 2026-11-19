// Uebersetzt den Zustand der Simulation in "welcher Ablauf, wie weit".
// Reine Funktion ohne Three.js - auch ein GLB-Modell wird damit gefuettert.

import type { CombatSim } from '../combat';
import type { ClipId, ClipPhase } from './fighterVisual';

export interface ResolvedAnim {
  clip: ClipId;
  phase: ClipPhase;
  progress: number;
  timeMs: number;
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

const ATTACK_CLIPS: Record<string, ClipId> = {
  strike: 'strike',
  left: 'left',
  right: 'right',
  kick: 'kick',
  sweep: 'sweep',
  charge: 'charge',
};

/**
 * `timeMs` ist die Simulationszeit einschliesslich des noch nicht gerechneten
 * Rests des laufenden Bildes, damit Bewegungen zwischen zwei Schritten nicht
 * ruckeln.
 */
export function resolveAnim(sim: CombatSim, fighter: number, timeMs: number): ResolvedAnim {
  const f = sim.fighters[fighter];
  // Was man sieht: Der Scheinangriff erscheint als Ausholen des nachgeahmten Befehls.
  const seen = sim.visible(fighter);
  const since = Math.max(0, timeMs - f.stateStartMs);
  const span = f.stateEndMs > f.stateStartMs ? f.stateEndMs - f.stateStartMs : 1;
  const progress = clamp01(since / span);

  switch (f.state) {
    case 'windup': {
      const clip = ATTACK_CLIPS[seen.command] ?? 'strike';
      return { clip, phase: 'windup', progress, timeMs: since };
    }
    case 'feint': {
      // Gleiche Geschwindigkeit wie der echte Schlag - sonst verriete er sich.
      const clip = ATTACK_CLIPS[seen.command] ?? 'strike';
      const fullMs = seen.command !== '' ? sim.windupOf(fighter, seen.command) : span;
      return { clip, phase: 'windup', progress: clamp01(since / Math.max(1, fullMs)), timeMs: since };
    }
    case 'recovery': {
      if (f.kind === 'attack') {
        const clip = ATTACK_CLIPS[f.command] ?? 'strike';
        return { clip, phase: 'recover', progress, timeMs: since };
      }
      if (f.kind === 'roll') return { clip: 'roll', phase: 'recover', progress, timeMs: since };
      return { clip: 'idle', phase: 'hold', progress: 0, timeMs: since };
    }
    case 'block': {
      const clip: ClipId =
        f.line === 'left' ? 'block_left' : f.line === 'right' ? 'block_right' : 'block_high';
      return { clip, phase: 'hold', progress, timeMs: since };
    }
    case 'roll':
      return { clip: 'roll', phase: 'windup', progress, timeMs: since };
    case 'staggered':
      return { clip: 'stagger', phase: 'hold', progress, timeMs: since };
    case 'stunned':
      return { clip: 'stunned', phase: 'hold', progress, timeMs: since };
    case 'paralyzed':
      return { clip: 'paralyzed', phase: 'hold', progress, timeMs: since };
    case 'down':
      return { clip: 'down', phase: 'hold', progress, timeMs: since };
    case 'ko':
      return { clip: 'ko', phase: 'hold', progress: 0, timeMs: since };
    case 'idle':
    default: {
      const over = sim.phase === 'roundOver' || sim.phase === 'matchOver';
      const won =
        (sim.phase === 'roundOver' && sim.lastRoundWinner === fighter) ||
        (sim.phase === 'matchOver' && sim.matchWinner === fighter);
      if (over && won) return { clip: 'victory', phase: 'hold', progress: 0, timeMs: since };
      return { clip: 'idle', phase: 'hold', progress: 0, timeMs: since };
    }
  }
}
