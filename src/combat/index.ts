// Oeffentliche Schnittstelle der Kampflogik. Alles ausserhalb von src/combat
// importiert nur von hier.

export * from './types';
export { parseConfig } from './config';
export type {
  BotConfig,
  BotLevelConfig,
  CombatConfig,
  CommandConfig,
  VoiceConfig,
  WeaponConfig,
} from './config';
export { Rng } from './rng';
export { CombatSim, isIncapacitated, isOwnAction } from './sim';
export { BotController } from './bot';
export { CombatSession } from './session';
export type { SessionOptions } from './session';
