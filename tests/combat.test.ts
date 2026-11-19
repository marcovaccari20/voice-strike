// Regeltests der Kampflogik. Alle Erwartungswerte werden aus der
// Konfiguration berechnet; die festen Zahlen der Vorgabe prueft config.test.ts.

import { describe, expect, it } from 'vitest';
import { CombatSim, type CombatEvent } from '../src/combat';
import { fightingSim, loadConfig, ofType, refillStamina, startFighting, types } from './helpers';

const A = 0; // Angreifer in den meisten Tests
const D = 1; // Verteidiger

describe('Block-Timing', () => {
  it('perfektes Parieren: Block beginnt genau 350 ms vor dem Einschlag', () => {
    const sim = fightingSim();
    const c = sim.config;
    const windup = c.commands.strike.windupMs;
    const window = c.block.perfectParryWindowMs;

    sim.command(A, 'strike');
    sim.advance(windup - window);
    sim.command(D, 'block');
    sim.advance(window);
    const events = sim.drainEvents();

    expect(ofType(events, 'Parried')).toHaveLength(1);
    expect(ofType(events, 'Hit')).toHaveLength(0);
    expect(ofType(events, 'Blocked')).toHaveLength(0);
    // kein Schaden, keine Abnutzung
    expect(sim.fighters[D].health).toBe(c.fighter.maxHealth);
    expect(sim.fighters[D].durability).toBe(c.weapons.sword.durability);
    // Angreifer 1300 ms gelaehmt
    expect(sim.fighters[A].state).toBe('paralyzed');
    expect(sim.fighters[A].stateEndMs - sim.timeMs).toBe(c.block.parryStunMs);
    sim.advance(c.block.parryStunMs - c.simulation.stepMs);
    expect(sim.fighters[A].state).toBe('paralyzed');
    sim.advance(c.simulation.stepMs);
    expect(sim.fighters[A].state).toBe('idle');
  });

  it('zu frueher Block: haelt, aber 25 % Schaden, keine Laehmung, Waffe nutzt sich ab', () => {
    const sim = fightingSim();
    const c = sim.config;
    const windup = c.commands.strike.windupMs;
    const tooEarly = c.block.perfectParryWindowMs + c.simulation.stepMs;

    sim.command(A, 'strike');
    sim.advance(windup - tooEarly);
    sim.command(D, 'block');
    sim.advance(tooEarly);
    const events = sim.drainEvents();

    const blocked = ofType(events, 'Blocked');
    expect(blocked).toHaveLength(1);
    expect(blocked[0].flag).toBe(false);
    expect(ofType(events, 'Parried')).toHaveLength(0);
    const damage = c.weapons.sword.damage;
    expect(blocked[0].damage).toBeCloseTo(damage * 0.25);
    expect(sim.fighters[D].health).toBeCloseTo(c.fighter.maxHealth - damage * 0.25);
    expect(sim.fighters[D].durability).toBe(c.weapons.sword.durability - damage);
    expect(sim.fighters[A].state).toBe('recovery');
  });

  it('abgelaufener Block schuetzt nicht mehr', () => {
    const sim = fightingSim();
    const c = sim.config;
    sim.command(D, 'block');
    sim.advance(c.simulation.stepMs);
    sim.command(A, 'strike'); // Einschlag 10 ms nach Ende der Blockhaltung
    sim.advance(c.commands.strike.windupMs);
    const events = sim.drainEvents();
    expect(ofType(events, 'Hit')).toHaveLength(1);
    expect(sim.fighters[D].health).toBe(c.fighter.maxHealth - c.weapons.sword.damage);
  });

  it('nach dem Parieren ist der Verteidiger sofort frei fuer den Konter', () => {
    const sim = fightingSim();
    const c = sim.config;
    sim.command(A, 'strike');
    sim.advance(c.commands.strike.windupMs - 200);
    sim.command(D, 'block');
    sim.advance(100);
    sim.command(D, 'strike'); // waehrend des Blocks gesprochen -> gepuffert
    sim.advance(100);
    expect(sim.fighters[A].state).toBe('paralyzed');
    sim.advance(c.simulation.stepMs);
    expect(sim.fighters[D].state).toBe('windup');
    // Der Konter schlaegt ein, solange der Angreifer gelaehmt ist.
    sim.advance(c.commands.strike.windupMs);
    expect(sim.fighters[A].health).toBe(c.fighter.maxHealth - c.weapons.sword.damage);
  });
});

describe('Richtungsblock', () => {
  /** Angreifer schlaegt von der Seite, Verteidiger antwortet im Parier-Fenster. */
  function sideAttack(
    attack: 'left' | 'right',
    answer: 'left' | 'right' | 'block',
    directional = true,
  ): { sim: CombatSim; events: CombatEvent[] } {
    const sim = fightingSim((c) => {
      c.block.directionalBlock = directional;
    });
    const windup = sim.config.commands[attack].windupMs;
    sim.command(A, attack);
    sim.advance(windup - 200);
    sim.command(D, answer);
    sim.advance(200);
    return { sim, events: sim.drainEvents() };
  }

  it('richtige Seite = die Seite, auf der der Verteidiger den Schlag kommen sieht (gespiegelt)', () => {
    // Schlag von der linken Seite des Angreifers kommt beim Verteidiger rechts an.
    for (const [attack, answer] of [
      ['left', 'right'],
      ['right', 'left'],
    ] as const) {
      const { sim, events } = sideAttack(attack, answer);
      expect(ofType(events, 'Parried')).toHaveLength(1);
      expect(sim.fighters[D].health).toBe(sim.config.fighter.maxHealth);
      // Das Richtungswort war ein Block, kein eigener Schlag.
      const started = ofType(events, 'ActionStarted').filter((e) => e.fighter === D);
      expect(started[0].kind).toBe('block');
      // ... und kostet wie ein Block.
      expect(sim.fighters[D].stamina).toBe(
        sim.config.fighter.maxStamina - sim.config.commands.block.staminaCost,
      );
    }
  });

  it('falsche Blockrichtung: 50 % Schaden und kein Parieren trotz perfektem Timing', () => {
    for (const [attack, answer] of [
      ['left', 'left'],
      ['right', 'right'],
      ['left', 'block'],
    ] as const) {
      const { sim, events } = sideAttack(attack, answer);
      const c = sim.config;
      expect(ofType(events, 'Parried')).toHaveLength(0);
      const blocked = ofType(events, 'Blocked');
      expect(blocked).toHaveLength(1);
      expect(blocked[0].flag).toBe(true);
      expect(blocked[0].damage).toBeCloseTo(c.weapons.sword.damage * 0.5);
      expect(sim.fighters[D].health).toBeCloseTo(c.fighter.maxHealth - c.weapons.sword.damage * 0.5);
      expect(sim.fighters[A].state).toBe('recovery'); // nicht gelaehmt
    }
  });

  it('"block" stoppt den Schlag von oben', () => {
    const sim = fightingSim();
    sim.command(A, 'strike');
    sim.advance(sim.config.commands.strike.windupMs - 200);
    sim.command(D, 'block');
    sim.advance(200);
    expect(ofType(sim.drainEvents(), 'Parried')).toHaveLength(1);
  });

  it('ein Richtungswort ist ein eigener Schlag, wenn der Gegner keinen Seitenschlag ausholt', () => {
    const sim = fightingSim();
    sim.command(A, 'strike'); // Schlag von oben, kein Seitenschlag
    sim.advance(100);
    sim.command(D, 'left');
    const started = ofType(sim.drainEvents(), 'ActionStarted').filter((e) => e.fighter === D);
    expect(started[0].kind).toBe('attack');
    expect(sim.fighters[D].state).toBe('windup');
  });

  it('Schalter aus: "block" stoppt alle Richtungen, Richtungswoerter sind immer Schlaege', () => {
    const blocked = sideAttack('left', 'block', false);
    expect(ofType(blocked.events, 'Parried')).toHaveLength(1);

    const word = sideAttack('left', 'right', false);
    const started = ofType(word.events, 'ActionStarted').filter((e) => e.fighter === D);
    expect(started[0].kind).toBe('attack');
    expect(ofType(word.events, 'Hit').some((e) => e.target === D)).toBe(true);
  });

  it('der Schalter laesst sich im laufenden Kampf umlegen', () => {
    const sim = fightingSim();
    sim.setDirectionalBlock(false);
    sim.command(A, 'right');
    sim.advance(sim.config.commands.right.windupMs - 200);
    sim.command(D, 'block');
    sim.advance(200);
    expect(ofType(sim.drainEvents(), 'Parried')).toHaveLength(1);
  });
});

describe('Blockbruch', () => {
  it('kick bricht den Block: 5 Schaden, 700 ms betaeubt', () => {
    const sim = fightingSim();
    const c = sim.config;
    sim.command(A, 'kick');
    sim.advance(c.commands.kick.windupMs - 200);
    sim.command(D, 'block'); // perfektes Timing hilft nicht
    sim.advance(200);
    const events = sim.drainEvents();

    expect(ofType(events, 'GuardBroken')).toHaveLength(1);
    expect(ofType(events, 'Parried')).toHaveLength(0);
    expect(ofType(events, 'Blocked')).toHaveLength(0);
    const hit = ofType(events, 'Hit')[0];
    expect(hit.damage).toBe(c.commands.kick.damage);
    expect(hit.effect).toBe('stun');
    expect(sim.fighters[D].health).toBe(c.fighter.maxHealth - c.commands.kick.damage);
    expect(sim.fighters[D].state).toBe('stunned');
    expect(sim.fighters[D].stateEndMs - sim.timeMs).toBe(c.commands.kick.stunMs);
    // gebrochener Block nutzt die Waffe nicht ab
    expect(sim.fighters[D].durability).toBe(c.weapons.sword.durability);
  });

  it('charge bricht den Block: voller Schaden', () => {
    const sim = fightingSim();
    const c = sim.config;
    sim.command(A, 'charge');
    sim.advance(c.commands.charge.windupMs - 200);
    sim.command(D, 'block');
    sim.advance(200);
    const events = sim.drainEvents();

    expect(ofType(events, 'GuardBroken')).toHaveLength(1);
    expect(ofType(events, 'Hit')[0].damage).toBe(c.commands.charge.damage);
    expect(sim.fighters[D].health).toBe(c.fighter.maxHealth - c.commands.charge.damage);
    expect(sim.fighters[D].state).not.toBe('block');
  });

  it('kick trifft auch ohne Block und betaeubt', () => {
    const sim = fightingSim();
    const c = sim.config;
    sim.command(A, 'kick');
    sim.advance(c.commands.kick.windupMs);
    expect(ofType(sim.drainEvents(), 'GuardBroken')).toHaveLength(0);
    expect(sim.fighters[D].state).toBe('stunned');
    // Befehle des Betaeubten werden abgelehnt
    sim.command(D, 'strike');
    const rejected = ofType(sim.drainEvents(), 'CommandRejected');
    expect(rejected[0].reason).toBe('incapacitated');
  });
});

describe('Rolle und Beinfeger', () => {
  it('roll weicht einem Schlag aus', () => {
    const sim = fightingSim();
    const c = sim.config;
    sim.command(A, 'strike');
    sim.advance(c.commands.strike.windupMs - 200);
    sim.command(D, 'roll');
    sim.advance(200);
    const events = sim.drainEvents();
    expect(ofType(events, 'Evaded')).toHaveLength(1);
    expect(ofType(events, 'Hit')).toHaveLength(0);
    expect(sim.fighters[D].health).toBe(c.fighter.maxHealth);
  });

  it('roll weicht auch kick und charge aus', () => {
    for (const attack of ['kick', 'charge'] as const) {
      const sim = fightingSim();
      sim.command(A, attack);
      sim.advance(sim.config.commands[attack].windupMs - 200);
      sim.command(D, 'roll');
      sim.advance(200);
      expect(ofType(sim.drainEvents(), 'Evaded')).toHaveLength(1);
      expect(sim.fighters[D].health).toBe(sim.config.fighter.maxHealth);
    }
  });

  it('sweep trifft den Rollenden: 5 Schaden, 1400 ms am Boden', () => {
    const sim = fightingSim();
    const c = sim.config;
    sim.command(A, 'sweep');
    sim.advance(c.commands.sweep.windupMs - 200);
    sim.command(D, 'roll');
    sim.advance(200);
    const events = sim.drainEvents();

    expect(ofType(events, 'Evaded')).toHaveLength(0);
    const hit = ofType(events, 'Hit')[0];
    expect(hit.damage).toBe(c.commands.sweep.damage);
    expect(hit.effect).toBe('knockdown');
    expect(hit.flag).toBe(true); // traf einen Rollenden
    expect(sim.fighters[D].state).toBe('down');
    expect(sim.fighters[D].stateEndMs - sim.timeMs).toBe(c.commands.sweep.knockdownMs);
  });

  it('die Unverwundbarkeit der Rolle endet nach 500 ms', () => {
    const sim = fightingSim();
    const c = sim.config;
    sim.command(A, 'strike');
    sim.advance(c.commands.strike.windupMs - c.commands.roll.activeMs);
    sim.command(D, 'roll'); // Unverwundbarkeit endet genau beim Einschlag
    sim.advance(c.commands.roll.activeMs);
    expect(ofType(sim.drainEvents(), 'Hit')).toHaveLength(1);
  });

  it('sweep wird von jedem Block gestoppt (kein Niederwurf)', () => {
    const sim = fightingSim();
    const c = sim.config;
    sim.command(A, 'sweep');
    sim.advance(c.commands.sweep.windupMs - 500);
    sim.command(D, 'block'); // zu frueh fuers Parieren, aber Block haelt
    sim.advance(500);
    const events = sim.drainEvents();
    expect(ofType(events, 'Blocked')).toHaveLength(1);
    expect(ofType(events, 'Blocked')[0].flag).toBe(false);
    expect(sim.fighters[D].state).toBe('block');
    expect(sim.fighters[D].health).toBeCloseTo(c.fighter.maxHealth - c.commands.sweep.damage * 0.25);
  });

  it('wer am Boden liegt, wird nicht erneut niedergeworfen', () => {
    const sim = fightingSim();
    const c = sim.config;
    sim.command(A, 'sweep');
    sim.advance(c.commands.sweep.windupMs);
    const upAt = sim.fighters[D].stateEndMs;
    sim.advance(c.commands.sweep.recoveryMs + c.simulation.stepMs);
    sim.command(A, 'sweep');
    sim.advance(c.commands.sweep.windupMs);
    // zweiter Feger trifft den Liegenden: Schaden ja, laengeres Liegen nein
    expect(sim.fighters[D].health).toBe(c.fighter.maxHealth - 2 * c.commands.sweep.damage);
    expect(sim.fighters[D].state).toBe('down');
    expect(sim.fighters[D].stateEndMs).toBe(upAt);
  });
});

describe('Unterbrechung', () => {
  it('ein Treffer waehrend des Ausholens bricht die Aktion des Getroffenen ab', () => {
    const sim = fightingSim();
    const c = sim.config;
    sim.command(D, 'charge'); // langes Ausholen
    sim.advance(100);
    sim.command(A, 'strike'); // schlaegt frueher ein
    sim.advance(c.commands.strike.windupMs);
    const events = sim.drainEvents();

    const interrupted = ofType(events, 'Interrupted');
    expect(interrupted).toHaveLength(1);
    expect(interrupted[0].fighter).toBe(D);
    expect(interrupted[0].command).toBe('charge');
    expect(sim.fighters[D].state).toBe('staggered');

    // Der abgebrochene Ansturm schlaegt nie ein.
    sim.advance(c.commands.charge.windupMs);
    expect(sim.fighters[A].health).toBe(c.fighter.maxHealth);
    // Die Ausdauer dafuer ist trotzdem weg.
    expect(sim.fighters[D].stamina).toBeLessThan(c.fighter.maxStamina);
  });

  it('ein Treffer ausserhalb des Ausholens unterbricht nichts', () => {
    const sim = fightingSim();
    sim.command(A, 'strike');
    sim.advance(sim.config.commands.strike.windupMs);
    const events = sim.drainEvents();
    expect(ofType(events, 'Hit')).toHaveLength(1);
    expect(ofType(events, 'Interrupted')).toHaveLength(0);
    expect(sim.fighters[D].state).toBe('idle');
  });

  it('schlagen beide im selben Schritt ein, treffen beide', () => {
    const sim = fightingSim();
    const c = sim.config;
    sim.command(A, 'strike');
    sim.command(D, 'strike');
    sim.advance(c.commands.strike.windupMs);
    const events = sim.drainEvents();
    expect(ofType(events, 'Hit')).toHaveLength(2);
    expect(ofType(events, 'Interrupted')).toHaveLength(0);
    expect(sim.fighters[A].health).toBe(c.fighter.maxHealth - c.weapons.sword.damage);
    expect(sim.fighters[D].health).toBe(c.fighter.maxHealth - c.weapons.sword.damage);
  });

  it('auch der Scheinangriff laesst sich unterbrechen', () => {
    const sim = fightingSim();
    sim.command(A, 'strike');
    sim.advance(sim.config.commands.strike.windupMs - 100);
    sim.command(D, 'bluff');
    sim.advance(100);
    const interrupted = ofType(sim.drainEvents(), 'Interrupted');
    expect(interrupted).toHaveLength(1);
    expect(interrupted[0].command).toBe('bluff');
  });
});

describe('Ausdauer', () => {
  it('Befehl ohne genug Ausdauer wird abgelehnt und gemeldet', () => {
    const sim = fightingSim();
    const c = sim.config;
    // Viermal Ansturm verbraucht die gesamte Ausdauer (4 x 25).
    const perCharge = c.commands.charge.windupMs + c.commands.charge.recoveryMs + c.simulation.stepMs;
    for (let i = 0; i < 4; i++) {
      sim.command(A, 'charge');
      sim.advance(perCharge);
    }
    sim.drainEvents();
    expect(sim.fighters[A].stamina).toBeLessThan(c.commands.strike.staminaCost);
    const before = sim.fighters[A].stamina;

    sim.command(A, 'strike');
    const events = sim.drainEvents();
    expect(types(events)).toEqual(['CommandRejected', 'Exhausted']);
    expect(events[0].reason).toBe('stamina');
    expect(events[0].command).toBe('strike');
    expect(sim.fighters[A].state).toBe('idle');
    expect(sim.fighters[A].stamina).toBe(before);
  });

  it('jeder Befehl kostet seine Ausdauer beim Start', () => {
    for (const id of ['strike', 'left', 'right', 'block', 'kick', 'roll', 'sweep', 'charge', 'bluff'] as const) {
      const sim = fightingSim();
      sim.command(A, id);
      expect(sim.fighters[A].stamina).toBe(
        sim.config.fighter.maxStamina - sim.config.commands[id].staminaCost,
      );
    }
  });

  it('Regeneration beginnt 800 ms nach der letzten Aktion mit 12 pro Sekunde', () => {
    const sim = fightingSim();
    const c = sim.config;
    sim.command(A, 'bluff');
    const afterCost = c.fighter.maxStamina - c.commands.bluff.staminaCost;
    sim.advance(c.commands.bluff.activeMs); // Aktion endet
    expect(sim.fighters[A].state).toBe('idle');
    sim.advance(c.fighter.staminaRegenDelayMs - c.simulation.stepMs);
    expect(sim.fighters[A].stamina).toBeCloseTo(afterCost);
    sim.advance(c.simulation.stepMs + 250);
    // 260 ms Regeneration (der Schritt, in dem die Pause endet, zaehlt mit)
    expect(sim.fighters[A].stamina).toBeCloseTo(afterCost + (c.fighter.staminaRegenPerSecond * 260) / 1000);
  });

  it('waehrend einer Kette von Aktionen regeneriert nichts', () => {
    const sim = fightingSim();
    const c = sim.config;
    sim.command(A, 'strike');
    sim.advance(c.commands.strike.windupMs + c.commands.strike.recoveryMs - 100);
    sim.command(A, 'strike'); // gepuffert, startet nahtlos
    sim.advance(c.commands.strike.windupMs);
    expect(sim.fighters[A].stamina).toBe(c.fighter.maxStamina - 2 * c.commands.strike.staminaCost);
  });
});

describe('Waffenhaltbarkeit und Faustkampf', () => {
  /** Ein normaler (zu frueher) Block des Verteidigers gegen einen Schlag von oben. */
  function earlyBlockedStrike(sim: CombatSim): CombatEvent[] {
    const c = sim.config;
    refillStamina(sim);
    sim.command(A, 'strike');
    sim.advance(c.commands.strike.windupMs - 500);
    sim.command(D, 'block');
    sim.advance(500 + c.commands.block.activeMs); // bis beide wieder frei sind
    return sim.drainEvents();
  }

  it('jeder normale Block kostet Haltbarkeit in Hoehe des Angriffsschadens; bei 0 zerbricht das Schwert', () => {
    const sim = fightingSim();
    const c = sim.config;
    const damage = c.weapons.sword.damage;
    const blocksUntilBroken = c.weapons.sword.durability / damage;
    let broken: CombatEvent[] = [];
    for (let i = 1; i <= blocksUntilBroken; i++) {
      const events = earlyBlockedStrike(sim);
      expect(ofType(events, 'Blocked')).toHaveLength(1);
      expect(sim.fighters[D].durability).toBe(c.weapons.sword.durability - i * damage);
      broken = ofType(events, 'WeaponBroken');
      expect(broken).toHaveLength(i === blocksUntilBroken ? 1 : 0);
    }
    expect(broken[0].fighter).toBe(D);
    expect(sim.fighters[D].weaponBroken).toBe(true);
    expect(sim.fighters[D].weaponId).toBe('fists');
    // Der Angreifer behaelt sein Schwert.
    expect(sim.fighters[A].weaponBroken).toBe(false);
  });

  it('perfektes Parieren kostet keine Haltbarkeit', () => {
    const sim = fightingSim();
    sim.command(A, 'strike');
    sim.advance(sim.config.commands.strike.windupMs - 100);
    sim.command(D, 'block');
    sim.advance(100);
    expect(sim.fighters[D].durability).toBe(sim.config.weapons.sword.durability);
  });

  it('Faustkampf: Schlaege machen 4 Schaden', () => {
    const sim = fightingSim();
    const c = sim.config;
    for (let i = 0; i < c.weapons.sword.durability / c.weapons.sword.damage; i++) earlyBlockedStrike(sim);
    expect(sim.fighters[D].weaponBroken).toBe(true);

    for (const attack of ['strike', 'left', 'right'] as const) {
      refillStamina(sim);
      const before = sim.fighters[A].health;
      sim.command(D, attack);
      sim.advance(c.commands[attack].windupMs + c.commands[attack].recoveryMs + c.simulation.stepMs);
      expect(before - sim.fighters[A].health).toBe(c.weapons.fists.damage);
    }
    // Tritt, Feger und Ansturm haengen nicht an der Waffe.
    refillStamina(sim);
    const before = sim.fighters[A].health;
    sim.command(D, 'kick');
    sim.advance(c.commands.kick.windupMs);
    expect(before - sim.fighters[A].health).toBe(c.commands.kick.damage);
  });

  it('Faustkampf: Block reduziert nur 50 % und kann nicht parieren', () => {
    const sim = fightingSim();
    const c = sim.config;
    for (let i = 0; i < c.weapons.sword.durability / c.weapons.sword.damage; i++) earlyBlockedStrike(sim);
    sim.advance(2000);
    refillStamina(sim);
    sim.drainEvents();

    const before = sim.fighters[D].health;
    sim.command(A, 'strike');
    sim.advance(c.commands.strike.windupMs - 100);
    sim.command(D, 'block'); // perfektes Timing
    sim.advance(100);
    const events = sim.drainEvents();
    expect(ofType(events, 'Parried')).toHaveLength(0);
    expect(ofType(events, 'Blocked')).toHaveLength(1);
    expect(before - sim.fighters[D].health).toBeCloseTo(c.weapons.sword.damage * 0.5);
    expect(sim.fighters[A].state).toBe('recovery');
  });
});

describe('Befehlspuffer', () => {
  it('Befehl waehrend der eigenen Aktion startet danach, wenn er hoechstens 600 ms alt ist', () => {
    const sim = fightingSim();
    const c = sim.config;
    const busyMs = c.commands.strike.windupMs + c.commands.strike.recoveryMs;
    sim.command(A, 'strike');
    sim.advance(busyMs - c.fighter.inputBufferMs);
    sim.command(A, 'kick');
    expect(ofType(sim.drainEvents(), 'CommandBuffered')).toHaveLength(1);
    sim.advance(c.fighter.inputBufferMs);
    expect(sim.fighters[A].state).toBe('windup');
    expect(sim.fighters[A].command).toBe('kick');
  });

  it('ein aelterer Pufferbefehl verfaellt', () => {
    const sim = fightingSim();
    const c = sim.config;
    const busyMs = c.commands.strike.windupMs + c.commands.strike.recoveryMs;
    sim.command(A, 'strike');
    sim.advance(busyMs - c.fighter.inputBufferMs - c.simulation.stepMs);
    sim.command(A, 'kick');
    sim.advance(c.fighter.inputBufferMs + c.simulation.stepMs);
    const events = sim.drainEvents();
    expect(ofType(events, 'CommandRejected')[0].reason).toBe('bufferExpired');
    expect(sim.fighters[A].state).toBe('idle');
  });

  it('der zuletzt gesprochene Befehl gewinnt', () => {
    const sim = fightingSim();
    const c = sim.config;
    sim.command(A, 'strike');
    sim.advance(c.commands.strike.windupMs);
    sim.command(A, 'kick');
    sim.command(A, 'sweep');
    sim.advance(c.commands.strike.recoveryMs);
    expect(sim.fighters[A].command).toBe('sweep');
  });
});

describe('Scheinangriff', () => {
  it('zeigt 450 ms das Ausholen von strike, bricht ab und macht keinen Schaden', () => {
    const sim = fightingSim();
    const c = sim.config;
    sim.command(A, 'bluff');
    const started = ofType(sim.drainEvents(), 'ActionStarted')[0];
    expect(started.command).toBe('bluff');
    expect(started.shownCommand).toBe('strike');

    // Der Gegner sieht ein gewoehnliches Ausholen zum Schlag von oben.
    const seen = sim.visible(A);
    expect(seen.state).toBe('windup');
    expect(seen.command).toBe('strike');
    expect(seen.line).toBe('high');

    sim.advance(c.commands.bluff.activeMs - c.simulation.stepMs);
    expect(sim.visible(A).state).toBe('windup');
    sim.advance(c.simulation.stepMs);
    expect(sim.fighters[A].state).toBe('idle');
    sim.advance(c.commands.strike.windupMs);
    expect(ofType(sim.drainEvents(), 'Hit')).toHaveLength(0);
    expect(sim.fighters[D].health).toBe(c.fighter.maxHealth);
  });
});

describe('Sprechen ohne Befehl', () => {
  it('kein gueltiger Befehl innerhalb von 1200 ms kostet 5 Ausdauer', () => {
    const sim = fightingSim();
    const c = sim.config;
    sim.speechStart(A);
    expect(types(sim.drainEvents())).toEqual(['SpeechStarted']);
    sim.advance(c.speech.penaltyWindowMs - c.simulation.stepMs);
    expect(ofType(sim.drainEvents(), 'SpeechPenalty')).toHaveLength(0);
    expect(sim.fighters[A].stamina).toBe(c.fighter.maxStamina);

    sim.advance(c.simulation.stepMs);
    const penalty = ofType(sim.drainEvents(), 'SpeechPenalty');
    expect(penalty).toHaveLength(1);
    expect(penalty[0].fighter).toBe(A);
    expect(penalty[0].amount).toBe(c.speech.penaltyStamina);
    expect(sim.fighters[A].stamina).toBeCloseTo(c.fighter.maxStamina - c.speech.penaltyStamina);
  });

  it('ein rechtzeitig erkannter Befehl verhindert die Strafe', () => {
    const sim = fightingSim();
    const c = sim.config;
    sim.speechStart(A);
    sim.advance(c.speech.penaltyWindowMs - c.simulation.stepMs);
    sim.command(A, 'block');
    sim.advance(c.speech.penaltyWindowMs);
    const events = sim.drainEvents();
    expect(ofType(events, 'SpeechPenalty')).toHaveLength(0);
    expect(ofType(events, 'SpeechResolved')).toHaveLength(1);
  });

  it('die Strafe faellt je Sprechbeginn nur einmal an', () => {
    const sim = fightingSim();
    sim.speechStart(A);
    sim.speechStart(A); // zweiter Laut im selben Fenster
    sim.advance(5000);
    expect(ofType(sim.drainEvents(), 'SpeechPenalty')).toHaveLength(1);
  });

  it('das Fenster zaehlt ab dem tatsaechlichen Sprechbeginn', () => {
    const sim = fightingSim();
    const c = sim.config;
    sim.speechStart(A, c.voice.vad.minSpeechMs); // die Pegelerkennung meldet 120 ms spaeter
    sim.advance(c.speech.penaltyWindowMs - c.voice.vad.minSpeechMs);
    expect(ofType(sim.drainEvents(), 'SpeechPenalty')).toHaveLength(1);
  });
});

describe('Best of 3', () => {
  /** Kaempfer `winner` gewinnt die laufende Runde durch K.o. */
  function winRound(sim: CombatSim, winner: number): CombatEvent[] {
    startFighting(sim);
    sim.fighters[1 - winner].health = 1;
    sim.command(winner, 'strike');
    sim.advance(sim.config.commands.strike.windupMs);
    return sim.drainEvents();
  }

  /** Laesst die Pause nach der Runde ablaufen. */
  function passRoundBreak(sim: CombatSim): CombatEvent[] {
    sim.advance(sim.config.match.roundEndDelayMs);
    return sim.drainEvents();
  }

  it('Runde endet bei 0 Leben', () => {
    const sim = new CombatSim(loadConfig());
    const events = winRound(sim, A);
    const end = ofType(events, 'RoundEnd');
    expect(end).toHaveLength(1);
    expect(end[0].fighter).toBe(A);
    expect(end[0].reason).toBe('ko');
    expect(sim.fighters[D].state).toBe('ko');
    expect(sim.fighters[A].roundsWon).toBe(1);
    expect(sim.phase).toBe('roundOver');
  });

  it('zwei gewonnene Runden beenden das Match - eine dritte gibt es nicht', () => {
    const sim = new CombatSim(loadConfig());
    winRound(sim, A);
    expect(ofType(passRoundBreak(sim), 'MatchEnd')).toHaveLength(0);
    expect(sim.round).toBe(2);
    winRound(sim, A);
    const events = passRoundBreak(sim);
    const end = ofType(events, 'MatchEnd');
    expect(end).toHaveLength(1);
    expect(end[0].fighter).toBe(A);
    expect(sim.phase).toBe('matchOver');
    expect(sim.matchWinner).toBe(A);
    expect(sim.round).toBe(2);

    // Danach steht alles still.
    const t = sim.timeMs;
    sim.advance(5000);
    sim.command(A, 'strike');
    expect(sim.timeMs).toBe(t);
    expect(ofType(sim.drainEvents(), 'ActionStarted')).toHaveLength(0);
  });

  it('bei 1:1 entscheidet die dritte Runde', () => {
    const sim = new CombatSim(loadConfig());
    winRound(sim, A);
    passRoundBreak(sim);
    winRound(sim, D);
    expect(ofType(passRoundBreak(sim), 'MatchEnd')).toHaveLength(0);
    expect(sim.round).toBe(3);
    winRound(sim, D);
    const end = ofType(passRoundBreak(sim), 'MatchEnd');
    expect(end[0].fighter).toBe(D);
    expect(sim.fighters[A].roundsWon).toBe(1);
    expect(sim.fighters[D].roundsWon).toBe(2);
  });

  it('nach 90 s gewinnt, wer mehr Leben hat', () => {
    const sim = fightingSim();
    const c = sim.config;
    sim.command(A, 'strike');
    sim.advance(c.match.roundTimeMs - c.simulation.stepMs);
    expect(sim.phase).toBe('fighting');
    sim.advance(c.simulation.stepMs);
    const end = ofType(sim.drainEvents(), 'RoundEnd');
    expect(end).toHaveLength(1);
    expect(end[0].reason).toBe('time');
    expect(end[0].fighter).toBe(A);
  });

  it('gleiches Leben nach 90 s: Runde unentschieden, niemand bekommt sie', () => {
    const sim = fightingSim();
    sim.advance(sim.config.match.roundTimeMs);
    const end = ofType(sim.drainEvents(), 'RoundEnd');
    expect(end[0].fighter).toBe(-1);
    expect(sim.fighters[A].roundsWon + sim.fighters[D].roundsWon).toBe(0);
  });

  it('drei unentschiedene Runden: Match unentschieden, nicht endlos', () => {
    const sim = new CombatSim(loadConfig());
    const c = sim.config;
    let matchEnd: CombatEvent[] = [];
    for (let round = 0; round < c.match.bestOf && matchEnd.length === 0; round++) {
      startFighting(sim);
      sim.advance(c.match.roundTimeMs + c.match.roundEndDelayMs);
      matchEnd = ofType(sim.drainEvents(), 'MatchEnd');
    }
    expect(matchEnd).toHaveLength(1);
    expect(matchEnd[0].fighter).toBe(-1);
    expect(sim.round).toBe(c.match.bestOf);
  });

  it('Leben, Ausdauer und Haltbarkeit werden jede Runde zurueckgesetzt', () => {
    const sim = new CombatSim(loadConfig());
    const c = sim.config;
    startFighting(sim);
    // Runde 1 mit Spuren: Schaden, verbrauchte Ausdauer, zerbrochene Waffe.
    sim.fighters[A].health = 40;
    sim.fighters[A].durability = 0;
    sim.fighters[A].weaponBroken = true;
    sim.fighters[A].weaponId = c.brokenWeapon;
    sim.fighters[D].health = 1;
    sim.command(A, 'strike');
    sim.fighters[A].stamina = 3;
    sim.advance(c.commands.strike.windupMs);
    passRoundBreak(sim);

    expect(sim.round).toBe(2);
    for (const f of sim.fighters) {
      expect(f.health).toBe(c.fighter.maxHealth);
      expect(f.stamina).toBe(c.fighter.maxStamina);
      expect(f.durability).toBe(c.weapons.sword.durability);
      expect(f.weaponBroken).toBe(false);
      expect(f.weaponId).toBe(c.activeWeapon);
      expect(f.state).toBe('idle');
    }
    // Die gewonnene Runde bleibt stehen.
    expect(sim.fighters[A].roundsWon).toBe(1);
  });

  it('vor Kampfbeginn und in der Rundenpause werden Befehle abgelehnt', () => {
    const sim = new CombatSim(loadConfig());
    sim.drainEvents();
    sim.command(A, 'strike');
    const events = sim.drainEvents();
    expect(types(events)).toEqual(['CommandRejected']);
    expect(events[0].reason).toBe('notFighting');
    // Sprechen kostet dort auch nichts.
    sim.speechStart(A);
    expect(sim.drainEvents()).toHaveLength(0);
  });
});

describe('Zeitschritt', () => {
  it('rechnet in festen 10-ms-Schritten', () => {
    const sim = new CombatSim(loadConfig());
    const t = sim.timeMs;
    sim.step();
    expect(sim.timeMs - t).toBe(sim.config.simulation.stepMs);
    sim.advance(1000);
    expect(sim.timeMs - t).toBe(sim.config.simulation.stepMs + 1000);
  });

  it('ein Schlag trifft genau nach seiner Aushol-Zeit', () => {
    const sim = fightingSim();
    const c = sim.config;
    sim.command(A, 'strike');
    const t0 = sim.timeMs;
    sim.advance(c.commands.strike.windupMs - c.simulation.stepMs);
    expect(ofType(sim.drainEvents(), 'Hit')).toHaveLength(0);
    sim.advance(c.simulation.stepMs);
    const hit = ofType(sim.drainEvents(), 'Hit');
    expect(hit).toHaveLength(1);
    expect(hit[0].timeMs - t0).toBe(c.commands.strike.windupMs);
  });
});
