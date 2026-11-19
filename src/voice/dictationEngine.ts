// Spracherkennung ueber die Diktierfunktion von claude.ai.
//
// Nur fuer die auf claude.ai veroeffentlichte Seite: Dort bekommt die Seite
// kein Mikrofonsignal. Die Plattform haelt das Mikrofon selbst, wandelt das
// Gesprochene in Text und reicht der Seite nur die Woerter (dictation.d.ts,
// Laufzeitvertrag 0.2.96).
//
// Folgen fuers Spiel, die man kennen muss:
//  - Kein Pegel, also keine Sprechbeginn-Erkennung. Das "!" erscheint erst mit
//    dem ersten Text und damit spaeter als lokal mit Vosk.
//  - Freier Text statt Grammatik: Befehle werden aus dem Text herausgesucht,
//    die Ersatzwoerter (commands.*.aliases) fangen andere Schreibweisen ab.
//  - Der Ton geht an den Dienst von Anthropic: nicht lokal.
//  - `start()` muss noch im Klick des Nutzers aufgerufen werden, ohne dass
//    vorher etwas abgewartet wurde. Deshalb wird die Funktion beim Laden der
//    Seite vorbereitet (`prepareDictation`) und hier nur noch aufgerufen.

import type { EngineResult, SpeechEngine } from './types';

type Unsubscribe = () => void;
type DictationState = 'idle' | 'starting' | 'listening' | 'finishing';

interface DictationNamespace {
  start(options?: { language?: string }): Promise<void>;
  stop(): Promise<void>;
  active(): boolean;
  onPartial(handler: (e: { text: string }) => void): Unsubscribe;
  onFinal(handler: (e: { text: string }) => void): Unsubscribe;
  onState(handler: (e: { state: DictationState; reason?: string }) => void): Unsubscribe;
}

interface ClaudeHost {
  use(name: 'dictation'): Promise<DictationNamespace | null>;
}

/** undefined = noch nicht geantwortet, null = hier nicht verfuegbar. */
let namespace: DictationNamespace | null | undefined;
/** Der Start in der gewuenschten Sprache wurde abgelehnt: naechstes Mal ohne. */
let languageRefused = false;

/** Beim Laden der Seite aufrufen: holt die Diktierfunktion, damit sie beim Klick bereitsteht. */
export function prepareDictation(): void {
  if (namespace !== undefined) return;
  const host = (window as unknown as { claude?: ClaudeHost }).claude;
  if (!host || typeof host.use !== 'function') {
    namespace = null;
    return;
  }
  host.use('dictation').then(
    (value) => {
      namespace = value ?? null;
    },
    () => {
      namespace = null;
    },
  );
}

const END_REASONS: Record<string, string> = {
  viewer_stopped: 'Zuhören beendet – du hast es gestoppt.',
  hidden: 'Zuhören beendet, weil die Seite verdeckt war.',
  time_limit: 'Zuhören nach 60 Minuten beendet.',
  not_granted: 'Die Diktierfunktion ist für diese Seite nicht erlaubt oder der Browser sperrt das Mikrofon.',
  dismissed: 'Die Nachfrage wurde ohne Antwort geschlossen.',
  unavailable: 'Die Diktierfunktion steht für dieses Konto oder diese Sprache nicht bereit.',
  rate_limited: 'Zu viele Diktate gleichzeitig – gleich noch einmal versuchen.',
  upstream_error: 'Das Mikrofon oder der Sprachdienst ist ausgefallen.',
  no_gesture: 'Der Start muss direkt aus einem Klick kommen – bitte noch einmal klicken.',
  stopped: 'Zuhören beendet.',
};

function reasonText(code: string | undefined): string {
  return END_REASONS[code ?? ''] ?? END_REASONS.upstream_error;
}

export class DictationEngine implements SpeechEngine {
  readonly id = 'dictation' as const;
  readonly label = 'Diktierfunktion von claude.ai (nicht lokal)';
  readonly needsAudio = false;
  readonly commitsOnPartial = true;
  readonly usesPageMicrophone = false;

  onResult: ((result: EngineResult) => void) | null = null;
  onFailure: ((message: string) => void) | null = null;

  private readonly language: string;
  private dictation: DictationNamespace | null = null;
  private unsubscribe: Unsubscribe[] = [];
  private utterance = 0;
  private listening = false;
  private stopping = false;

  constructor(language: string) {
    this.language = language;
  }

  /** Kein `async` und kein `await` vor `dictation.start()`: Der Aufruf muss im Klick bleiben. */
  start(): Promise<void> {
    if (namespace === undefined) {
      return Promise.reject(
        new Error('Die Diktierfunktion wird noch geladen – bitte in ein paar Sekunden noch einmal klicken.'),
      );
    }
    if (namespace === null) {
      return Promise.reject(
        new Error(
          'Die Diktierfunktion von claude.ai gibt es in dieser Ansicht nicht. Sie läuft nur in Chrome oder Edge am Rechner und im Hauptfenster der Desktop-App.',
        ),
      );
    }
    const d = namespace;
    this.dictation = d;
    this.stopping = false;

    this.unsubscribe = [
      d.onPartial((e) => {
        const text = e.text.trim().toLowerCase();
        if (text !== '') this.onResult?.({ text, words: [], final: false, utterance: this.utterance });
      }),
      d.onFinal((e) => {
        const text = e.text.trim().toLowerCase();
        const utterance = this.utterance;
        this.utterance += 1;
        this.onResult?.({ text, words: [], final: true, utterance });
      }),
      d.onState((e) => {
        if (e.state === 'listening') {
          this.listening = true;
        } else if (e.state === 'idle' && this.listening && !this.stopping) {
          // Von aussen beendet: Stop-Knopf der Plattform, verdeckte Seite, Zeitgrenze.
          this.listening = false;
          this.onFailure?.(reasonText(e.reason));
        }
      }),
    ];

    const withLanguage = !languageRefused && this.language !== '';
    return d.start(withLanguage ? { language: this.language } : undefined).then(
      () => {
        this.listening = true;
      },
      (error: unknown) => {
        const code = (error as { code?: string } | null)?.code;
        this.release();
        if (code === 'unavailable' && withLanguage) {
          languageRefused = true;
          throw new Error(
            `Die Diktierfunktion bietet „${this.language}“ nicht an. Noch einmal klicken – dann startet sie in deiner eigenen Sprache.`,
          );
        }
        throw new Error(reasonText(code));
      },
    );
  }

  feed(): void {
    // Die Plattform hoert selbst zu.
  }

  endOfSpeech(): void {
    // Kein Gegenstueck: Es gibt hier keine Pegelerkennung.
  }

  stop(): void {
    this.stopping = true;
    const d = this.dictation;
    this.release();
    if (d && d.active()) void d.stop().catch(() => undefined);
  }

  private release(): void {
    for (const off of this.unsubscribe) off();
    this.unsubscribe = [];
    this.dictation = null;
    this.listening = false;
  }
}
