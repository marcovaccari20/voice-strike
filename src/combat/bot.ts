// Der Bot. Er bekommt dieselben Nachteile wie ein Mensch am Mikrofon:
//
//   Reiz (Aushol-Animation des Gegners)
//     -> Reaktionszeit (bot.reactionMs +- reactionJitterMs)
//     -> Entscheidung = simulierter Sprechbeginn: das "!" erscheint
//     -> Sprechzeit (bot.speechDelayMs +- speechJitterMs)
//     -> erst jetzt geht der Befehl an die Simulation
//
// Er benutzt genau die zwei Eingaenge der Simulation, die auch der Spieler
// hat (`speechStart`, `command`), und sieht vom Gegner nur, was sichtbar ist
// (`sim.visible`): Ein Scheinangriff sieht fuer ihn aus wie ein Schlag.
// Er kann nicht zwei Woerter gleichzeitig sprechen und ein begonnenes Wort
// nicht zuruecknehmen.

import type { BotConfig, BotLevelConfig } from './config';
import { Rng } from './rng';
import { isIncapacitated, type CombatSim } from './sim';
import {
  COMMAND_IDS,
  type BotLevelId,
  type CombatEvent,
  type CommandId,
  type FighterData,
} from './types';

interface Plan {
  command: CommandId;
  speakStartMs: number;
  speakEndMs: number;
  speaking: boolean;
  /** Aktion des Gegners, auf die der Plan antwortet; -1 bei eigenem Antrieb. */
  stimulusSeq: number;
  /** Der Plan ist eine Abwehr mit Block (fuer den Konter danach). */
  isBlock: boolean;
}

interface Stimulus {
  kind: 'attack' | 'opening';
  command: CommandId | '';
  seq: number;
  impactAtMs: number;
  noticeAtMs: number;
}

type Response = 'block' | 'roll' | 'none';

export class BotController {
  readonly fighterId: number;
  /** Mittlere simulierte Sprechzeit in ms; im Debug-Feld verstellbar. */
  speechDelayMs: number;

  private readonly cfg: BotConfig;
  private readonly rng: Rng;
  private levelId: BotLevelId;
  private level: BotLevelConfig;

  private plan: Plan | null = null;
  private stimulus: Stimulus | null = null;
  private lastSeenSeq = -1;
  private opponentWasOpen = false;
  private nextThinkAtMs = 0;
  /** Der Bot steckte im letzten Schritt in einer eigenen Aktion oder war wehrlos. */
  private wasBusy = false;
  private resting = false;
  private lastRound = 0;

  /** Wie der Gegner zuletzt auf Angriffe des Bots geantwortet hat. */
  private responses: Response[] = [];
  /** Bis wann auf eine Antwort auf den eigenen Scheinangriff gewartet wird. */
  private bluffWatchUntilMs = -1;

  constructor(fighterId: number, cfg: BotConfig, levelId: BotLevelId, seed: number) {
    this.fighterId = fighterId;
    this.cfg = cfg;
    this.rng = new Rng(seed);
    this.levelId = levelId;
    this.level = cfg.levels[levelId];
    this.speechDelayMs = cfg.speechDelayMs;
  }

  getLevel(): BotLevelId {
    return this.levelId;
  }

  setLevel(levelId: BotLevelId): void {
    this.levelId = levelId;
    this.level = this.cfg.levels[levelId];
    this.responses = [];
    this.resting = false;
  }

  /** Einmal je Simulationsschritt, VOR `sim.step()`. */
  update(sim: CombatSim): void {
    if (sim.phase !== 'fighting') {
      this.plan = null;
      this.stimulus = null;
      this.bluffWatchUntilMs = -1;
      return;
    }
    const now = sim.timeMs;
    const me = sim.fighters[this.fighterId];
    const opp = sim.fighters[1 - this.fighterId];
    const seen = sim.visible(opp.id);

    if (sim.round !== this.lastRound) {
      this.lastRound = sim.round;
      this.plan = null;
      this.stimulus = null;
      this.resting = false;
      this.wasBusy = false;
      this.opponentWasOpen = false;
      this.lastSeenSeq = seen.actionSeq;
      this.nextThinkAtMs = now + this.thinkPause();
    }

    // Die Denkpause zaehlt ab dem Moment, in dem der Bot wieder frei ist.
    // In dieser Pause ist er aufnahmefaehig fuer das, was der Gegner tut -
    // ohne sie haette er immer schon das naechste Wort auf der Zunge.
    const busy = me.state !== 'idle';
    if (this.wasBusy && !busy) this.nextThinkAtMs = Math.max(this.nextThinkAtMs, now + this.thinkPause());
    this.wasBusy = busy;

    // Niemand hat auf den Scheinangriff reagiert.
    if (this.bluffWatchUntilMs >= 0 && now >= this.bluffWatchUntilMs) {
      this.bluffWatchUntilMs = -1;
      this.remember('none');
    }

    // --- laufender Plan ---------------------------------------------------
    if (this.plan) {
      const p = this.plan;
      if (!p.speaking) {
        const stimulusGone =
          p.stimulusSeq >= 0 && (seen.actionSeq !== p.stimulusSeq || seen.state !== 'windup');
        if (stimulusGone) {
          // Der Angriff ist vorbei, bevor der Bot den Mund aufgemacht hat.
          this.plan = null;
        } else if (now >= p.speakStartMs) {
          p.speaking = true;
          sim.speechStart(this.fighterId);
        }
      }
      if (this.plan && p.speaking && now >= p.speakEndMs) {
        this.plan = null;
        sim.command(this.fighterId, p.command);
        this.afterCommand(sim, p);
      }
    }

    // --- Reize wahrnehmen ---------------------------------------------------
    if (seen.actionSeq !== this.lastSeenSeq) {
      this.lastSeenSeq = seen.actionSeq;
      if (seen.state === 'windup' && seen.command !== '') {
        this.stimulus = {
          kind: 'attack',
          command: seen.command,
          seq: seen.actionSeq,
          // Der Bot rechnet mit der Dauer dessen, was er SIEHT.
          impactAtMs: seen.startMs + sim.windupOf(opp.id, seen.command),
          noticeAtMs: now + this.reactionTime(),
        };
      }
    }
    const open = opp.state === 'stunned' || opp.state === 'paralyzed' || opp.state === 'down';
    if (open && !this.opponentWasOpen) {
      this.stimulus = {
        kind: 'opening',
        command: '',
        seq: -1,
        impactAtMs: -1,
        noticeAtMs: now + this.reactionTime(),
      };
    }
    this.opponentWasOpen = open;

    // --- entscheiden ----------------------------------------------------------
    if (!this.plan && this.stimulus && now >= this.stimulus.noticeAtMs) {
      const s = this.stimulus;
      this.stimulus = null;
      if (s.kind === 'attack') this.decideDefense(sim, me, s);
      else this.decidePunish(sim, me, opp);
    }
    if (!this.plan && !this.stimulus && now >= this.nextThinkAtMs) {
      this.decideInitiative(sim, me);
    }
  }

  /** Einmal je Simulationsschritt, NACH `sim.step()`, mit dessen Ereignissen. */
  observe(events: readonly CombatEvent[]): void {
    const me = this.fighterId;
    for (const e of events) {
      switch (e.type) {
        case 'Blocked':
        case 'Parried':
          if (e.target === me) this.remember('block');
          break;
        case 'GuardBroken':
          if (e.fighter === me) this.remember('block');
          break;
        case 'Evaded':
          if (e.target === me) this.remember('roll');
          break;
        case 'Hit':
          // Auf `GuardBroken` folgt immer ein `Hit`; der zaehlt nicht doppelt.
          if (e.fighter === me && !this.lastWasGuardBreak(events, e)) {
            this.remember(e.flag ? 'roll' : 'none');
          }
          break;
        case 'ActionStarted':
          if (e.fighter === me && e.kind === 'feint') {
            this.bluffWatchUntilMs = e.timeMs + e.durationMs + this.cfg.reactionMs + this.speechDelayMs;
          } else if (e.fighter !== me && this.bluffWatchUntilMs >= 0) {
            if (e.kind === 'block') {
              this.bluffWatchUntilMs = -1;
              this.remember('block');
            } else if (e.kind === 'roll') {
              this.bluffWatchUntilMs = -1;
              this.remember('roll');
            }
          }
          break;
        default:
          break;
      }
    }
  }

  // -------------------------------------------------------------------------
  // Entscheidungen
  // -------------------------------------------------------------------------

  /** Antwort auf eine sichtbare Aushol-Animation. */
  private decideDefense(sim: CombatSim, me: FighterData, s: Stimulus): void {
    const now = sim.timeMs;
    const seen = sim.visible(1 - this.fighterId);
    if (s.command === '' || seen.actionSeq !== s.seq || seen.state !== 'windup') return;
    if (!this.rng.chance(this.level.reactChance)) return;
    // Der eigene Angriff schlaegt zuerst ein und unterbricht den Gegner.
    if (me.state === 'windup' && me.impactAtMs < s.impactAtMs) return;

    const counter = this.chooseCounter(sim, s.command);
    const speech = this.speechTime();
    const leadMs = counter === 'roll' ? this.cfg.rollLeadMs : this.cfg.parryLeadMs;
    let commandAtMs = now + speech;
    if (this.rng.chance(this.level.timingChance)) {
      // Geuebte Abwehr: so spaet sprechen, dass Block bzw. Rolle ins Fenster faellt.
      commandAtMs = Math.max(commandAtMs, s.impactAtMs - leadMs);
    }
    if (commandAtMs >= s.impactAtMs) return; // kaeme zu spaet
    // Solange der Bot selbst betaeubt ist, wuerde der Befehl verworfen.
    if (
      isIncapacitated(me.state) &&
      me.stateEndMs > commandAtMs &&
      !sim.config.fighter.bufferWhileIncapacitated
    ) {
      return;
    }
    if (!this.canAfford(sim, me, counter, true)) return;

    this.plan = {
      command: counter,
      speakStartMs: commandAtMs - speech,
      speakEndMs: commandAtMs,
      speaking: false,
      stimulusSeq: s.seq,
      isBlock: counter !== 'roll',
    };
  }

  /** Der Gegner ist betaeubt, gelaehmt oder am Boden. */
  private decidePunish(sim: CombatSim, me: FighterData, opp: FighterData): void {
    const now = sim.timeMs;
    if (!isIncapacitated(opp.state)) return;
    if (!this.rng.chance(this.level.punishChance)) return;
    const speech = this.speechTime();
    const remainingMs = opp.stateEndMs - now;

    // Der staerkste Angriff, der noch einschlaegt, solange der Gegner wehrlos ist.
    let best: CommandId | '' = '';
    let bestDamage = -1;
    let fastest: CommandId | '' = '';
    let fastestMs = Infinity;
    for (const id of COMMAND_IDS) {
      if (sim.config.commands[id].kind !== 'attack') continue;
      if (!this.canAfford(sim, me, id, false)) continue;
      const totalMs = speech + sim.windupOf(me.id, id);
      const damage = sim.damageOf(me.id, id);
      if (totalMs < fastestMs) {
        fastestMs = totalMs;
        fastest = id;
      }
      if (totalMs <= remainingMs && damage > bestDamage) {
        bestDamage = damage;
        best = id;
      }
    }
    const choice = best !== '' ? best : fastest;
    if (choice === '') return;
    this.plan = {
      command: choice,
      speakStartMs: now,
      speakEndMs: now + speech,
      speaking: false,
      stimulusSeq: -1,
      isBlock: false,
    };
  }

  /** Eigener Angriff aus der Ruhe. */
  private decideInitiative(sim: CombatSim, me: FighterData): void {
    const now = sim.timeMs;
    if (me.state !== 'idle') {
      this.nextThinkAtMs = now + sim.config.simulation.stepMs;
      return;
    }
    // Mit der Ausdauer haushalten.
    if (this.resting) {
      if (me.stamina < this.level.restUntilStamina) {
        this.nextThinkAtMs = now + sim.config.simulation.stepMs;
        return;
      }
      this.resting = false;
    } else if (me.stamina < this.level.restBelowStamina) {
      this.resting = true;
      this.nextThinkAtMs = now + sim.config.simulation.stepMs;
      return;
    }

    const ids: CommandId[] = [];
    const weights: number[] = [];
    const adapted = this.adaptedWeights();
    for (const id of COMMAND_IDS) {
      const w = adapted[id] ?? 0;
      if (w <= 0) continue;
      const kind = sim.config.commands[id].kind;
      if (kind !== 'attack' && kind !== 'feint') continue;
      if (!this.canAfford(sim, me, id, false)) continue;
      ids.push(id);
      weights.push(w);
    }
    const index = this.rng.pickWeighted(weights);
    if (index < 0) {
      this.nextThinkAtMs = now + this.thinkPause();
      return;
    }
    const speech = this.speechTime();
    this.plan = {
      command: ids[index],
      speakStartMs: now,
      speakEndMs: now + speech,
      speaking: false,
      stimulusSeq: -1,
      isBlock: false,
    };
  }

  /** Nach einem ausgesprochenen Befehl: Kombination anhaengen, Denkpause setzen. */
  private afterCommand(sim: CombatSim, issued: Plan): void {
    const now = sim.timeMs;
    this.nextThinkAtMs = now + this.thinkPause();

    const def = sim.config.commands[issued.command];
    let options: readonly CommandId[] = [];
    if (issued.isBlock) options = this.cfg.combos.afterBlock;
    else if (def.kind === 'feint') options = this.cfg.combos.afterBluff;
    else if (def.kind === 'attack' && def.knockdownMs > 0) options = this.cfg.combos.afterSweep;
    if (options.length === 0 || !this.rng.chance(this.level.comboChance)) return;

    const me = sim.fighters[this.fighterId];
    const affordable = options.filter((id) => this.canAfford(sim, me, id, false));
    if (affordable.length === 0) return;
    const follow = affordable[Math.floor(this.rng.next() * affordable.length) % affordable.length];
    const speech = this.speechTime();
    // Zweites Wort gleich hinterher; die Simulation puffert es wie beim Spieler.
    this.plan = {
      command: follow,
      speakStartMs: now,
      speakEndMs: now + speech,
      speaking: false,
      stimulusSeq: -1,
      isBlock: false,
    };
  }

  // -------------------------------------------------------------------------
  // Hilfen
  // -------------------------------------------------------------------------

  /** Die richtige Abwehr gegen einen sichtbaren Angriff - oder absichtlich eine falsche. */
  private chooseCounter(sim: CombatSim, attack: CommandId): CommandId {
    const def = sim.config.commands[attack];
    const sideAttack = def.line === 'left' || def.line === 'right';
    const directional = sim.directionalBlock && sideAttack;

    let correct: CommandId = 'block';
    if (def.breaksBlock) correct = 'roll';
    else if (def.hitsRolling || def.stoppedByAnyBlock) correct = 'block';
    else if (directional) correct = this.directionWord(sim, sim.requiredBlockLine(def.line));

    if (this.rng.chance(this.level.correctCounterChance)) return correct;

    const wrong: CommandId[] = [];
    for (const id of ['block', 'roll'] as const) if (id !== correct) wrong.push(id);
    if (directional) {
      // Bei einem Seitenschlag zaehlen beide Richtungswoerter als Block.
      for (const line of ['left', 'right'] as const) {
        const id = this.directionWord(sim, line);
        if (id !== correct && !wrong.includes(id)) wrong.push(id);
      }
    }
    return wrong[Math.floor(this.rng.next() * wrong.length) % wrong.length];
  }

  /** Der Befehl, dessen Wort fuer diese Seite steht. */
  private directionWord(sim: CombatSim, line: 'left' | 'right' | string): CommandId {
    for (const id of COMMAND_IDS) {
      const def = sim.config.commands[id];
      if (def.kind === 'attack' && def.line === line) return id;
    }
    return 'block';
  }

  private canAfford(sim: CombatSim, me: FighterData, cmd: CommandId, asDefense: boolean): boolean {
    const def = sim.config.commands[cmd];
    // Ein Richtungswort als Abwehr kostet wie `block`.
    const isDirectionBlock = asDefense && def.kind === 'attack';
    const cost = isDirectionBlock ? sim.costOf(me.id, 'block') : sim.costOf(me.id, cmd);
    return me.stamina >= cost;
  }

  /** Gewichte der Angriffe; die Stufe "schwer" passt sie dem Gegner an. */
  private adaptedWeights(): Record<string, number> {
    const w: Record<string, number> = { ...this.level.attackWeights };
    if (!this.level.adaptive || this.responses.length < this.level.adaptMinSamples) return w;
    let blocks = 0;
    let rolls = 0;
    for (const r of this.responses) {
      if (r === 'block') blocks += 1;
      else if (r === 'roll') rolls += 1;
    }
    const blockRate = blocks / this.responses.length;
    const rollRate = rolls / this.responses.length;
    if (blockRate >= this.level.adaptThreshold) {
      // Wer viel blockt, bekommt Scheinangriffe und Tritte.
      const boost = 1 + this.level.adaptBoost * blockRate;
      w.bluff = (w.bluff ?? 0) * boost;
      w.kick = (w.kick ?? 0) * boost;
    }
    if (rollRate >= this.level.adaptThreshold) {
      // Wer viel rollt, bekommt den Beinfeger.
      w.sweep = (w.sweep ?? 0) * (1 + this.level.adaptBoost * rollRate);
    }
    return w;
  }

  private remember(r: Response): void {
    this.responses.push(r);
    while (this.responses.length > this.level.adaptWindow) this.responses.shift();
  }

  private lastWasGuardBreak(events: readonly CombatEvent[], hit: CombatEvent): boolean {
    const i = events.indexOf(hit);
    return i > 0 && events[i - 1].type === 'GuardBroken' && events[i - 1].fighter === hit.fighter;
  }

  private speechTime(): number {
    if (this.speechDelayMs <= 0) return 0;
    return Math.max(0, Math.round(this.rng.jitter(this.speechDelayMs, this.cfg.speechJitterMs)));
  }

  private reactionTime(): number {
    return Math.max(0, Math.round(this.rng.jitter(this.cfg.reactionMs, this.cfg.reactionJitterMs)));
  }

  private thinkPause(): number {
    return Math.round(this.rng.range(this.level.thinkMinMs, this.level.thinkMaxMs));
  }
}
