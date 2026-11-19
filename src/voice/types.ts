// Gemeinsame Schnittstelle der Spracherkennung.
//
// Dahinter stecken zwei Umsetzungen: Vosk (laeuft lokal im Browser) und die
// Web Speech API des Browsers als Ersatz. Das Spiel kennt nur `SpeechEngine`.

export interface RecognizedWord {
  word: string;
  /** 0..1, oder -1, wenn die Engine keine Angabe macht. */
  confidence: number;
}

export interface EngineResult {
  /** Erkannter Text, klein geschrieben. */
  text: string;
  /** Einzelwoerter mit Sicherheit; leer, wenn die Engine nur Text liefert. */
  words: RecognizedWord[];
  /** Endergebnis einer Aeusserung (true) oder vorlaeufig (false). */
  final: boolean;
  /** Laufende Nummer der Aeusserung; gleiche Nummer = dieselbe Aeusserung. */
  utterance: number;
}

export type EngineId = 'vosk' | 'webspeech' | 'dictation';

export interface SpeechEngine {
  readonly id: EngineId;
  /** Anzeigename. */
  readonly label: string;
  /** true: Die Engine will das Mikrofonsignal ueber `feed` bekommen. */
  readonly needsAudio: boolean;
  /**
   * true: Endergebnisse kommen zu spaet fuers Spiel; Befehle werden schon aus
   * vorlaeufigen Ergebnissen genommen.
   */
  readonly commitsOnPartial: boolean;
  /**
   * true: Die Seite oeffnet selbst ein Mikrofon und erkennt den Sprechbeginn
   * am Pegel. false: Die Engine liefert nur Text (Diktierfunktion); der
   * Sprechbeginn ist dann der erste Text.
   */
  readonly usesPageMicrophone: boolean;

  /** Laedt, was noetig ist, und beginnt zuzuhoeren. Wirft bei Fehlschlag. */
  start(vocabulary: readonly string[], sampleRate: number): Promise<void>;
  /** Mikrofonsignal, Werte -1..1. */
  feed(samples: Float32Array, sampleRate: number): void;
  /** Die Pegelerkennung meldet Sprechende: bitte sofort ein Endergebnis. */
  endOfSpeech(): void;
  stop(): void;

  onResult: ((result: EngineResult) => void) | null;
  /** Fehler im laufenden Betrieb, nach dem die Engine nichts mehr liefert. */
  onFailure: ((message: string) => void) | null;
}

export type VoiceState = 'off' | 'starting' | 'calibrating' | 'loading' | 'listening' | 'error';
