// Verbindet Mikrofon, Pegelerkennung und Spracherkennung und meldet dem Spiel
// genau zwei Dinge: "der Spieler beginnt zu sprechen" und "dieser Befehl wurde
// erkannt". Dazu Anzeige-Werte (Pegel, Wort, Sicherheit, Verzoegerung).

import { COMMAND_IDS, type CombatConfig, type CommandId } from '../combat';
import { MicInput } from './micInput';
import type { EngineId, EngineResult, SpeechEngine, VoiceState } from './types';
import { VoiceActivityDetector } from './vad';
import { VoskEngine } from './voskEngine';
import { WebSpeechEngine, webSpeechAvailable } from './webSpeechEngine';

export interface RecognizedCommand {
  command: CommandId;
  word: string;
  /** 0..1 oder -1, wenn unbekannt. */
  confidence: number;
  /** ms vom Sprechbeginn bis zur Erkennung; -1, wenn kein Sprechbeginn zugeordnet ist. */
  latencyMs: number;
  /** Zeitpunkt des zugehoerigen Sprechbeginns (performance.now), -1 wenn unbekannt. */
  speechStartMs: number;
}

export interface VoiceCallbacks {
  onState(state: VoiceState, detail: string): void;
  /** Pegel je Rahmen: Effektivwert, Schwelle, spricht gerade. */
  onLevel(rms: number, threshold: number, speaking: boolean): void;
  /** Sprechbeginn erkannt; `ageMs` = wie lange er schon zurueckliegt. */
  onSpeechStart(ageMs: number): void;
  onCommand(result: RecognizedCommand): void;
  /** Es wurde gesprochen, aber kein gueltiger Befehl erkannt. */
  onNoCommand(heard: string, reason: 'unknown' | 'lowConfidence'): void;
  /** Vorlaeufig Gehoertes (nur Anzeige). */
  onHearing(text: string): void;
}

const CALIBRATING_TEXT = 'Umgebungslärm wird gemessen – bitte kurz still sein …';

interface Phrase {
  command: CommandId;
  tokens: string[];
}

interface Found {
  command: CommandId;
  word: string;
  confidence: number;
}

export class VoiceController {
  state: VoiceState = 'off';
  engineId: EngineId | null = null;
  engineLabel = '';
  /** Warum die bevorzugte Erkennung nicht lief und auf den Ersatz gewechselt wurde ('' = kein Wechsel). */
  fallbackReason = '';

  private readonly config: CombatConfig;
  private readonly callbacks: VoiceCallbacks;
  private readonly mic = new MicInput();
  private readonly vad: VoiceActivityDetector;
  private readonly phrases: Phrase[];
  private engine: SpeechEngine | null = null;

  /** Beginn der letzten Aeusserung (performance.now), -1 wenn keine offen. */
  private speechStartMs = -1;
  /** Je Aeusserung der Engine: wie viele Befehle schon gemeldet wurden. */
  private consumedUtterance = -1;
  private consumedCount = 0;
  /** In der laufenden Aeusserung der Engine wurde ein Befehl gemeldet. */
  private utteranceHadCommand = false;
  /** Stabilitaetspruefung fuer vorlaeufige Ergebnisse. */
  private partialText = '';
  private partialSinceMs = 0;

  constructor(config: CombatConfig, callbacks: VoiceCallbacks) {
    this.config = config;
    this.callbacks = callbacks;
    this.vad = new VoiceActivityDetector(config.voice.vad);
    // Laengere Wortfolgen zuerst, damit "shield up" vor "up" greift.
    this.phrases = COMMAND_IDS.map((command) => ({
      command,
      tokens: config.commands[command].word.split(/\s+/).filter((t) => t !== ''),
    })).sort((a, b) => b.tokens.length - a.tokens.length);
  }

  get threshold(): number {
    return this.vad.threshold;
  }

  get noise(): number {
    return this.vad.noise;
  }

  /** Mikrofon oeffnen, Laerm messen, Erkennung laden. */
  async start(preferred: CombatConfig['voice']['engine']): Promise<void> {
    this.stop();
    if (preferred === 'off') return;

    this.setState('starting', 'Mikrofon wird geöffnet …');
    try {
      await this.mic.start(this.config.voice.mic, this.config.voice.vad.frameMs);
    } catch (error) {
      this.fail(error);
      throw error;
    }
    this.mic.onFrame = (samples, rms, endMs, frameMs) => this.handleFrame(samples, rms, endMs, frameMs);

    // Laerm messen und Erkennung laden laufen gleichzeitig.
    this.setState('calibrating', CALIBRATING_TEXT);
    const calibrated = new Promise<void>((resolve) => {
      this.onCalibrated = () => {
        // Die Messung ist durch, das Modell laedt noch.
        if (!this.engine) this.setState('loading', this.loadingText);
        resolve();
      };
    });
    this.vad.startCalibration(performance.now());

    try {
      await this.startEngine(preferred);
    } catch (error) {
      this.mic.stop();
      this.fail(error);
      throw error;
    }
    await calibrated;
    this.setState('listening', this.engineLabel);
  }

  /** Umgebungslaerm neu messen (Debug-Feld). */
  recalibrate(): void {
    if (!this.mic.running) return;
    this.setState('calibrating', CALIBRATING_TEXT);
    this.onCalibrated = () => this.setState('listening', this.engineLabel);
    this.vad.startCalibration(performance.now());
  }

  stop(): void {
    this.engine?.stop();
    this.engine = null;
    this.engineId = null;
    this.mic.onFrame = null;
    this.mic.stop();
    this.speechStartMs = -1;
    if (this.state !== 'off') this.setState('off', '');
  }

  // -------------------------------------------------------------------------

  private onCalibrated: (() => void) | null = null;
  private loadingText = '';

  private async startEngine(preferred: CombatConfig['voice']['engine']): Promise<void> {
    const vocabulary = this.phrases.map((p) => p.tokens.join(' '));
    const order: EngineId[] =
      preferred === 'webspeech' ? ['webspeech'] : preferred === 'vosk' ? ['vosk'] : ['vosk', 'webspeech'];
    let lastError: unknown = new Error('Keine Spracherkennung verfügbar.');
    this.fallbackReason = '';

    for (const id of order) {
      if (id === 'webspeech' && !webSpeechAvailable()) {
        lastError = new Error(
          `${lastError instanceof Error ? lastError.message : ''} Die Web Speech API gibt es in diesem Browser nicht.`.trim(),
        );
        continue;
      }
      const engine: SpeechEngine =
        id === 'vosk' ? new VoskEngine(this.config.voice.vosk) : new WebSpeechEngine(this.config.voice.language);
      this.loadingText =
        id === 'vosk' ? 'Sprachmodell wird geladen (beim ersten Mal rund 40 MB) …' : 'Web Speech API wird gestartet …';
      if (!this.vad.calibrating) this.setState('loading', this.loadingText);
      try {
        await engine.start(vocabulary, this.mic.sampleRate);
      } catch (error) {
        engine.stop();
        lastError = error;
        // Fuer die Anzeige merken, falls gleich der Ersatz einspringt.
        this.fallbackReason = error instanceof Error ? error.message : String(error);
        continue;
      }
      engine.onResult = (result) => this.handleResult(result);
      engine.onFailure = (message) => {
        this.stop();
        this.setState('error', message);
      };
      this.engine = engine;
      this.engineId = engine.id;
      this.engineLabel = engine.label;
      return;
    }
    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  }

  private handleFrame(samples: Float32Array, rms: number, endMs: number, frameMs: number): void {
    const event = this.vad.push(rms, endMs, frameMs);
    this.callbacks.onLevel(rms, this.vad.threshold, this.vad.speaking);

    if (event) {
      if (event.type === 'calibrated') {
        const done = this.onCalibrated;
        this.onCalibrated = null;
        done?.();
      } else if (event.type === 'speechStart' && this.state === 'listening') {
        this.speechStartMs = event.startMs;
        this.callbacks.onSpeechStart(Math.max(0, endMs - event.startMs));
      } else if (event.type === 'speechEnd') {
        // Sofort ein Endergebnis verlangen statt auf Vosks lange Pause zu warten.
        this.engine?.endOfSpeech();
      }
    }

    if (this.engine?.needsAudio) this.engine.feed(samples, this.mic.sampleRate);
  }

  private handleResult(result: EngineResult): void {
    if (this.state !== 'listening') return;
    const now = performance.now();
    if (result.utterance !== this.consumedUtterance) {
      this.consumedUtterance = result.utterance;
      this.consumedCount = 0;
      this.utteranceHadCommand = false;
      this.partialText = '';
    }

    const found = this.findCommands(result);
    const usePartial = this.config.voice.commit === 'partial' || (this.engine?.commitsOnPartial ?? false);

    if (!result.final) {
      this.callbacks.onHearing(result.text);
      if (!usePartial) return;
      // Erst handeln, wenn sich das vorlaeufige Ergebnis nicht mehr aendert.
      const signature = found.map((f) => f.command).join(' ');
      if (signature !== this.partialText) {
        this.partialText = signature;
        this.partialSinceMs = now;
      }
      if (now - this.partialSinceMs < this.config.voice.partialStableMs) return;
      this.emitNew(found, now, false);
      return;
    }

    this.emitNew(found, now, true);
    if (!this.utteranceHadCommand && result.text !== '') {
      // Etwas gehoert, aber kein Befehl daraus geworden: unbekanntes Wort
      // oder ein Befehlswort unter der Mindestsicherheit.
      const tooUnsure = found.length > 0;
      // "[unk]" ist Vosks Platzhalter fuer alles ausserhalb der Grammatik.
      const heard = result.text.replace(/\[unk\]/g, ' ').replace(/\s+/g, ' ').trim() || 'unbekannt';
      this.callbacks.onNoCommand(heard, tooUnsure ? 'lowConfidence' : 'unknown');
    }
  }

  /** Meldet alle Befehle der Aeusserung, die noch nicht gemeldet wurden. */
  private emitNew(found: Found[], now: number, final: boolean): void {
    for (let i = this.consumedCount; i < found.length; i++) {
      const f = found[i];
      // Unsichere Treffer verwerfen - aber nur, wo die Engine eine Sicherheit nennt.
      if (final && f.confidence >= 0 && f.confidence < this.config.voice.minConfidence) continue;
      const hasSpeech = this.speechStartMs >= 0;
      this.callbacks.onCommand({
        command: f.command,
        word: f.word,
        confidence: f.confidence,
        latencyMs: hasSpeech ? Math.max(0, now - this.speechStartMs) : -1,
        speechStartMs: this.speechStartMs,
      });
      this.utteranceHadCommand = true;
    }
    this.consumedCount = Math.max(this.consumedCount, found.length);
  }

  /** Sucht die Befehlswoerter in der Reihenfolge, in der sie gesprochen wurden. */
  private findCommands(result: EngineResult): Found[] {
    const tokens = result.text
      .replace(/\[unk\]/g, ' ')
      .replace(/[^a-z0-9äöüß' ]+/g, ' ')
      .split(/\s+/)
      .filter((t) => t !== '');
    // Sicherheit je Wort nur, wenn die Wortliste zum Text passt.
    const aligned = result.words.filter((w) => w.word !== '[unk]');
    const hasConfidence = aligned.length === tokens.length;

    const found: Found[] = [];
    let i = 0;
    while (i < tokens.length) {
      let matched = false;
      for (const phrase of this.phrases) {
        const n = phrase.tokens.length;
        if (n === 0 || i + n > tokens.length) continue;
        let same = true;
        for (let k = 0; k < n; k++) {
          if (tokens[i + k] !== phrase.tokens[k]) {
            same = false;
            break;
          }
        }
        if (!same) continue;
        let confidence = -1;
        if (hasConfidence) {
          confidence = 1;
          for (let k = 0; k < n; k++) confidence = Math.min(confidence, aligned[i + k].confidence);
        }
        found.push({ command: phrase.command, word: phrase.tokens.join(' '), confidence });
        i += n;
        matched = true;
        break;
      }
      if (!matched) i += 1;
    }
    return found;
  }

  private setState(state: VoiceState, detail: string): void {
    this.state = state;
    this.callbacks.onState(state, detail);
  }

  private fail(error: unknown): void {
    this.setState('error', error instanceof Error ? error.message : String(error));
  }
}
