// Spracherkennung mit Vosk, vollstaendig lokal im Browser (WebAssembly im
// Web Worker). Das Modell wird einmal geladen und von vosk-browser im
// Browser-Speicher (IndexedDB) behalten.
//
// Zwei Dinge machen Vosk fuers Spiel tauglich (am 19.11.2026 nachgemessen):
//  - Die Grammatik enthaelt nur die Befehlswoerter plus "[unk]". Alles andere
//    kann der Erkenner gar nicht ausgeben.
//  - Von sich aus liefert Vosk das Endergebnis erst nach rund 1,1-1,4 s
//    (es wartet auf eine lange Pause). Deshalb fordert die Pegelerkennung es
//    beim Sprechende ueber `endOfSpeech` sofort an: 0,34-0,77 s ab Sprechbeginn.

import type { VoiceConfig } from '../combat';
import type { EngineResult, RecognizedWord, SpeechEngine } from './types';

// Typen von vosk-browser, so weit sie hier gebraucht werden.
interface VoskRecognizer {
  on(event: 'result' | 'partialresult' | 'error', listener: (message: VoskMessage) => void): void;
  setWords(words: boolean): void;
  acceptWaveformFloat(buffer: Float32Array, sampleRate: number): void;
  retrieveFinalResult(): void;
  remove(): void;
}
interface VoskModel {
  KaldiRecognizer: new (sampleRate: number, grammar?: string) => VoskRecognizer;
  on(event: 'error' | 'load', listener: (message: { error?: string }) => void): void;
  terminate(): void;
}
interface VoskMessage {
  event: string;
  error?: string;
  result?: {
    text?: string;
    partial?: string;
    result?: { conf: number; word: string }[];
  };
}
interface VoskModule {
  createModel(modelUrl: string, logLevel?: number): Promise<VoskModel>;
}

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(message));
      },
    );
  });
}

export class VoskEngine implements SpeechEngine {
  readonly id = 'vosk' as const;
  readonly label = 'Vosk (lokal)';
  readonly needsAudio = true;
  readonly commitsOnPartial = false;

  onResult: ((result: EngineResult) => void) | null = null;
  onFailure: ((message: string) => void) | null = null;

  private readonly cfg: VoiceConfig['vosk'];
  private model: VoskModel | null = null;
  private recognizer: VoskRecognizer | null = null;
  private utterance = 0;
  private pending: Float32Array[] = [];
  private pendingSamples = 0;

  constructor(cfg: VoiceConfig['vosk']) {
    this.cfg = cfg;
  }

  async start(vocabulary: readonly string[], sampleRate: number): Promise<void> {
    // Der Worker von vosk-browser entsteht aus einem Blob; relative Adressen
    // kann er nicht aufloesen.
    const modelUrl = new URL(this.cfg.modelUrl, document.baseURI).href;

    // Vorab pruefen, ob die Modelldatei da ist. Der Entwicklungsserver
    // beantwortet unbekannte Pfade sonst mit der Startseite (Status 200),
    // und der Worker scheitert erst nach langem Warten am Entpacken.
    let head: Response;
    try {
      head = await fetch(modelUrl, { method: 'HEAD', headers: { Accept: 'application/gzip' } });
    } catch {
      throw new Error(`Das Sprachmodell ist nicht erreichbar (${this.cfg.modelUrl}).`);
    }
    const type = head.headers.get('content-type') ?? '';
    if (!head.ok || type.includes('text/html')) {
      throw new Error(
        `Das Sprachmodell fehlt (${this.cfg.modelUrl}). Einmal "npm run modell" ausführen.`,
      );
    }

    const imported = (await import('vosk-browser')) as unknown as VoskModule & { default?: VoskModule };
    const vosk: VoskModule = typeof imported.createModel === 'function' ? imported : (imported.default as VoskModule);
    if (!vosk || typeof vosk.createModel !== 'function') {
      throw new Error('vosk-browser ließ sich nicht laden.');
    }

    // Protokollstufe -1: nur Warnungen und Fehler des Erkenners.
    this.model = await withTimeout(
      vosk.createModel(modelUrl, -1),
      this.cfg.loadTimeoutMs,
      'Das Sprachmodell ließ sich nicht laden.',
    );
    this.model.on('error', (message) => {
      this.onFailure?.(message.error ?? 'Fehler im Sprachmodell.');
    });

    const grammar = JSON.stringify([...vocabulary, '[unk]']);
    const recognizer = new this.model.KaldiRecognizer(sampleRate, grammar);
    recognizer.setWords(true);
    recognizer.on('partialresult', (message) => {
      const text = (message.result?.partial ?? '').trim().toLowerCase();
      if (text !== '') this.onResult?.({ text, words: [], final: false, utterance: this.utterance });
    });
    recognizer.on('result', (message) => {
      const text = (message.result?.text ?? '').trim().toLowerCase();
      const words: RecognizedWord[] = (message.result?.result ?? []).map((w) => ({
        word: w.word.toLowerCase(),
        confidence: w.conf,
      }));
      const utterance = this.utterance;
      this.utterance += 1;
      // Auch ein leeres Endergebnis melden: Es schliesst die Aeusserung ab.
      this.onResult?.({ text, words, final: true, utterance });
    });
    recognizer.on('error', (message) => {
      this.onFailure?.(message.error ?? 'Fehler im Erkenner.');
    });
    this.recognizer = recognizer;
  }

  feed(samples: Float32Array, sampleRate: number): void {
    if (!this.recognizer) return;
    // Zu Bloecken von `feedMs` buendeln: weniger Nachrichten an den Worker.
    this.pending.push(samples);
    this.pendingSamples += samples.length;
    if ((this.pendingSamples / sampleRate) * 1000 < this.cfg.feedMs) return;
    this.flush(sampleRate);
  }

  endOfSpeech(): void {
    if (!this.recognizer) return;
    this.recognizer.retrieveFinalResult();
  }

  stop(): void {
    this.recognizer?.remove();
    this.recognizer = null;
    this.model?.terminate();
    this.model = null;
    this.pending = [];
    this.pendingSamples = 0;
  }

  private flush(sampleRate: number): void {
    if (!this.recognizer || this.pendingSamples === 0) return;
    const block = new Float32Array(this.pendingSamples);
    let offset = 0;
    for (const part of this.pending) {
      block.set(part, offset);
      offset += part.length;
    }
    this.pending = [];
    this.pendingSamples = 0;
    try {
      this.recognizer.acceptWaveformFloat(block, sampleRate);
    } catch (error) {
      this.onFailure?.(error instanceof Error ? error.message : String(error));
    }
  }
}
