// Das Spiel: verbindet Kampfsitzung, 3D-Ansicht, Anzeige, Tastatur und Stimme.
// Regeln stehen hier keine - nur wer wann was an wen weiterreicht.

import {
  COMMAND_IDS,
  CombatSession,
  type BotLevelId,
  type CombatConfig,
  type CombatEvent,
  type CommandId,
} from '../combat';
import { ArenaView, type ScreenPoint } from '../render/arenaView';
import type { FighterVisualFactory } from '../render/fighterVisual';
import { Hud } from '../ui/hud';
import { prepareDictation } from '../voice/dictationEngine';
import { VoiceController } from '../voice/voiceController';

const PLAYER = 0;
const BOT = 1;

interface PendingKey {
  command: CommandId;
  /** Simulationszeit, zu der die simulierte Sprechzeit um ist. */
  dueMs: number;
}

export class Game {
  private readonly config: CombatConfig;
  private readonly view: ArenaView;
  private readonly hud: Hud;
  private readonly voice: VoiceController;
  private readonly keyToCommand = new Map<string, CommandId>();

  private session: CombatSession;
  private started = false;
  private lastFrameMs = 0;

  // Einstellungen aus dem Debug-Feld; sie ueberdauern einen Neustart.
  private botLevel: BotLevelId;
  private directionalBlock: boolean;
  private botSpeechDelayMs: number;
  private keyboardDelayMs: number;
  private weaponId: string;
  private windupScale: number;

  /** Der letzte sichtbare Angriff des Bots, auf den der Spieler noch nicht geantwortet hat. */
  private botAttack: { startMs: number; impactMs: number } | null = null;
  /** Die letzten Abwehrzeiten (ms ab Ausholbeginn des Gegners). */
  private readonly defenseDelays: number[] = [];

  private readonly pendingKeys: PendingKey[] = [];
  /** Sprechbeginn (performance.now) des letzten Sprachbefehls, der noch auf seine Aktion wartet. */
  private voiceSpeechStartMs = -1;
  private readonly point: ScreenPoint = { x: 0, y: 0, visible: false };

  constructor(host: HTMLElement, sceneHost: HTMLElement, config: CombatConfig, factory?: FighterVisualFactory) {
    this.config = config;
    this.botLevel = config.bot.defaultLevel;
    this.directionalBlock = config.block.directionalBlock;
    this.botSpeechDelayMs = config.bot.speechDelayMs;
    this.keyboardDelayMs = config.input.keyboardDelayMs;
    this.weaponId = config.activeWeapon;
    this.windupScale = config.tempo.windupScale;
    // Die Diktierfunktion muss beim Klick schon bereitstehen (siehe dictationEngine.ts).
    if (config.voice.engine === 'dictation') prepareDictation();
    for (const id of COMMAND_IDS) this.keyToCommand.set(config.commands[id].key, id);

    this.view = new ArenaView(sceneHost, factory);
    this.hud = new Hud(host, config, {
      onStartVoice: () => void this.startWithVoice(),
      onStartKeyboard: () => this.begin(),
      onCommand: (command) => this.playerInput(command),
      onRestart: () => this.restart(),
      onDirectionalBlock: (on) => {
        this.directionalBlock = on;
        this.session.sim.setDirectionalBlock(on);
      },
      onBotLevel: (level) => {
        this.botLevel = level;
        this.session.bots[BOT]?.setLevel(level);
        this.hud.setBotName(level);
      },
      onBotSpeechDelay: (ms) => {
        this.botSpeechDelayMs = ms;
        const bot = this.session.bots[BOT];
        if (bot) bot.speechDelayMs = ms;
      },
      onKeyboardDelay: (ms) => {
        this.keyboardDelayMs = ms;
      },
      onOverview: (on) => this.view.setOverview(on),
      onCrowd: (on) => this.view.setCrowdVisible(on),
      onWindupScale: (scale) => {
        this.windupScale = scale;
        this.session.sim.setWindupScale(scale);
      },
      onVoiceEngine: (engine) => void this.switchVoice(engine),
      onVoiceOn: () => void this.switchVoice(this.preferredEngine()),
      onRecalibrate: () => this.voice.recalibrate(),
      onWeapon: (weaponId) => {
        this.weaponId = weaponId;
        this.restart();
      },
    });
    this.hud.setBotName(this.botLevel);

    this.voice = new VoiceController(config, {
      onState: (state, detail) => {
        this.hud.setVoiceState(state, detail);
        if (!this.started) this.hud.setStartStatus(detail, state === 'error');
      },
      onLevel: (rms, threshold, speaking) => this.hud.setLevel(rms, threshold, speaking),
      onSpeechStart: (ageMs) => {
        if (this.started) this.session.speechStart(PLAYER, ageMs);
      },
      onCommand: (result) => {
        this.hud.setRecognized(result.word, result.confidence, result.latencyMs);
        if (!this.started) return;
        this.voiceSpeechStartMs = result.speechStartMs;
        this.session.command(PLAYER, result.command);
      },
      onNoCommand: (heard, reason) => {
        this.hud.setHeard(heard);
        if (reason === 'lowConfidence') this.hud.showToast(`Zu unsicher erkannt: „${heard}“`);
      },
      onHearing: (text) => this.hud.setHearing(text),
      onConfidence: (confidence) => this.hud.setConfidence(confidence),
    });

    this.session = this.createSession();

    window.addEventListener('resize', () => this.view.resize());
    window.addEventListener('keydown', (event) => this.onKeyDown(event));
    requestAnimationFrame((t) => this.loop(t));
  }

  // -------------------------------------------------------------------------
  // Start, Neustart
  // -------------------------------------------------------------------------

  private createSession(): CombatSession {
    // Startwert aus der Uhr: jeder Kampf anders, in sich aber wiederholbar.
    const seed = (Date.now() & 0x7fffffff) || 1;
    // Die gewaehlte Waffe gilt fuer beide Kaempfer.
    const config = this.weaponId === this.config.activeWeapon ? this.config : { ...this.config, activeWeapon: this.weaponId };
    const session = new CombatSession(config, { seed, bots: [null, this.botLevel] });
    session.sim.setDirectionalBlock(this.directionalBlock);
    session.sim.setWindupScale(this.windupScale);
    const bot = session.bots[BOT];
    if (bot) bot.speechDelayMs = this.botSpeechDelayMs;
    return session;
  }

  private begin(): void {
    this.hud.hideStart();
    this.restart();
    this.started = true;
    // Vom Blick auf die ganze Arena hinter den eigenen Kaempfer.
    this.view.setOverview(false);
    this.hud.setOverview(false);
  }

  private restart(): void {
    this.pendingKeys.length = 0;
    this.voiceSpeechStartMs = -1;
    this.botAttack = null;
    this.session = this.createSession();
    this.hud.hideResult();
    // Die Ereignisse des Vorlaufs (Runde 1) gleich anzeigen.
    this.dispatch(this.session.sim.drainEvents());
  }

  private async startWithVoice(): Promise<void> {
    this.hud.setStartBusy(true);
    try {
      // Kein `await` vor diesem Aufruf: Die Diktierfunktion startet nur im Klick.
      await this.voice.start(this.preferredEngine());
      this.hud.setEngine(this.voice.engineId ?? 'off');
      this.begin();
      this.announceFallback();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.hud.setStartStatus(`${message} Du kannst mit der Tastatur starten.`, true);
    } finally {
      this.hud.setStartBusy(false);
    }
  }

  private preferredEngine(): CombatConfig['voice']['engine'] {
    return this.config.voice.engine === 'off' ? 'auto' : this.config.voice.engine;
  }

  private async switchVoice(engine: CombatConfig['voice']['engine']): Promise<void> {
    if (engine === 'off') {
      this.voice.stop();
      return;
    }
    try {
      await this.voice.start(engine);
      this.hud.setEngine(this.voice.engineId ?? 'off');
      this.announceFallback();
    } catch {
      // Die Meldung steht schon im Sprachfeld (onState).
      this.hud.setEngine('off');
    }
  }

  /** Sagt offen, wenn statt Vosk der Ersatz laeuft - der ist nicht lokal. */
  private announceFallback(): void {
    if (this.voice.engineId !== 'webspeech' || this.voice.fallbackReason === '') return;
    this.hud.showToast(`Vosk läuft nicht: ${this.voice.fallbackReason} Ersatz: Web Speech API.`, 9000);
  }

  // -------------------------------------------------------------------------
  // Eingabe
  // -------------------------------------------------------------------------

  private onKeyDown(event: KeyboardEvent): void {
    if (event.repeat || event.ctrlKey || event.metaKey || event.altKey) return;
    const target = event.target;
    if (target instanceof HTMLInputElement || target instanceof HTMLSelectElement) return;

    if (event.code === 'Enter' && this.started && this.session.sim.phase === 'matchOver') {
      this.restart();
      return;
    }
    const command = this.keyToCommand.get(event.code);
    if (!command || !this.started) return;
    event.preventDefault();
    this.playerInput(command);
  }

  /** Ein Befehl von Hand: Taste oder Fingertipp auf die Befehlsliste. */
  private playerInput(command: CommandId): void {
    if (!this.started) return;
    if (this.keyboardDelayMs <= 0) {
      this.hud.setRecognized(this.config.commands[command].word, -1, 0, true);
      this.voiceSpeechStartMs = -1;
      this.session.command(PLAYER, command);
      return;
    }
    // Simulierte Sprechzeit: "!" sofort, der Befehl erst danach. Wie beim
    // Sprechen geht nur ein Wort nach dem anderen.
    const sim = this.session.sim;
    const last = this.pendingKeys[this.pendingKeys.length - 1];
    const startMs = last ? Math.max(sim.timeMs, last.dueMs) : sim.timeMs;
    this.pendingKeys.push({ command, dueMs: startMs + this.keyboardDelayMs });
    this.session.speechStart(PLAYER);
  }

  private flushPendingKeys(): void {
    const sim = this.session.sim;
    while (this.pendingKeys.length > 0 && sim.timeMs >= this.pendingKeys[0].dueMs) {
      const key = this.pendingKeys.shift();
      if (!key) break;
      this.hud.setRecognized(this.config.commands[key.command].word, -1, this.keyboardDelayMs, true);
      this.voiceSpeechStartMs = -1;
      this.session.command(PLAYER, key.command);
      // Das naechste wartende Wort beginnt jetzt.
      if (this.pendingKeys.length > 0) this.session.speechStart(PLAYER);
    }
    if (sim.phase !== 'fighting') this.pendingKeys.length = 0;
  }

  // -------------------------------------------------------------------------
  // Schleife
  // -------------------------------------------------------------------------

  private loop(nowMs: number): void {
    const elapsedMs = this.lastFrameMs === 0 ? 0 : nowMs - this.lastFrameMs;
    this.lastFrameMs = nowMs;

    if (this.started) {
      this.flushPendingKeys();
      this.dispatch(this.session.advance(elapsedMs, this.config.simulation.maxCatchUpMs));
    }

    const sim = this.session.sim;
    this.hud.update(sim, nowMs);
    this.view.frame(sim, this.session.displayTimeMs, Math.min(elapsedMs, 100) / 1000);
    for (let i = 0; i < 2; i++) {
      this.view.headScreenPosition(i, this.point);
      this.hud.placeWarn(i, this.point.x, this.point.y);
    }

    requestAnimationFrame((t) => this.loop(t));
  }

  private dispatch(events: CombatEvent[]): void {
    if (events.length === 0) return;
    const nowMs = performance.now();
    for (const e of events) {
      this.trackDefense(e);
      if (e.fighter !== PLAYER) continue;
      // Verzoegerung "Sprechbeginn bis Aktion": erst hier steht sie fest,
      // denn ein gepufferter Befehl startet spaeter als er erkannt wurde.
      if (e.type === 'ActionStarted' && this.voiceSpeechStartMs >= 0) {
        this.hud.setLatency(nowMs - this.voiceSpeechStartMs);
        this.voiceSpeechStartMs = -1;
      } else if (e.type === 'CommandRejected') {
        this.voiceSpeechStartMs = -1;
      }
    }
    this.view.handleEvents(events);
    this.hud.handleEvents(events, this.session.sim, nowMs);
  }

  /**
   * Misst, wie lange der Spieler vom Ausholbeginn des Bots bis zur eigenen
   * Abwehr braucht - Reaktion, Sprechen und Erkennung zusammen. Gemessen in
   * Simulationszeit, also unabhaengig davon, wie die Befehle hereinkommen.
   */
  private trackDefense(e: CombatEvent): void {
    if (e.type !== 'ActionStarted') return;
    const sim = this.session.sim;
    if (e.fighter === BOT && (e.kind === 'attack' || e.kind === 'feint')) {
      // Beim Scheinangriff zaehlt, was man sieht: der Einschlag, der zu erwarten waere.
      const windupMs = e.kind === 'attack' || e.shownCommand === '' ? e.durationMs : sim.windupOf(BOT, e.shownCommand);
      this.botAttack = { startMs: e.timeMs, impactMs: e.timeMs + windupMs };
      return;
    }
    if (e.fighter !== PLAYER || (e.kind !== 'block' && e.kind !== 'roll') || !this.botAttack) return;
    const attack = this.botAttack;
    this.botAttack = null;
    const delayMs = e.timeMs - attack.startMs;
    // Eine Abwehr lange nach dem Angriff gehoert nicht mehr zu ihm.
    if (delayMs > sim.config.speech.penaltyWindowMs * 3) return;
    this.defenseDelays.push(delayMs);
    if (this.defenseDelays.length > 5) this.defenseDelays.shift();
    const mean = this.defenseDelays.reduce((a, b) => a + b, 0) / this.defenseDelays.length;
    this.hud.setDefense(delayMs, attack.impactMs - e.timeMs, mean);
  }
}
