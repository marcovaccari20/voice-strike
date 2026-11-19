// Die Kampfsimulation: Regeln, Zustaende, Ereignisse.
//
// - fester Zeitschritt (config.simulation.stepMs, 10 ms), alle Zeiten in ms
// - deterministisch: kein Zufall, keine Uhr, keine Browser- oder Grafikaufrufe
// - Eingaben sind genau zwei: `speechStart` (jemand beginnt zu sprechen) und
//   `command` (ein Befehl wurde erkannt). Tastatur, Mikrofon und Bot gehen
//   durch dieselben zwei Tueren.
// - alles, was geschieht, wird als Ereignis gemeldet (`drainEvents`)
//
// Reihenfolge innerhalb eines Schritts (siehe `step`):
//   1. Zeit vorruecken   2. abgelaufene Zustaende beenden   3. Einschlaege
//   4. K.o./Zeitablauf   5. gepufferte Befehle starten      6. Ausdauer, Sprechstrafe

import type { CombatConfig, CommandConfig, WeaponConfig } from './config';
import type {
  ActionKind,
  CombatEvent,
  CombatEventType,
  CommandId,
  FighterData,
  FighterStateId,
  HitEffect,
  Line,
  MatchPhase,
  RoundEndReason,
  VisibleAction,
} from './types';

const NO_TIME = -1;
/** Toleranz fuer Vergleiche von Kommazahlen (Ausdauer waechst in 0,12er-Schritten). */
const EPSILON = 1e-6;

/** Zustaende, in denen der Kaempfer eine EIGENE Aktion ausfuehrt. */
export function isOwnAction(state: FighterStateId): boolean {
  return (
    state === 'windup' ||
    state === 'recovery' ||
    state === 'block' ||
    state === 'roll' ||
    state === 'feint'
  );
}

/** Zustaende, in denen der Kaempfer nichts tun kann. */
export function isIncapacitated(state: FighterStateId): boolean {
  return state === 'staggered' || state === 'stunned' || state === 'paralyzed' || state === 'down';
}

/** Zustaende mit Kontrollverlust, die sich nicht gegenseitig verlaengern. */
function isControlled(state: FighterStateId): boolean {
  return state === 'stunned' || state === 'paralyzed' || state === 'down';
}

export class CombatSim {
  readonly config: CombatConfig;
  readonly fighters: [FighterData, FighterData];

  /** Zeit seit Matchbeginn in ms. */
  timeMs = 0;
  /** Reine Kampfzeit der laufenden Runde in ms. */
  roundTimeMs = 0;
  /** Laufende Runde, 1-basiert. */
  round = 0;
  phase: MatchPhase = 'intro';
  /** Ende von Vorlauf bzw. Rundenpause. */
  phaseEndMs = 0;
  /** Sieger der letzten Runde, -1 bei Unentschieden oder vor der ersten. */
  lastRoundWinner = -1;
  /** Sieger des Matches, -1 solange offen oder bei Unentschieden. */
  matchWinner = -1;
  /** Schalter "Richtungsblock"; Startwert aus der Konfiguration. */
  directionalBlock: boolean;
  /** Faktor auf Aushol-Zeiten und Scheinangriff; Startwert aus der Konfiguration. */
  windupScale: number;

  private events: CombatEvent[] = [];

  constructor(config: CombatConfig) {
    this.config = config;
    this.directionalBlock = config.block.directionalBlock;
    this.windupScale = config.tempo.windupScale;
    this.fighters = [this.createFighter(0), this.createFighter(1)];
    this.beginRound(1);
  }

  // -------------------------------------------------------------------------
  // Eingaben
  // -------------------------------------------------------------------------

  /**
   * Ein Kaempfer beginnt zu sprechen. Oeffnet das Sprechfenster: Kommt bis zu
   * dessen Ende kein gueltiger Befehl, kostet das Ausdauer.
   * `ageMs`: wie lange der tatsaechliche Sprechbeginn schon zurueckliegt
   * (die Pegelerkennung meldet ihn erst nach ihrer Mindestdauer).
   */
  speechStart(fighter: number, ageMs = 0): void {
    const f = this.fighters[fighter];
    if (this.phase !== 'fighting' || f.state === 'ko') return;
    if (f.speechStartMs >= 0) return; // Fenster laeuft schon
    f.speechStartMs = this.timeMs - Math.max(0, ageMs);
    this.emit('SpeechStarted', { fighter });
  }

  /** Ein gueltiger Befehl wurde erkannt (Stimme, Taste oder Bot). */
  command(fighter: number, cmd: CommandId): void {
    const f = this.fighters[fighter];
    if (this.phase !== 'fighting' || f.state === 'ko') {
      this.emit('CommandRejected', { fighter, command: cmd, reason: 'notFighting' });
      return;
    }
    // Ein erkannter Befehl schliesst das Sprechfenster - auch wenn er gleich
    // an der Ausdauer scheitert. Bestraft wird Laerm ohne Befehl, nicht ein
    // Befehl, den man sich nicht leisten kann.
    this.closeSpeechWindow(f);

    if (f.state === 'idle') {
      this.tryStart(f, cmd);
      return;
    }
    if (isOwnAction(f.state) || this.config.fighter.bufferWhileIncapacitated) {
      f.bufferedCommand = cmd;
      f.bufferedAtMs = this.timeMs;
      this.emit('CommandBuffered', { fighter, command: cmd });
      return;
    }
    this.emit('CommandRejected', { fighter, command: cmd, reason: 'incapacitated' });
  }

  setDirectionalBlock(on: boolean): void {
    this.directionalBlock = on;
  }

  /** Gilt fuer alle Aktionen, die danach beginnen; laufende behalten ihre Zeit. */
  setWindupScale(scale: number): void {
    if (Number.isFinite(scale) && scale > 0) this.windupScale = scale;
  }

  // -------------------------------------------------------------------------
  // Ablauf
  // -------------------------------------------------------------------------

  /** Rueckt die Simulation um genau einen Zeitschritt vor. */
  step(): void {
    if (this.phase === 'matchOver') return;
    const dt = this.config.simulation.stepMs;
    this.timeMs += dt;
    const now = this.timeMs;

    if (this.phase === 'intro') {
      if (now >= this.phaseEndMs) {
        this.phase = 'fighting';
        this.emit('RoundStart', {});
      }
      return;
    }
    if (this.phase === 'roundOver') {
      if (now >= this.phaseEndMs) this.afterRound();
      return;
    }

    this.roundTimeMs += dt;
    const [f0, f1] = this.fighters;

    // 2. abgelaufene Zustaende beenden
    this.expireState(f0);
    this.expireState(f1);

    // 3. Einschlaege. Erst ALLE faelligen Angreifer in den Nachlauf setzen,
    //    dann aufloesen: Schlagen beide im selben Schritt ein, treffen beide,
    //    und keiner unterbricht den anderen nachtraeglich.
    const due: { attacker: FighterData; command: CommandId; impactAtMs: number }[] = [];
    for (const f of this.fighters) {
      if (f.state === 'windup' && now >= f.impactAtMs && f.command !== '') {
        due.push({ attacker: f, command: f.command, impactAtMs: f.impactAtMs });
      }
    }
    for (const d of due) this.enterRecovery(d.attacker, this.config.commands[d.command]);
    for (const d of due) {
      this.resolveImpact(d.attacker, this.fighters[1 - d.attacker.id], d.command, d.impactAtMs);
    }

    // 4. K.o. und Zeitablauf
    const dead0 = f0.health <= 0;
    const dead1 = f1.health <= 0;
    if (dead0 || dead1) {
      this.endRound(dead0 && dead1 ? -1 : dead0 ? 1 : 0, 'ko');
      return;
    }
    if (this.roundTimeMs >= this.config.match.roundTimeMs) {
      const winner = f0.health > f1.health ? 0 : f1.health > f0.health ? 1 : -1;
      this.endRound(winner, 'time');
      return;
    }

    // 5. gepufferte Befehle
    this.startBuffered(f0);
    this.startBuffered(f1);

    // 6. Ausdauer und Sprechstrafe
    this.updateStaminaAndSpeech(f0, dt);
    this.updateStaminaAndSpeech(f1, dt);
  }

  /** Rueckt um `ms` vor (abgerundet auf ganze Schritte). */
  advance(ms: number): void {
    const steps = Math.floor(ms / this.config.simulation.stepMs + EPSILON);
    for (let i = 0; i < steps; i++) this.step();
  }

  /** Liefert alle seit dem letzten Aufruf entstandenen Ereignisse. */
  drainEvents(): CombatEvent[] {
    const out = this.events;
    this.events = [];
    return out;
  }

  // -------------------------------------------------------------------------
  // Abfragen (fuer Anzeige, Bot und Tests)
  // -------------------------------------------------------------------------

  weaponOf(fighter: number): WeaponConfig {
    return this.config.weapons[this.fighters[fighter].weaponId];
  }

  /** Schaden, den `cmd` fuer diesen Kaempfer jetzt anrichten wuerde. */
  damageOf(fighter: number, cmd: CommandId): number {
    const def = this.config.commands[cmd];
    return def.damageFromWeapon ? this.weaponOf(fighter).damage : def.damage;
  }

  /** Aushol-Dauer von `cmd` fuer diesen Kaempfer in ms. */
  windupOf(fighter: number, cmd: CommandId): number {
    const def = this.config.commands[cmd];
    const factor = def.usesWeapon ? this.weaponOf(fighter).windupFactor : 1;
    return Math.round(def.windupMs * factor * this.windupScale);
  }

  /** Ausdauerkosten von `cmd` als Angriff/Rolle/Scheinangriff (nicht als Richtungsblock). */
  costOf(fighter: number, cmd: CommandId): number {
    const def = this.config.commands[cmd];
    const factor = def.usesWeapon ? this.weaponOf(fighter).staminaFactor : 1;
    return def.staminaCost * factor;
  }

  /**
   * Welche Blocklinie der Verteidiger gegen eine Angriffslinie braucht.
   * Seitenschlaege werden gespiegelt: Was der Angreifer von SEINER linken
   * Seite schlaegt, sieht der Verteidiger auf seinem Bildschirm rechts kommen.
   */
  requiredBlockLine(attackLine: Line): Line {
    if (attackLine !== 'left' && attackLine !== 'right') return 'high';
    if (!this.config.block.mirrorDirections) return attackLine;
    return attackLine === 'left' ? 'right' : 'left';
  }

  /** Was der Gegner von diesem Kaempfer sieht. Der Scheinangriff bleibt verdeckt. */
  visible(fighter: number): VisibleAction {
    const f = this.fighters[fighter];
    const feint = f.state === 'feint';
    return {
      state: feint ? 'windup' : f.state,
      command: f.shownCommand,
      kind: feint ? 'attack' : f.kind,
      line: f.line,
      actionSeq: f.actionSeq,
      startMs: f.stateStartMs,
    };
  }

  /** Wuerde ein Richtungswort dieses Kaempfers JETZT als Block gelten? */
  directionWordBlocks(fighter: number): boolean {
    if (!this.directionalBlock) return false;
    const seen = this.visible(1 - fighter);
    return seen.state === 'windup' && (seen.line === 'left' || seen.line === 'right');
  }

  /** Verbleibende Rundenzeit in ms. */
  remainingRoundMs(): number {
    return Math.max(0, this.config.match.roundTimeMs - this.roundTimeMs);
  }

  /** Fuer den Sieg noetige Runden (Best of 3 -> 2). */
  roundsToWin(): number {
    return Math.floor(this.config.match.bestOf / 2) + 1;
  }

  // -------------------------------------------------------------------------
  // Intern: Aktionen
  // -------------------------------------------------------------------------

  private createFighter(id: number): FighterData {
    return {
      id,
      health: 0,
      stamina: 0,
      durability: 0,
      weaponBroken: false,
      weaponId: this.config.activeWeapon,
      roundsWon: 0,
      state: 'idle',
      stateStartMs: 0,
      stateEndMs: NO_TIME,
      command: '',
      shownCommand: '',
      kind: '',
      actionSeq: 0,
      impactAtMs: NO_TIME,
      line: 'none',
      blockStartMs: NO_TIME,
      bufferedCommand: '',
      bufferedAtMs: NO_TIME,
      lastActionMs: 0,
      speechStartMs: NO_TIME,
    };
  }

  /** Startet `cmd`, wenn die Ausdauer reicht. */
  private tryStart(f: FighterData, cmd: CommandId): boolean {
    const now = this.timeMs;
    const own = this.config.commands[cmd];

    // Ein Richtungswort ist ein Block, wenn der Gegner gerade einen
    // Seitenschlag ausholt - sonst ein eigener Schlag.
    const asDirectionBlock =
      own.kind === 'attack' &&
      (own.line === 'left' || own.line === 'right') &&
      this.directionWordBlocks(f.id);

    const kind: ActionKind = asDirectionBlock ? 'block' : own.kind;
    // Kosten und Dauer eines Richtungsblocks sind die des Befehls `block`.
    const def: CommandConfig = asDirectionBlock ? this.config.commands.block : own;
    const weapon = this.weaponOf(f.id);
    const cost = def.staminaCost * (def.usesWeapon ? weapon.staminaFactor : 1);

    if (f.stamina + EPSILON < cost) {
      this.emit('CommandRejected', { fighter: f.id, command: cmd, reason: 'stamina', amount: cost });
      this.emit('Exhausted', { fighter: f.id, command: cmd, amount: cost });
      return false;
    }

    f.stamina = Math.max(0, f.stamina - cost);
    f.lastActionMs = now;
    f.actionSeq += 1;
    f.command = cmd;
    f.shownCommand = cmd;
    f.kind = kind;
    f.line = own.line;
    f.stateStartMs = now;
    f.impactAtMs = NO_TIME;
    f.blockStartMs = NO_TIME;

    let durationMs = 0;
    if (kind === 'attack') {
      durationMs = this.windupOf(f.id, cmd);
      f.state = 'windup';
      f.impactAtMs = now + durationMs;
      f.stateEndMs = f.impactAtMs;
    } else if (kind === 'block') {
      durationMs = def.activeMs;
      f.state = 'block';
      f.blockStartMs = now;
      f.stateEndMs = now + durationMs;
    } else if (kind === 'roll') {
      durationMs = def.activeMs;
      f.state = 'roll';
      f.stateEndMs = now + durationMs;
    } else {
      // Scheinangriff: sieht aus wie der nachgeahmte Befehl - und dauert im
      // selben Verhaeltnis laenger, wenn die Aushol-Zeiten gestreckt sind.
      durationMs = Math.round(def.activeMs * this.windupScale);
      f.state = 'feint';
      f.stateEndMs = now + durationMs;
      if (def.mimics !== '') {
        f.shownCommand = def.mimics;
        f.line = this.config.commands[def.mimics].line;
      }
    }

    // ActionStarted: fighter, target = Gegner, command (echt), shownCommand
    // (sichtbar), kind, line, durationMs = Ausholen bzw. aktive Dauer.
    this.emit('ActionStarted', {
      fighter: f.id,
      target: 1 - f.id,
      command: cmd,
      shownCommand: f.shownCommand,
      kind,
      line: f.line,
      durationMs,
    });
    return true;
  }

  private startBuffered(f: FighterData): void {
    if (f.bufferedCommand === '' || f.state !== 'idle') return;
    const cmd = f.bufferedCommand;
    const ageMs = this.timeMs - f.bufferedAtMs;
    f.bufferedCommand = '';
    f.bufferedAtMs = NO_TIME;
    if (ageMs > this.config.fighter.inputBufferMs) {
      this.emit('CommandRejected', { fighter: f.id, command: cmd, reason: 'bufferExpired' });
      return;
    }
    this.tryStart(f, cmd);
  }

  /** Die Werte der laufenden Aktion; ein Richtungsblock zaehlt als `block`. */
  private runningDef(f: FighterData): CommandConfig | null {
    if (f.command === '') return null;
    return f.kind === 'block' ? this.config.commands.block : this.config.commands[f.command];
  }

  private expireState(f: FighterData): void {
    if (f.state === 'idle' || f.state === 'ko' || f.state === 'windup') return;
    if (this.timeMs < f.stateEndMs) return;
    if (f.state === 'block' || f.state === 'roll' || f.state === 'feint') {
      const def = this.runningDef(f);
      if (def && def.recoveryMs > 0) {
        f.state = 'recovery';
        f.stateStartMs = this.timeMs;
        f.stateEndMs = this.timeMs + def.recoveryMs;
        return;
      }
    }
    this.toIdle(f);
  }

  private enterRecovery(f: FighterData, def: CommandConfig): void {
    f.impactAtMs = NO_TIME;
    if (def.recoveryMs <= 0) {
      this.toIdle(f);
      return;
    }
    f.state = 'recovery';
    f.stateStartMs = this.timeMs;
    f.stateEndMs = this.timeMs + def.recoveryMs;
  }

  private toIdle(f: FighterData): void {
    if (isOwnAction(f.state)) this.markActionEnd(f);
    f.state = 'idle';
    f.stateStartMs = this.timeMs;
    f.stateEndMs = NO_TIME;
    f.command = '';
    f.shownCommand = '';
    f.kind = '';
    f.line = 'none';
    f.impactAtMs = NO_TIME;
    f.blockStartMs = NO_TIME;
  }

  /** Versetzt den Kaempfer in Betaeubung, Laehmung, Niederwurf oder Taumeln. */
  private setControl(f: FighterData, state: FighterStateId, durationMs: number): void {
    if (isOwnAction(f.state)) this.markActionEnd(f);
    f.state = state;
    f.stateStartMs = this.timeMs;
    f.stateEndMs = this.timeMs + durationMs;
    f.command = '';
    f.shownCommand = '';
    f.kind = '';
    f.line = 'none';
    f.impactAtMs = NO_TIME;
    f.blockStartMs = NO_TIME;
    // Wer getroffen aus seiner Aktion faellt, verliert auch den Vorsatz.
    f.bufferedCommand = '';
    f.bufferedAtMs = NO_TIME;
  }

  private markActionEnd(f: FighterData): void {
    if (this.config.fighter.staminaRegenDelayFrom === 'actionEnd') f.lastActionMs = this.timeMs;
  }

  // -------------------------------------------------------------------------
  // Intern: Einschlag
  // -------------------------------------------------------------------------

  private resolveImpact(
    a: FighterData,
    d: FighterData,
    cmd: CommandId,
    impactAtMs: number,
  ): void {
    if (d.state === 'ko') return;
    const def = this.config.commands[cmd];
    const damage = this.damageOf(a.id, cmd);

    // Rolle: weicht allem aus, was nicht ausdruecklich Rollende trifft.
    if (d.state === 'roll' && !def.hitsRolling) {
      // Evaded: fighter = Ausweichender, target = Angreifer.
      this.emit('Evaded', { fighter: d.id, target: a.id, command: cmd, line: def.line });
      return;
    }

    if (d.state === 'block') {
      if (def.breaksBlock) {
        // GuardBroken: fighter = Angreifer, target = Verteidiger. Danach folgt `Hit`.
        this.emit('GuardBroken', { fighter: a.id, target: d.id, command: cmd, line: def.line });
        this.applyHit(a, d, cmd, def, damage, true);
        return;
      }

      const weapon = this.weaponOf(d.id);
      const lineOk =
        def.stoppedByAnyBlock ||
        !this.directionalBlock ||
        d.line === this.requiredBlockLine(def.line);
      const leadMs = impactAtMs - d.blockStartMs;

      if (lineOk && weapon.canParry && leadMs <= this.config.block.perfectParryWindowMs) {
        // Parried: fighter = Verteidiger, target = Angreifer, durationMs = Laehmung.
        const stunMs = this.config.block.parryStunMs;
        this.emit('Parried', {
          fighter: d.id,
          target: a.id,
          command: cmd,
          line: def.line,
          durationMs: stunMs,
        });
        this.setControl(a, 'paralyzed', stunMs);
        if (this.config.block.endsOnParry) this.toIdle(d);
        return;
      }

      const passFactor = lineOk
        ? 1 - weapon.blockValue
        : Math.max(this.config.block.wrongDirectionDamageFactor, 1 - weapon.blockValue);
      const chip = damage * passFactor;
      d.health = Math.max(0, d.health - chip);

      let wear = 0;
      if (!d.weaponBroken && (lineOk || this.config.block.wrongDirectionCostsDurability)) {
        wear = Math.min(d.durability, damage);
        d.durability -= wear;
      }
      // Blocked: fighter = Verteidiger, target = Angreifer, damage = durchgekommener
      // Schaden, amount = Haltbarkeitsverlust, flag = falsche Richtung.
      this.emit('Blocked', {
        fighter: d.id,
        target: a.id,
        command: cmd,
        line: def.line,
        damage: chip,
        amount: wear,
        flag: !lineOk,
      });
      if (!d.weaponBroken && d.durability <= EPSILON) {
        d.durability = 0;
        d.weaponBroken = true;
        d.weaponId = this.config.brokenWeapon;
        this.emit('WeaponBroken', { fighter: d.id });
      }
      return;
    }

    this.applyHit(a, d, cmd, def, damage, false);
  }

  private applyHit(
    a: FighterData,
    d: FighterData,
    cmd: CommandId,
    def: CommandConfig,
    damage: number,
    guardBroken: boolean,
  ): void {
    const wasWindingUp = d.state === 'windup' || d.state === 'feint';
    const wasRolling = d.state === 'roll';
    const interrupted = d.command;
    d.health = Math.max(0, d.health - damage);

    // Betaeubung und Niederwurf greifen nicht, solange schon ein
    // Kontrollverlust laeuft (sonst liesse sich ein Gegner am Boden halten).
    const mayControl = !isControlled(d.state) || this.config.fighter.allowControlChain;
    const mustCancel = wasWindingUp || wasRolling || guardBroken;
    let effect: HitEffect = 'none';
    let effectMs = 0;
    if (def.knockdownMs > 0 && mayControl) {
      effect = 'knockdown';
      effectMs = def.knockdownMs;
    } else if (def.stunMs > 0 && mayControl) {
      effect = 'stun';
      effectMs = def.stunMs;
    } else if (mustCancel && this.config.fighter.interruptStaggerMs > 0) {
      effect = 'stagger';
      effectMs = this.config.fighter.interruptStaggerMs;
    }

    // Hit: fighter = Angreifer, target = Getroffener, damage, effect + durationMs,
    // flag = der Getroffene war gerade in der Rolle.
    this.emit('Hit', {
      fighter: a.id,
      target: d.id,
      command: cmd,
      line: def.line,
      damage,
      effect,
      durationMs: effectMs,
      flag: wasRolling,
    });
    if (wasWindingUp) {
      // Interrupted: fighter = Unterbrochener, target = Angreifer,
      // command = die abgebrochene Aktion.
      this.emit('Interrupted', { fighter: d.id, target: a.id, command: interrupted });
    }

    if (effect === 'knockdown') this.setControl(d, 'down', effectMs);
    else if (effect === 'stun') this.setControl(d, 'stunned', effectMs);
    else if (effect === 'stagger') this.setControl(d, 'staggered', effectMs);
    else if (mustCancel) {
      this.toIdle(d);
      d.bufferedCommand = '';
      d.bufferedAtMs = NO_TIME;
    }
  }

  // -------------------------------------------------------------------------
  // Intern: Ausdauer, Sprechfenster
  // -------------------------------------------------------------------------

  private updateStaminaAndSpeech(f: FighterData, dt: number): void {
    const cfg = this.config.fighter;
    const now = this.timeMs;
    if (cfg.staminaRegenDelayFrom === 'actionEnd' && isOwnAction(f.state)) f.lastActionMs = now;
    if (now - f.lastActionMs >= cfg.staminaRegenDelayMs && f.stamina < cfg.maxStamina) {
      f.stamina = Math.min(cfg.maxStamina, f.stamina + (cfg.staminaRegenPerSecond * dt) / 1000);
    }

    if (f.speechStartMs >= 0 && now - f.speechStartMs >= this.config.speech.penaltyWindowMs) {
      const loss = Math.min(f.stamina, this.config.speech.penaltyStamina);
      f.stamina -= loss;
      f.speechStartMs = NO_TIME;
      // SpeechPenalty: fighter, amount = abgezogene Ausdauer.
      this.emit('SpeechPenalty', { fighter: f.id, amount: loss });
    }
  }

  private closeSpeechWindow(f: FighterData): void {
    if (f.speechStartMs < 0) return;
    // SpeechResolved: fighter, durationMs = Sprechbeginn bis Befehl.
    this.emit('SpeechResolved', { fighter: f.id, durationMs: this.timeMs - f.speechStartMs });
    f.speechStartMs = NO_TIME;
  }

  // -------------------------------------------------------------------------
  // Intern: Runden und Match
  // -------------------------------------------------------------------------

  private beginRound(round: number): void {
    const cfg = this.config;
    const weapon = cfg.weapons[cfg.activeWeapon];
    this.round = round;
    this.roundTimeMs = 0;
    for (const f of this.fighters) {
      f.health = cfg.fighter.maxHealth;
      f.stamina = cfg.fighter.maxStamina;
      f.durability = weapon.durability;
      f.weaponBroken = false;
      f.weaponId = cfg.activeWeapon;
      f.state = 'idle';
      f.stateStartMs = this.timeMs;
      f.stateEndMs = NO_TIME;
      f.command = '';
      f.shownCommand = '';
      f.kind = '';
      f.line = 'none';
      f.impactAtMs = NO_TIME;
      f.blockStartMs = NO_TIME;
      f.bufferedCommand = '';
      f.bufferedAtMs = NO_TIME;
      f.lastActionMs = this.timeMs - cfg.fighter.staminaRegenDelayMs;
      f.speechStartMs = NO_TIME;
    }
    this.phase = 'intro';
    this.phaseEndMs = this.timeMs + cfg.match.roundStartDelayMs;
    // RoundIntro: durationMs = Vorlauf bis zum Kampfbeginn.
    this.emit('RoundIntro', { durationMs: cfg.match.roundStartDelayMs });
  }

  private endRound(winner: number, reason: RoundEndReason): void {
    this.lastRoundWinner = winner;
    if (winner >= 0) this.fighters[winner].roundsWon += 1;
    for (const f of this.fighters) {
      f.state = f.health <= 0 ? 'ko' : 'idle';
      f.stateStartMs = this.timeMs;
      f.stateEndMs = NO_TIME;
      f.command = '';
      f.shownCommand = '';
      f.kind = '';
      f.line = 'none';
      f.impactAtMs = NO_TIME;
      f.blockStartMs = NO_TIME;
      f.bufferedCommand = '';
      f.bufferedAtMs = NO_TIME;
      f.speechStartMs = NO_TIME;
    }
    // RoundEnd: fighter = Sieger (-1 Unentschieden), target = Verlierer, reason.
    this.emit('RoundEnd', {
      fighter: winner,
      target: winner >= 0 ? 1 - winner : -1,
      reason,
    });
    this.phase = 'roundOver';
    this.phaseEndMs = this.timeMs + this.config.match.roundEndDelayMs;
  }

  private afterRound(): void {
    const need = this.roundsToWin();
    const [a, b] = this.fighters;
    let decided = false;
    let winner = -1;
    if (a.roundsWon >= need) {
      decided = true;
      winner = 0;
    } else if (b.roundsWon >= need) {
      decided = true;
      winner = 1;
    } else if (this.round >= this.config.match.bestOf) {
      // Alle Runden gespielt (nur mit unentschiedenen Runden moeglich):
      // Wer mehr Runden hat, gewinnt; sonst endet das Match unentschieden.
      decided = true;
      winner = a.roundsWon > b.roundsWon ? 0 : b.roundsWon > a.roundsWon ? 1 : -1;
    }
    if (decided) {
      this.matchWinner = winner;
      this.phase = 'matchOver';
      // MatchEnd: fighter = Sieger (-1 Unentschieden), target = Verlierer.
      this.emit('MatchEnd', { fighter: winner, target: winner >= 0 ? 1 - winner : -1 });
      return;
    }
    this.beginRound(this.round + 1);
  }

  // -------------------------------------------------------------------------
  // Intern: Ereignisse
  // -------------------------------------------------------------------------

  private emit(type: CombatEventType, fields: Partial<CombatEvent>): void {
    this.events.push({
      type,
      timeMs: this.timeMs,
      round: this.round,
      fighter: -1,
      target: -1,
      command: '',
      shownCommand: '',
      kind: '',
      line: 'none',
      damage: 0,
      durationMs: 0,
      amount: 0,
      effect: 'none',
      reason: '',
      flag: false,
      ...fields,
    });
  }
}
