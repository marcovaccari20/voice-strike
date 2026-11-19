// Ersatz-Erkennung ueber die Web Speech API des Browsers.
//
// Unterschiede zu Vosk, die man kennen muss:
//  - In Chrome und Edge geht der Ton dafuer an einen Dienst des Herstellers;
//    das ist NICHT lokal und braucht Internet.
//  - Es gibt keine Grammatik. Der Browser liefert beliebigen Text, aus dem
//    die Befehlswoerter herausgesucht werden.
//  - Endergebnisse brauchen oft ueber eine Sekunde. Befehle werden deshalb
//    schon aus vorlaeufigen Ergebnissen genommen (`commitsOnPartial`), und
//    eine Sicherheit gibt es dazu meist keine.

import type { EngineResult, SpeechEngine } from './types';

// Die Typen der Web Speech API fehlen in den DOM-Typen von TypeScript.
interface SpeechAlternative {
  transcript: string;
  confidence: number;
}
interface SpeechResult {
  readonly length: number;
  readonly isFinal: boolean;
  [index: number]: SpeechAlternative;
}
interface SpeechResultEvent extends Event {
  readonly resultIndex: number;
  readonly results: { readonly length: number; [index: number]: SpeechResult };
}
interface SpeechErrorEvent extends Event {
  readonly error: string;
}
interface Recognition extends EventTarget {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((event: SpeechResultEvent) => void) | null;
  onerror: ((event: SpeechErrorEvent) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}
type RecognitionCtor = new () => Recognition;

function recognitionCtor(): RecognitionCtor | null {
  const w = window as unknown as {
    SpeechRecognition?: RecognitionCtor;
    webkitSpeechRecognition?: RecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function webSpeechAvailable(): boolean {
  return recognitionCtor() !== null;
}

export class WebSpeechEngine implements SpeechEngine {
  readonly id = 'webspeech' as const;
  readonly label = 'Web Speech API (Dienst des Browsers, nicht lokal)';
  readonly needsAudio = false;
  readonly commitsOnPartial = true;

  onResult: ((result: EngineResult) => void) | null = null;
  onFailure: ((message: string) => void) | null = null;

  private readonly language: string;
  private recognition: Recognition | null = null;
  private running = false;
  /** Zaehlt Neustarts, damit Aeusserungen eindeutig bleiben. */
  private session = 0;

  constructor(language: string) {
    this.language = language;
  }

  start(): Promise<void> {
    const Ctor = recognitionCtor();
    if (!Ctor) return Promise.reject(new Error('Dieser Browser kennt die Web Speech API nicht.'));

    return new Promise<void>((resolve, reject) => {
      let settled = false;
      const rec = new Ctor();
      rec.lang = this.language;
      rec.continuous = true;
      rec.interimResults = true;
      rec.maxAlternatives = 1;

      rec.onresult = (event) => {
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const result = event.results[i];
          const best = result[0];
          if (!best) continue;
          const confidence = result.isFinal && best.confidence > 0 ? best.confidence : -1;
          const text = best.transcript.trim().toLowerCase();
          this.onResult?.({
            text,
            words: text === '' ? [] : text.split(/\s+/).map((word) => ({ word, confidence })),
            final: result.isFinal,
            utterance: this.session * 100000 + i,
          });
        }
      };
      rec.onerror = (event) => {
        // "no-speech" und "aborted" gehoeren zum Betrieb; danach folgt `onend`.
        if (event.error === 'no-speech' || event.error === 'aborted') return;
        const fatal =
          event.error === 'not-allowed' ||
          event.error === 'service-not-allowed' ||
          event.error === 'audio-capture' ||
          event.error === 'language-not-supported' ||
          event.error === 'network';
        if (!fatal) return;
        this.running = false;
        const message = `Web Speech API: ${event.error}`;
        if (!settled) {
          settled = true;
          reject(new Error(message));
        } else {
          this.onFailure?.(message);
        }
      };
      rec.onend = () => {
        // Der Browser beendet die Erkennung von selbst nach einer Weile.
        if (!this.running) return;
        this.session += 1;
        try {
          rec.start();
        } catch {
          this.running = false;
          this.onFailure?.('Web Speech API: Neustart fehlgeschlagen.');
        }
      };

      this.recognition = rec;
      this.running = true;
      try {
        rec.start();
      } catch (error) {
        this.running = false;
        reject(error instanceof Error ? error : new Error(String(error)));
        return;
      }
      // Ein Start ohne sofortigen Fehler gilt als gelungen.
      setTimeout(() => {
        if (!settled) {
          settled = true;
          resolve();
        }
      }, 600);
    });
  }

  feed(): void {
    // Der Browser hoert selbst zu.
  }

  endOfSpeech(): void {
    // Kein Gegenstueck: Die Web Speech API bestimmt ihr Endergebnis selbst.
  }

  stop(): void {
    this.running = false;
    if (this.recognition) {
      this.recognition.onend = null;
      this.recognition.onresult = null;
      this.recognition.onerror = null;
      try {
        this.recognition.abort();
      } catch {
        // schon beendet
      }
      this.recognition = null;
    }
  }
}
