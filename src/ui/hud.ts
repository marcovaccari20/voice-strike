// Die Anzeige ueber der 3D-Ansicht: Balken, Rundenzeit, Einblendungen,
// Sprachfeld, Befehlsliste, Debug-Feld, Start- und Schlussbild.
// Reines DOM; die Elemente entstehen hier, index.html bleibt leer.

import {
  BOT_LEVEL_IDS,
  COMMAND_IDS,
  type BotLevelId,
  type CombatConfig,
  type CombatEvent,
  type CombatSim,
  type CommandId,
} from '../combat';
import type { EngineId, VoiceState } from '../voice/types';

const PLAYER = 0;
const BOT = 1;
/** So lange bleibt das Warnzeichen mindestens stehen (ms). Nur Lesbarkeit. */
const WARN_MIN_MS = 260;
const TOAST_MS = 1700;

export interface HudCallbacks {
  onStartVoice(): void;
  onStartKeyboard(): void;
  onRestart(): void;
  onDirectionalBlock(on: boolean): void;
  onBotLevel(level: BotLevelId): void;
  onBotSpeechDelay(ms: number): void;
  onKeyboardDelay(ms: number): void;
  onVoiceEngine(engine: EngineId | 'off'): void;
  onRecalibrate(): void;
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className = '',
  text = '',
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

function keyLabel(code: string): string {
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  return code;
}

interface BarRefs {
  row: HTMLElement;
  fill: HTMLElement;
  value: HTMLElement;
  last: string;
}

interface FighterRefs {
  name: HTMLElement;
  pips: HTMLElement[];
  health: BarRefs;
  stamina: BarRefs;
  weapon: BarRefs;
}

export class Hud {
  private readonly config: CombatConfig;
  private readonly callbacks: HudCallbacks;
  private readonly root: HTMLElement;

  private readonly fighters: [FighterRefs, FighterRefs];
  private readonly roundLabel: HTMLElement;
  private readonly timer: HTMLElement;
  private readonly warns: [HTMLElement, HTMLElement];
  private readonly warnShownAt = [0, 0];
  private readonly warnHideAt = [-1, -1];

  private readonly announce: HTMLElement;
  private readonly announceMain: HTMLElement;
  private readonly announceSub: HTMLElement;
  private readonly toast: HTMLElement;
  private toastTimer = 0;

  private readonly voiceWord: HTMLElement;
  private readonly voiceConfidence: HTMLElement;
  private readonly voiceLatency: HTMLElement;
  private readonly voiceStatus: HTMLElement;
  private readonly meterFill: HTMLElement;
  private readonly meterMark: HTMLElement;
  private meterPeak = 0;

  private readonly commandRows = new Map<CommandId, HTMLElement>();
  private readonly commandLabels = new Map<CommandId, HTMLElement>();
  private directionAsBlock = false;

  private readonly startOverlay: HTMLElement;
  private readonly startStatus: HTMLElement;
  private readonly startButtons: HTMLButtonElement[] = [];
  private readonly resultOverlay: HTMLElement;
  private readonly resultTitle: HTMLElement;
  private readonly resultText: HTMLElement;

  private readonly engineSelect: HTMLSelectElement;
  private lastTimer = '';
  private lastRound = '';

  constructor(host: HTMLElement, config: CombatConfig, callbacks: HudCallbacks) {
    this.config = config;
    this.callbacks = callbacks;
    this.root = el('div', 'hud');
    host.appendChild(this.root);

    // --- oben: zwei Kaempfer, dazwischen die Uhr ---------------------------
    const top = el('div', 'topbar');
    const left = this.buildFighter('player', 'Du');
    const clock = el('div', 'panel clock');
    this.roundLabel = el('div', 'clock-round', 'Runde 1');
    this.timer = el('div', 'clock-time', '');
    clock.append(this.roundLabel, this.timer);
    const right = this.buildFighter('bot right', 'Bot');
    top.append(left.node, clock, right.node);
    this.root.appendChild(top);
    this.fighters = [left.refs, right.refs];

    // --- Warnzeichen ---------------------------------------------------------
    this.warns = [el('div', 'warn'), el('div', 'warn')];
    this.root.append(this.warns[0], this.warns[1]);

    // --- Einblendungen -----------------------------------------------------
    this.announce = el('div', 'announce');
    this.announceMain = el('div', 'announce-main');
    this.announceSub = el('div', 'announce-sub');
    this.announce.append(this.announceMain, this.announceSub);
    this.root.appendChild(this.announce);
    this.toast = el('div', 'toast');
    this.root.appendChild(this.toast);

    // --- Sprachfeld ----------------------------------------------------------
    const voice = el('div', 'panel voice');
    voice.appendChild(el('div', 'panel-title', 'Sprache'));
    const word = el('div', 'kv');
    word.appendChild(el('span', '', 'Erkanntes Wort'));
    this.voiceWord = el('span', 'voice-word', '–');
    word.appendChild(this.voiceWord);
    const conf = el('div', 'kv');
    conf.appendChild(el('span', '', 'Sicherheit'));
    this.voiceConfidence = el('span', '', '–');
    conf.appendChild(this.voiceConfidence);
    const lat = el('div', 'kv');
    lat.appendChild(el('span', '', 'Verzögerung'));
    this.voiceLatency = el('span', '', '–');
    lat.appendChild(this.voiceLatency);
    const level = el('div', 'kv');
    level.appendChild(el('span', '', 'Mikrofonpegel'));
    level.appendChild(el('span', '', ''));
    const meter = el('div', 'meter');
    this.meterFill = el('div', 'meter-fill');
    this.meterMark = el('div', 'meter-mark');
    meter.append(this.meterFill, this.meterMark);
    this.voiceStatus = el('div', 'voice-status', 'Mikrofon aus – Tastatur aktiv');
    voice.append(word, conf, lat, level, meter, this.voiceStatus);
    this.root.appendChild(voice);

    // --- Befehlsliste --------------------------------------------------------
    const commands = el('div', 'panel commands');
    commands.appendChild(el('div', 'panel-title', 'Befehle (Wort · Taste · Ausdauer)'));
    for (const id of COMMAND_IDS) {
      const def = config.commands[id];
      const row = el('div', 'cmd');
      row.appendChild(el('span', 'cmd-key', keyLabel(def.key)));
      row.appendChild(el('span', 'cmd-word', def.word));
      const label = el('span', 'cmd-label', def.label);
      row.appendChild(label);
      row.appendChild(el('span', 'cmd-cost', String(def.staminaCost)));
      commands.appendChild(row);
      this.commandRows.set(id, row);
      this.commandLabels.set(id, label);
    }
    this.root.appendChild(commands);

    // --- Debug-Feld ----------------------------------------------------------
    this.engineSelect = el('select');
    this.root.appendChild(this.buildDebug());

    // --- Startbild -----------------------------------------------------------
    this.startOverlay = el('div', 'overlay');
    const start = el('div', 'panel start');
    start.appendChild(el('h1', '', 'VOICE ARENA'));
    start.appendChild(
      el('p', '', 'Kämpfe per Stimme gegen einen Bot. Sprich eines der Befehlswörter (Englisch) – oder nimm zum Testen die Tastatur.'),
    );
    const list = el('ul');
    for (const text of [
      'Best of 3, eine Runde dauert höchstens 90 Sekunden.',
      'Sobald jemand zu sprechen beginnt, erscheint über ihm ein rotes „!“ – noch bevor das Wort erkannt ist.',
      'Block: „block“ gegen den Schlag von oben. Gegen Seitenschläge die Seite sagen, auf der du den Schlag auf dem Bildschirm kommen siehst.',
      'Wer spricht, ohne dass ein Befehl erkannt wird, verliert Ausdauer.',
      'Beim Start mit Mikrofon wird 2 Sekunden lang der Umgebungslärm gemessen: bitte kurz still sein. Kopfhörer sind nicht nötig, das Spiel gibt keinen Ton aus.',
    ]) {
      list.appendChild(el('li', '', text));
    }
    start.appendChild(list);
    const buttons = el('div', 'buttons');
    const voiceButton = el('button', 'primary', 'Mit Mikrofon starten');
    voiceButton.addEventListener('click', () => callbacks.onStartVoice());
    const keyButton = el('button', '', 'Nur mit Tastatur starten');
    keyButton.addEventListener('click', () => callbacks.onStartKeyboard());
    buttons.append(voiceButton, keyButton);
    this.startButtons.push(voiceButton, keyButton);
    start.appendChild(buttons);
    this.startStatus = el('div', 'start-status');
    start.appendChild(this.startStatus);
    this.startOverlay.appendChild(start);
    host.appendChild(this.startOverlay);

    // --- Schlussbild ---------------------------------------------------------
    this.resultOverlay = el('div', 'overlay hidden');
    const result = el('div', 'panel start');
    this.resultTitle = el('h1', 'result-title');
    this.resultText = el('p');
    const again = el('button', 'primary', 'Neustart (Enter)');
    again.addEventListener('click', () => callbacks.onRestart());
    const resultButtons = el('div', 'buttons');
    resultButtons.appendChild(again);
    result.append(this.resultTitle, this.resultText, resultButtons);
    this.resultOverlay.appendChild(result);
    host.appendChild(this.resultOverlay);
  }

  // -------------------------------------------------------------------------
  // Start und Ende
  // -------------------------------------------------------------------------

  setStartStatus(text: string, error = false): void {
    this.startStatus.textContent = text;
    this.startStatus.classList.toggle('error', error);
  }

  setStartBusy(busy: boolean): void {
    for (const b of this.startButtons) b.disabled = busy;
  }

  hideStart(): void {
    this.startOverlay.classList.add('hidden');
  }

  hideResult(): void {
    this.resultOverlay.classList.add('hidden');
  }

  setBotName(level: BotLevelId): void {
    this.fighters[BOT].name.textContent = `Bot (${this.config.bot.levels[level].label})`;
  }

  // -------------------------------------------------------------------------
  // Je Bild
  // -------------------------------------------------------------------------

  update(sim: CombatSim, nowMs: number): void {
    const cfg = this.config;
    for (let i = 0; i < 2; i++) {
      const f = sim.fighters[i];
      const refs = this.fighters[i];
      this.setBar(refs.health, f.health / cfg.fighter.maxHealth, String(Math.ceil(f.health)));
      this.setBar(refs.stamina, f.stamina / cfg.fighter.maxStamina, String(Math.floor(f.stamina + 1e-6)));
      const maxDurability = cfg.weapons[cfg.activeWeapon].durability;
      this.setBar(
        refs.weapon,
        maxDurability > 0 ? f.durability / maxDurability : 0,
        f.weaponBroken ? 'Faust' : String(Math.ceil(f.durability)),
      );
      refs.weapon.row.classList.toggle('broken', f.weaponBroken);
      for (let p = 0; p < refs.pips.length; p++) refs.pips[p].classList.toggle('won', p < f.roundsWon);
    }

    const seconds = String(Math.ceil(sim.remainingRoundMs() / 1000));
    if (seconds !== this.lastTimer) {
      this.lastTimer = seconds;
      this.timer.textContent = seconds;
      this.timer.classList.toggle('low', sim.remainingRoundMs() <= 10000);
    }
    const round = `Runde ${sim.round}`;
    if (round !== this.lastRound) {
      this.lastRound = round;
      this.roundLabel.textContent = round;
    }

    // Befehlsliste: was gerade zu teuer ist und ob left/right jetzt blocken.
    const me = sim.fighters[PLAYER];
    const asBlock = sim.directionWordBlocks(PLAYER);
    for (const id of COMMAND_IDS) {
      const def = cfg.commands[id];
      const isDirection = def.kind === 'attack' && (def.line === 'left' || def.line === 'right');
      const cost = isDirection && asBlock ? sim.costOf(PLAYER, 'block') : sim.costOf(PLAYER, id);
      this.commandRows.get(id)?.classList.toggle('unaffordable', me.stamina + 1e-6 < cost);
    }
    if (asBlock !== this.directionAsBlock) {
      this.directionAsBlock = asBlock;
      for (const id of COMMAND_IDS) {
        const def = cfg.commands[id];
        if (def.kind !== 'attack' || (def.line !== 'left' && def.line !== 'right')) continue;
        const label = this.commandLabels.get(id);
        if (label) label.textContent = asBlock ? `JETZT: Block ${def.line === 'left' ? 'links' : 'rechts'}` : def.label;
        this.commandRows.get(id)?.classList.toggle('as-block', asBlock);
      }
    }

    // Warnzeichen nach der Mindestdauer ausblenden.
    for (let i = 0; i < 2; i++) {
      if (this.warnHideAt[i] >= 0 && nowMs >= this.warnHideAt[i]) {
        this.warnHideAt[i] = -1;
        this.warns[i].classList.remove('on');
      }
    }
  }

  /** Warnzeichen ueber den Kopf setzen (Bildschirmkoordinaten). */
  placeWarn(fighter: number, x: number, y: number): void {
    this.warns[fighter].style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
  }

  // -------------------------------------------------------------------------
  // Ereignisse
  // -------------------------------------------------------------------------

  handleEvents(events: readonly CombatEvent[], sim: CombatSim, nowMs: number): void {
    for (const e of events) {
      switch (e.type) {
        case 'SpeechStarted':
          this.warns[e.fighter].classList.add('on');
          this.warnShownAt[e.fighter] = nowMs;
          this.warnHideAt[e.fighter] = -1;
          break;
        case 'SpeechResolved':
          this.hideWarn(e.fighter, nowMs);
          break;
        case 'SpeechPenalty':
          this.hideWarn(e.fighter, nowMs);
          if (e.fighter === PLAYER) {
            this.showToast(`Kein Befehl erkannt: −${Math.round(e.amount)} Ausdauer`);
          }
          break;
        case 'ActionStarted':
          if (e.fighter === PLAYER && e.command !== '') this.pulse(e.command, 'fired');
          break;
        case 'CommandRejected':
          if (e.fighter === PLAYER && e.command !== '') {
            this.pulse(e.command, 'rejected');
            const word = this.config.commands[e.command].word;
            if (e.reason === 'stamina') this.showToast(`„${word}“ abgelehnt – zu wenig Ausdauer`);
            else if (e.reason === 'incapacitated') this.showToast(`„${word}“ abgelehnt – du kannst gerade nicht handeln`);
            else if (e.reason === 'bufferExpired') this.showToast(`„${word}“ verfallen – zu früh gesprochen`);
          }
          break;
        case 'Exhausted':
          if (e.fighter === PLAYER) this.flash('ERSCHÖPFT!', 'Zu wenig Ausdauer', 'bad');
          break;
        case 'Parried':
          if (e.fighter === PLAYER) this.flash('PARIERT!', 'Der Gegner ist gelähmt', 'gold');
          else this.flash('PARIERT!', 'Du bist gelähmt', 'bad');
          break;
        case 'GuardBroken':
          if (e.fighter === PLAYER) this.flash('BLOCK GEBROCHEN!', 'Du durchbrichst die Deckung', 'good');
          else this.flash('BLOCK GEBROCHEN!', 'Deine Deckung ist durchbrochen', 'bad');
          break;
        case 'WeaponBroken':
          if (e.fighter === PLAYER) this.flash('WAFFE ZERBROCHEN!', 'Du kämpfst mit den Fäusten', 'bad');
          else this.flash('WAFFE ZERBROCHEN!', 'Der Gegner kämpft mit den Fäusten', 'good');
          break;
        case 'RoundIntro':
          this.hideResult();
          for (const w of this.warns) w.classList.remove('on');
          this.flash(`RUNDE ${e.round}`, 'Mach dich bereit', '', e.durationMs);
          break;
        case 'RoundStart':
          this.flash('KAMPF!', '', 'gold');
          break;
        case 'RoundEnd': {
          for (const w of this.warns) w.classList.remove('on');
          const why = e.reason === 'time' ? 'Zeit abgelaufen' : 'K.o.';
          if (e.fighter === PLAYER) this.flash('RUNDE AN DICH', why, 'good', this.config.match.roundEndDelayMs);
          else if (e.fighter === BOT) this.flash('RUNDE AN DEN BOT', why, 'bad', this.config.match.roundEndDelayMs);
          else this.flash('UNENTSCHIEDEN', why, '', this.config.match.roundEndDelayMs);
          break;
        }
        case 'MatchEnd': {
          const a = sim.fighters[PLAYER].roundsWon;
          const b = sim.fighters[BOT].roundsWon;
          this.resultTitle.className = `result-title ${e.fighter === PLAYER ? 'good' : e.fighter === BOT ? 'bad' : ''}`;
          this.resultTitle.textContent =
            e.fighter === PLAYER ? 'SIEG' : e.fighter === BOT ? 'NIEDERLAGE' : 'UNENTSCHIEDEN';
          this.resultText.textContent = `Endstand ${a} : ${b} nach ${sim.round} Runden.`;
          this.resultOverlay.classList.remove('hidden');
          break;
        }
        default:
          break;
      }
    }
  }

  // -------------------------------------------------------------------------
  // Sprachfeld
  // -------------------------------------------------------------------------

  /** `byKey`: Der Befehl kam von der Tastatur, eine Sicherheit gibt es dann nicht. */
  setRecognized(word: string, confidence: number, latencyMs: number, byKey = false): void {
    this.voiceWord.textContent = word;
    this.voiceConfidence.textContent = byKey
      ? 'Taste'
      : confidence >= 0
        ? `${Math.round(confidence * 100)} %`
        : 'keine Angabe';
    this.setLatency(latencyMs);
  }

  setLatency(latencyMs: number): void {
    this.voiceLatency.textContent = latencyMs >= 0 ? `${Math.round(latencyMs)} ms` : '–';
  }

  setHeard(text: string): void {
    this.voiceWord.textContent = text === '' ? '–' : `(${text})`;
    this.voiceConfidence.textContent = '–';
  }

  setVoiceState(state: VoiceState, detail: string): void {
    const text: Record<VoiceState, string> = {
      off: 'Mikrofon aus – Tastatur aktiv',
      starting: detail,
      calibrating: detail,
      loading: detail,
      listening: `Hört zu · ${detail}`,
      error: `Sprache aus: ${detail}`,
    };
    this.voiceStatus.textContent = text[state];
    this.voiceStatus.classList.toggle('error', state === 'error');
  }

  setEngine(engine: EngineId | 'off'): void {
    this.engineSelect.value = engine;
  }

  /** Pegel und Schwelle; die Anzeige ist wurzelskaliert, damit leise Pegel sichtbar bleiben. */
  setLevel(rms: number, threshold: number, speaking: boolean): void {
    const scale = (v: number) => Math.min(1, Math.sqrt(Math.max(0, v)) * 1.6);
    this.meterPeak = Math.max(scale(rms), this.meterPeak * 0.85);
    this.meterFill.style.width = `${(this.meterPeak * 100).toFixed(1)}%`;
    this.meterFill.classList.toggle('speaking', speaking);
    this.meterMark.style.left = `${(scale(threshold) * 100).toFixed(1)}%`;
  }

  showToast(text: string, durationMs = TOAST_MS): void {
    this.toast.textContent = text;
    this.toast.classList.add('show');
    window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => this.toast.classList.remove('show'), durationMs);
  }

  // -------------------------------------------------------------------------

  private hideWarn(fighter: number, nowMs: number): void {
    if (fighter < 0) return;
    this.warnHideAt[fighter] = Math.max(nowMs, this.warnShownAt[fighter] + WARN_MIN_MS);
  }

  private pulse(command: CommandId, className: 'fired' | 'rejected'): void {
    const row = this.commandRows.get(command);
    if (!row) return;
    row.classList.remove('fired', 'rejected');
    // Neu ansetzen, damit die Animation auch bei Wiederholung laeuft.
    void row.offsetWidth;
    row.classList.add(className);
  }

  /** Grosse Einblendung. `holdMs` > 0: bleibt so lange stehen. */
  private flash(main: string, sub: string, tone: '' | 'gold' | 'good' | 'bad', holdMs = 0): void {
    this.announceMain.textContent = main;
    this.announceSub.textContent = sub;
    this.announce.className = `announce ${tone}`;
    void this.announce.offsetWidth;
    if (holdMs > 0) {
      this.announce.classList.add('hold');
      window.setTimeout(() => {
        if (this.announceMain.textContent === main) this.announce.classList.remove('hold');
      }, holdMs);
    } else {
      this.announce.classList.add('show');
    }
  }

  private setBar(bar: BarRefs, fraction: number, text: string): void {
    const width = `${(Math.max(0, Math.min(1, fraction)) * 100).toFixed(1)}%`;
    const key = `${width}|${text}`;
    if (key === bar.last) return;
    bar.last = key;
    bar.fill.style.width = width;
    bar.value.textContent = text;
  }

  private buildFighter(className: string, name: string): { node: HTMLElement; refs: FighterRefs } {
    const node = el('section', `panel fighter ${className}`);
    const head = el('div', 'fighter-head');
    const nameNode = el('span', 'fighter-name', name);
    const pipsNode = el('div', 'pips');
    pipsNode.title = 'Gewonnene Runden';
    const need = Math.floor(this.config.match.bestOf / 2) + 1;
    const pips: HTMLElement[] = [];
    for (let i = 0; i < need; i++) {
      const pip = el('span', 'pip');
      pips.push(pip);
      pipsNode.appendChild(pip);
    }
    head.append(nameNode, pipsNode);
    node.appendChild(head);
    const bar = (label: string, kind: string): BarRefs => {
      const row = el('div', 'bar-row');
      row.appendChild(el('span', '', label));
      const track = el('div', 'bar');
      const fill = el('div', `bar-fill ${kind}`);
      track.appendChild(fill);
      row.appendChild(track);
      const value = el('span', 'bar-value', '');
      row.appendChild(value);
      node.appendChild(row);
      return { row, fill, value, last: '' };
    };
    const refs: FighterRefs = {
      name: nameNode,
      pips,
      health: bar('Leben', 'health'),
      stamina: bar('Ausdauer', 'stamina'),
      weapon: bar('Waffe', 'weapon'),
    };
    return { node, refs };
  }

  private buildDebug(): HTMLElement {
    const cfg = this.config;
    const cb = this.callbacks;
    const panel = el('div', 'panel debug');
    const toggle = el('button', 'debug-toggle');
    toggle.append(el('span', '', 'Debug'), el('span', '', '▾'));
    toggle.addEventListener('click', () => {
      panel.classList.toggle('collapsed');
      toggle.blur();
    });
    panel.appendChild(toggle);
    const body = el('div', 'debug-body');

    // Richtungsblock
    const dirLabel = el('label', 'check');
    const dir = el('input');
    dir.type = 'checkbox';
    dir.checked = cfg.block.directionalBlock;
    dir.addEventListener('change', () => {
      cb.onDirectionalBlock(dir.checked);
      // Fokus abgeben, sonst schluckt das Kaestchen die Kampftasten.
      dir.blur();
    });
    dirLabel.append(dir, el('span', '', 'Richtungsblock'));
    body.appendChild(dirLabel);

    // Bot-Stufe
    const levelLabel = el('label');
    levelLabel.appendChild(el('span', '', 'Bot-Stufe'));
    const level = el('select');
    for (const id of BOT_LEVEL_IDS) {
      const option = el('option', '', cfg.bot.levels[id].label);
      option.value = id;
      level.appendChild(option);
    }
    level.value = cfg.bot.defaultLevel;
    level.addEventListener('change', () => {
      cb.onBotLevel(level.value as BotLevelId);
      level.blur();
    });
    levelLabel.appendChild(level);
    body.appendChild(levelLabel);

    // Simulierte Verzoegerungen
    const slider = (
      title: string,
      value: number,
      onChange: (ms: number) => void,
    ): HTMLElement => {
      const label = el('label');
      const head = el('span', '', `${title}: `);
      const shown = el('span', 'debug-value', `${value} ms`);
      head.appendChild(shown);
      const input = el('input');
      input.type = 'range';
      input.min = '0';
      input.max = '1000';
      input.step = '10';
      input.value = String(value);
      input.addEventListener('input', () => {
        const ms = Number(input.value);
        shown.textContent = `${ms} ms`;
        onChange(ms);
      });
      input.addEventListener('change', () => input.blur());
      label.append(head, input);
      return label;
    };
    body.appendChild(slider('Bot: simulierte Sprechzeit', cfg.bot.speechDelayMs, cb.onBotSpeechDelay));
    body.appendChild(slider('Tastatur: simulierte Sprechzeit', cfg.input.keyboardDelayMs, cb.onKeyboardDelay));

    // Spracherkennung
    const engineLabel = el('label');
    engineLabel.appendChild(el('span', '', 'Spracherkennung'));
    for (const [value, text] of [
      ['off', 'aus (nur Tastatur)'],
      ['vosk', 'Vosk (lokal)'],
      ['webspeech', 'Web Speech API (nicht lokal)'],
    ] as const) {
      const option = el('option', '', text);
      option.value = value;
      this.engineSelect.appendChild(option);
    }
    this.engineSelect.value = 'off';
    this.engineSelect.addEventListener('change', () => {
      cb.onVoiceEngine(this.engineSelect.value as EngineId | 'off');
      this.engineSelect.blur();
    });
    engineLabel.appendChild(this.engineSelect);
    body.appendChild(engineLabel);

    const row = el('div', 'row');
    const recal = el('button', '', 'Lärm neu messen');
    recal.addEventListener('click', () => {
      cb.onRecalibrate();
      recal.blur();
    });
    const restart = el('button', '', 'Neustart');
    restart.addEventListener('click', () => {
      cb.onRestart();
      restart.blur();
    });
    row.append(recal, restart);
    body.appendChild(row);

    panel.appendChild(body);
    return panel;
  }
}
