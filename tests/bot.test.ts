// Tests fuer Bot und Sitzung: Wiederholbarkeit, die menschlichen Nachteile
// des Bots und dass jede Stufe ein Match zu Ende spielt.

import { describe, expect, it } from 'vitest';
import {
  BOT_LEVEL_IDS,
  CombatSession,
  type BotLevelId,
  type CombatEvent,
  type CommandId,
} from '../src/combat';
import { loadConfig, ofType } from './helpers';

const PLAYER = 0;
const BOT = 1;

/** Laesst zwei Bots ein ganzes Match austragen. */
function botMatch(a: BotLevelId, b: BotLevelId, seed: number): { events: CombatEvent[]; session: CombatSession } {
  const config = loadConfig();
  const session = new CombatSession(config, { seed, bots: [a, b] });
  const events: CombatEvent[] = [];
  // Obergrenze: alle Runden ueber die volle Zeit plus Pausen.
  const maxMs =
    config.match.bestOf *
    (config.match.roundTimeMs + config.match.roundStartDelayMs + config.match.roundEndDelayMs + 1000);
  const chunkMs = 1000;
  for (let t = 0; t < maxMs && session.sim.phase !== 'matchOver'; t += chunkMs) {
    for (const e of session.run(chunkMs)) events.push(e);
  }
  return { events, session };
}

/** Ein Spieler nach Drehbuch gegen einen Bot. */
function scriptedVsBot(
  level: BotLevelId,
  seed: number,
  durationMs: number,
  script: (timeMs: number, session: CombatSession) => CommandId | '',
): CombatEvent[] {
  const config = loadConfig((c) => {
    // Der Spieler soll im Drehbuch nicht an Leben oder Ausdauer scheitern.
    c.fighter.maxHealth = 100000;
    c.fighter.maxStamina = 100000;
    c.match.roundTimeMs = durationMs * 2;
  });
  const session = new CombatSession(config, { seed, bots: [null, level] });
  const events: CombatEvent[] = [];
  const stepMs = config.simulation.stepMs;
  for (let t = 0; t < durationMs; t += stepMs) {
    if (session.sim.phase === 'fighting') {
      const cmd = script(session.sim.roundTimeMs, session);
      if (cmd !== '') session.command(PLAYER, cmd);
    }
    for (const e of session.stepOnce()) events.push(e);
  }
  return events;
}

describe('Determinismus', () => {
  it('gleicher Startwert ergibt exakt dieselbe Ereignisfolge', () => {
    const first = botMatch('hard', 'medium', 12345);
    const second = botMatch('hard', 'medium', 12345);
    expect(first.events.length).toBeGreaterThan(50);
    expect(JSON.stringify(second.events)).toBe(JSON.stringify(first.events));
  });

  it('anderer Startwert ergibt einen anderen Kampf', () => {
    const first = botMatch('hard', 'medium', 12345);
    const other = botMatch('hard', 'medium', 54321);
    expect(JSON.stringify(other.events)).not.toBe(JSON.stringify(first.events));
  });
});

describe('Bot: jede Stufe spielt ein Match zu Ende', () => {
  for (const level of BOT_LEVEL_IDS) {
    it(`${level} gegen ${level}`, () => {
      for (const seed of [1, 2, 3]) {
        const { events, session } = botMatch(level, level, seed);
        expect(session.sim.phase).toBe('matchOver');
        expect(ofType(events, 'MatchEnd')).toHaveLength(1);
        const rounds = ofType(events, 'RoundEnd').length;
        expect(rounds).toBeGreaterThanOrEqual(2);
        expect(rounds).toBeLessThanOrEqual(session.sim.config.match.bestOf);
        // Es wurde tatsaechlich gekaempft.
        expect(ofType(events, 'ActionStarted').length).toBeGreaterThan(10);
      }
    });
  }

  it('die schwere Stufe schlaegt die leichte in der Mehrzahl der Matches', () => {
    let hardWins = 0;
    const matches = 12;
    for (let seed = 1; seed <= matches; seed++) {
      const { session } = botMatch('hard', 'easy', seed * 7919);
      if (session.sim.matchWinner === 0) hardWins += 1;
    }
    expect(hardWins).toBeGreaterThan(matches / 2);
  });
});

describe('Bot: dieselben Nachteile wie ein Mensch', () => {
  it('vor jedem Befehl liegt die simulierte Sprechzeit, das "!" kommt beim Sprechbeginn', () => {
    const config = loadConfig();
    const { events } = botMatch('hard', 'hard', 99);
    const min = config.bot.speechDelayMs - config.bot.speechJitterMs;
    const max = config.bot.speechDelayMs + config.bot.speechJitterMs;

    for (const fighter of [0, 1]) {
      const started = ofType(events, 'SpeechStarted').filter((e) => e.fighter === fighter);
      const resolved = ofType(events, 'SpeechResolved').filter((e) => e.fighter === fighter);
      expect(started.length).toBeGreaterThan(5);
      // Jeder Sprechbeginn endet in einem Befehl - der Bot zahlt nie die Strafe.
      expect(ofType(events, 'SpeechPenalty').filter((e) => e.fighter === fighter)).toHaveLength(0);
      for (const r of resolved) {
        expect(r.durationMs).toBeGreaterThanOrEqual(min);
        // Ein Simulationsschritt Toleranz fuer die Rundung auf den Takt.
        expect(r.durationMs).toBeLessThanOrEqual(max + config.simulation.stepMs);
      }

      // Kein Befehl des Bots ohne vorherigen Sprechbeginn.
      const actions = events.filter(
        (e) =>
          e.fighter === fighter &&
          (e.type === 'ActionStarted' || e.type === 'CommandBuffered' || e.type === 'CommandRejected') &&
          e.reason !== 'bufferExpired',
      );
      // Gepufferte Befehle starten spaeter noch einmal als ActionStarted;
      // gezaehlt werden deshalb nur die Eingaben selbst.
      const inputs = actions.filter((e, i) => {
        if (e.type !== 'ActionStarted') return true;
        const prev = actions[i - 1];
        return !(prev && prev.type === 'CommandBuffered' && prev.command === e.command);
      });
      expect(resolved.length).toBeGreaterThanOrEqual(inputs.length);
    }
  });

  it('zwischen Aushol-Beginn des Gegners und Abwehr liegen Reaktions- und Sprechzeit', () => {
    const config = loadConfig();
    const minDelay =
      config.bot.reactionMs - config.bot.reactionJitterMs + config.bot.speechDelayMs - config.bot.speechJitterMs;

    // Der Spieler schlaegt alle 2,5 s von oben, sonst nichts.
    const events = scriptedVsBot('hard', 4711, 120000, (t) => (t % 2500 === 0 ? 'strike' : ''));

    let lastWindupStart = -1;
    let blocks = 0;
    for (const e of events) {
      if (e.type !== 'ActionStarted') continue;
      if (e.fighter === PLAYER && e.kind === 'attack') lastWindupStart = e.timeMs;
      if (e.fighter === BOT && e.kind === 'block' && lastWindupStart >= 0) {
        blocks += 1;
        expect(e.timeMs - lastWindupStart).toBeGreaterThanOrEqual(minDelay);
      }
    }
    // Die schwere Stufe wehrt tatsaechlich ab.
    expect(blocks).toBeGreaterThan(10);
    expect(ofType(events, 'Parried').filter((e) => e.fighter === BOT).length).toBeGreaterThan(5);
  });

  it('faellt auf den Scheinangriff herein: er sieht nur das Ausholen', () => {
    // Der Spieler blufft alle 3 s. Blockt der Bot danach, hat er den
    // Scheinangriff fuer einen Schlag gehalten.
    const events = scriptedVsBot('hard', 31337, 120000, (t) => (t % 3000 === 0 ? 'bluff' : ''));
    const bluffs = events.filter((e) => e.type === 'ActionStarted' && e.fighter === PLAYER && e.kind === 'feint');
    const botBlocks = events.filter((e) => e.type === 'ActionStarted' && e.fighter === BOT && e.kind === 'block');
    expect(bluffs.length).toBeGreaterThan(20);
    expect(botBlocks.length).toBeGreaterThan(bluffs.length / 4);
  });
});

describe('Bot-Stufen', () => {
  /** Zaehlt, wie der Bot auf einen Spieler antwortet, der stur von oben schlaegt (drei Kaempfe). */
  function defenses(level: BotLevelId): { defenses: number; stopped: number; attacks: number; strikes: number } {
    const sum = { defenses: 0, stopped: 0, attacks: 0, strikes: 0 };
    for (const seed of [2024, 4711, 9]) {
      const events = scriptedVsBot(level, seed, 150000, (t) => (t % 2500 === 0 ? 'strike' : ''));
      for (const e of events) {
        if (e.type === 'ActionStarted' && e.fighter === PLAYER) sum.strikes += 1;
        if (e.type === 'ActionStarted' && e.fighter === BOT) {
          if (e.kind === 'block' || e.kind === 'roll') sum.defenses += 1;
          if (e.kind === 'attack') sum.attacks += 1;
        }
        // Der Schlag des Spielers wurde pariert, geblockt oder ausgewichen.
        if ((e.type === 'Parried' || e.type === 'Blocked' || e.type === 'Evaded') && e.fighter === BOT) {
          sum.stopped += 1;
        }
      }
    }
    return sum;
  }

  it('leicht: greift an und blockt selten', () => {
    const easy = defenses('easy');
    const medium = defenses('medium');
    expect(easy.attacks).toBeGreaterThan(60);
    // hoechstens jeder sechste Schlag wird ueberhaupt beantwortet
    expect(easy.defenses).toBeLessThan(easy.strikes / 6);
    expect(easy.defenses).toBeLessThan(medium.defenses / 2);
  });

  it('mittel: reagiert auf Aushol-Animationen', () => {
    const medium = defenses('medium');
    // mindestens jeder vierte Schlag wird beantwortet, die meisten Antworten wirken
    expect(medium.defenses).toBeGreaterThan(medium.strikes / 4);
    expect(medium.stopped).toBeGreaterThan(medium.defenses * 0.6);
  });

  it('schwer: nutzt bluff und kick gegen haeufiges Blocken', () => {
    const count = (events: CombatEvent[], cmd: CommandId) =>
      events.filter((e) => e.type === 'ActionStarted' && e.fighter === BOT && e.command === cmd).length;

    // Spieler A blockt jeden sichtbaren Angriff; Spieler B tut nichts.
    const blocker = scriptedVsBot('hard', 77, 180000, (_t, s) => {
      const seen = s.sim.visible(BOT);
      const me = s.sim.fighters[PLAYER];
      const justStarted = seen.state === 'windup' && s.sim.timeMs - seen.startMs === 300;
      return justStarted && me.state === 'idle' ? 'block' : '';
    });
    const passive = scriptedVsBot('hard', 77, 180000, () => '');

    const share = (events: CombatEvent[]) => {
      const total = events.filter(
        (e) => e.type === 'ActionStarted' && e.fighter === BOT && (e.kind === 'attack' || e.kind === 'feint'),
      ).length;
      return (count(events, 'bluff') + count(events, 'kick')) / Math.max(1, total);
    };
    expect(share(blocker)).toBeGreaterThan(share(passive) * 1.3);
  });

  it('schwer: nutzt sweep gegen haeufiges Rollen', () => {
    const sweepShare = (events: CombatEvent[]) => {
      const attacks = events.filter(
        (e) => e.type === 'ActionStarted' && e.fighter === BOT && (e.kind === 'attack' || e.kind === 'feint'),
      );
      return attacks.filter((e) => e.command === 'sweep').length / Math.max(1, attacks.length);
    };
    // Spieler A rollt bei jedem sichtbaren Angriff; Spieler B tut nichts.
    const roller = scriptedVsBot('hard', 78, 180000, (_t, s) => {
      const seen = s.sim.visible(BOT);
      const me = s.sim.fighters[PLAYER];
      const windupMs = seen.command !== '' ? s.sim.windupOf(BOT, seen.command) : 0;
      const justInTime = seen.state === 'windup' && s.sim.timeMs - seen.startMs === windupMs - 250;
      return justInTime && me.state === 'idle' ? 'roll' : '';
    });
    const passive = scriptedVsBot('hard', 78, 180000, () => '');
    expect(sweepShare(roller)).toBeGreaterThan(sweepShare(passive) * 1.3);
  });

  it('die Stufe laesst sich im laufenden Kampf wechseln', () => {
    const session = new CombatSession(loadConfig(), { seed: 5, bots: [null, 'easy'] });
    session.run(5000);
    session.bots[BOT]?.setLevel('hard');
    expect(session.bots[BOT]?.getLevel()).toBe('hard');
    session.run(5000);
    expect(session.sim.phase).not.toBe('intro');
  });
});
