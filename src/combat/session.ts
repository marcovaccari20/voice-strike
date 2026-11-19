// Eine Kampfsitzung: Simulation plus Bots, im festen Takt.
//
// Die Anzeige ruft je Bild `advance(vergangeneMs)`; die Sitzung macht daraus
// ganze Simulationsschritte. Reihenfolge je Schritt:
//   Bot denkt (update) -> Simulation rechnet (step) -> Bot sieht das Ergebnis (observe)
// Gleiche Eingaben in gleichen Schritten ergeben dieselbe Ereignisfolge.

import { BotController } from './bot';
import type { CombatConfig } from './config';
import { CombatSim } from './sim';
import type { BotLevelId, CombatEvent, CommandId } from './types';

export interface SessionOptions {
  /** Startwert des Zufallsgenerators der Bots. */
  seed: number;
  /** Bot-Stufe je Kaempfer; `null` = von aussen gesteuert (Spieler). */
  bots: [BotLevelId | null, BotLevelId | null];
}

export class CombatSession {
  readonly sim: CombatSim;
  readonly bots: [BotController | null, BotController | null];
  private carryMs = 0;

  constructor(config: CombatConfig, options: SessionOptions) {
    this.sim = new CombatSim(config);
    this.bots = [
      options.bots[0] ? new BotController(0, config.bot, options.bots[0], options.seed) : null,
      // Zweiter Bot mit eigenem Startwert, sonst wuerfeln beide dasselbe.
      options.bots[1]
        ? new BotController(1, config.bot, options.bots[1], options.seed ^ 0x5bd1e995)
        : null,
    ];
  }

  /**
   * Simulationszeit einschliesslich des Rests, der noch keinen ganzen Schritt
   * ergibt. Nur fuer die Anzeige (weiche Bewegung zwischen zwei Schritten).
   */
  get displayTimeMs(): number {
    return this.sim.phase === 'matchOver' ? this.sim.timeMs : this.sim.timeMs + this.carryMs;
  }

  /** Befehl eines von aussen gesteuerten Kaempfers. */
  command(fighter: number, cmd: CommandId): void {
    this.sim.command(fighter, cmd);
  }

  /** Sprechbeginn eines von aussen gesteuerten Kaempfers. */
  speechStart(fighter: number, ageMs = 0): void {
    this.sim.speechStart(fighter, ageMs);
  }

  /** Genau ein Simulationsschritt. Liefert dessen Ereignisse. */
  stepOnce(): CombatEvent[] {
    for (const bot of this.bots) bot?.update(this.sim);
    this.sim.step();
    const events = this.sim.drainEvents();
    for (const bot of this.bots) bot?.observe(events);
    return events;
  }

  /**
   * Rueckt um die vergangene Echtzeit vor und liefert alle Ereignisse.
   * Mehr als `simulation.maxCatchUpMs` wird nicht nachgeholt (Tab im Hintergrund).
   */
  advance(elapsedMs: number, maxCatchUpMs: number): CombatEvent[] {
    const stepMs = this.sim.config.simulation.stepMs;
    this.carryMs += Math.min(Math.max(0, elapsedMs), maxCatchUpMs);
    const out: CombatEvent[] = [];
    while (this.carryMs >= stepMs) {
      this.carryMs -= stepMs;
      for (const e of this.stepOnce()) out.push(e);
    }
    // Ereignisse aus Eingaben zwischen zwei Schritten (abgelehnter Befehl ...).
    for (const e of this.sim.drainEvents()) out.push(e);
    return out;
  }

  /** Simulationsschritte fuer `ms`; fuer Tests und Probelaeufe ohne Echtzeit. */
  run(ms: number): CombatEvent[] {
    const out: CombatEvent[] = [];
    const steps = Math.floor(ms / this.sim.config.simulation.stepMs + 1e-6);
    for (let i = 0; i < steps; i++) for (const e of this.stepOnce()) out.push(e);
    return out;
  }
}
