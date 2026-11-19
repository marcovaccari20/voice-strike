// Gemeinsame Hilfen der Tests. Die Tests lesen dieselbe Datei, die auch das
// Spiel laedt - geprueft wird also die ausgelieferte Konfiguration.

import rawConfig from '../public/combat_config.json';
import {
  CombatSim,
  parseConfig,
  type CombatConfig,
  type CombatEvent,
  type CombatEventType,
} from '../src/combat';

export function loadConfig(mutate?: (config: CombatConfig) => void): CombatConfig {
  // Tiefe Kopie, damit kein Test die Werte eines anderen veraendert.
  const config = parseConfig(JSON.parse(JSON.stringify(rawConfig)));
  if (mutate) mutate(config);
  return config;
}

/** Eine Simulation, deren erste Runde bereits laeuft. */
export function fightingSim(mutate?: (config: CombatConfig) => void): CombatSim {
  const sim = new CombatSim(loadConfig(mutate));
  startFighting(sim);
  return sim;
}

/** Laesst den Vorlauf der Runde ablaufen und verwirft dessen Ereignisse. */
export function startFighting(sim: CombatSim): void {
  let guard = 0;
  while (sim.phase !== 'fighting' && sim.phase !== 'matchOver' && guard < 100000) {
    sim.step();
    guard += 1;
  }
  sim.drainEvents();
}

export function ofType(events: readonly CombatEvent[], type: CombatEventType): CombatEvent[] {
  return events.filter((e) => e.type === type);
}

export function types(events: readonly CombatEvent[]): CombatEventType[] {
  return events.map((e) => e.type);
}

/** Fuellt die Ausdauer beider Kaempfer auf (nur fuer lange Testfolgen). */
export function refillStamina(sim: CombatSim): void {
  for (const f of sim.fighters) f.stamina = sim.config.fighter.maxStamina;
}
