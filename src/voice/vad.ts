// Sprechbeginn-Erkennung ueber den Mikrofonpegel.
//
// 1. Kalibrierung: `calibrationMs` lang den Umgebungslaerm messen und daraus
//    die Schwelle ableiten (Laermpegel x thresholdFactor, begrenzt).
// 2. Sprechbeginn: Der Pegel liegt `minSpeechMs` lang ueber der Schwelle
//    (kurze Luecken bis `maxGapMs` zaehlen nicht als Abbruch).
// 3. Sprechende: `endSilenceMs` lang unter Schwelle x releaseFactor.
//
// Reine Rechnung ohne Browser-Aufrufe: bekommt je Rahmen einen Pegel und eine
// Zeit, liefert Ereignisse.

import type { VoiceConfig } from '../combat';

export type VadEvent =
  | { type: 'calibrated'; noise: number; threshold: number; tooLoud: boolean }
  | { type: 'speechStart'; startMs: number }
  | { type: 'speechEnd'; startMs: number; endMs: number; forced: boolean };

type Phase = 'idle' | 'calibrating' | 'candidate' | 'speech' | 'cooldown';

export class VoiceActivityDetector {
  /** Aktuelle Schwelle (Effektivwert, 0..1). */
  threshold: number;
  /** Gemessener Umgebungslaerm. */
  noise = 0;
  calibrated = false;

  private readonly cfg: VoiceConfig['vad'];
  private phase: Phase = 'idle';
  private samples: number[] = [];
  private calibrationEndMs = 0;
  private candidateStartMs = 0;
  private loudMs = 0;
  private gapMs = 0;
  private speechStartMs = 0;
  private silenceMs = 0;

  constructor(cfg: VoiceConfig['vad']) {
    this.cfg = cfg;
    this.threshold = cfg.minThreshold;
  }

  get speaking(): boolean {
    return this.phase === 'speech';
  }

  get calibrating(): boolean {
    return this.phase === 'calibrating';
  }

  /** Beginnt die Messung des Umgebungslaerms ab `nowMs`. */
  startCalibration(nowMs: number): void {
    this.phase = 'calibrating';
    this.samples = [];
    this.calibrationEndMs = nowMs + this.cfg.calibrationMs;
    this.calibrated = false;
  }

  /**
   * Ein Rahmen von `frameMs` Dauer mit Effektivwert `rms`, der bei `endMs`
   * endet. Liefert hoechstens ein Ereignis.
   */
  push(rms: number, endMs: number, frameMs: number): VadEvent | null {
    const startMs = endMs - frameMs;

    switch (this.phase) {
      case 'calibrating': {
        this.samples.push(rms);
        if (endMs < this.calibrationEndMs) return null;
        // Ein hohes Perzentil statt des Hoechstwerts: Ein einzelner Knackser
        // verdirbt die Messung nicht.
        const sorted = this.samples.slice().sort((a, b) => a - b);
        const index = Math.floor(sorted.length * this.cfg.noisePercentile);
        this.noise = sorted[Math.min(sorted.length - 1, index)] ?? 0;
        const wanted = this.noise * this.cfg.thresholdFactor;
        this.threshold = Math.min(this.cfg.maxThreshold, Math.max(this.cfg.minThreshold, wanted));
        this.calibrated = true;
        this.phase = 'idle';
        this.samples = [];
        return {
          type: 'calibrated',
          noise: this.noise,
          threshold: this.threshold,
          tooLoud: wanted > this.cfg.maxThreshold,
        };
      }

      case 'idle':
        if (rms >= this.threshold) {
          this.phase = 'candidate';
          this.candidateStartMs = startMs;
          this.loudMs = frameMs;
          this.gapMs = 0;
          return this.maybeStart();
        }
        return null;

      case 'candidate':
        if (rms >= this.threshold) {
          this.loudMs += frameMs;
          this.gapMs = 0;
          return this.maybeStart();
        }
        this.gapMs += frameMs;
        if (this.gapMs > this.cfg.maxGapMs) this.phase = 'idle';
        return null;

      case 'speech': {
        if (rms < this.threshold * this.cfg.releaseFactor) this.silenceMs += frameMs;
        else this.silenceMs = 0;
        if (this.silenceMs >= this.cfg.endSilenceMs) {
          this.phase = 'idle';
          return { type: 'speechEnd', startMs: this.speechStartMs, endMs, forced: false };
        }
        if (endMs - this.speechStartMs >= this.cfg.maxUtteranceMs) {
          // Dauerlaerm: Aeusserung abschliessen und erst nach Ruhe wieder scharf.
          this.phase = 'cooldown';
          this.silenceMs = 0;
          return { type: 'speechEnd', startMs: this.speechStartMs, endMs, forced: true };
        }
        return null;
      }

      case 'cooldown':
        if (rms < this.threshold * this.cfg.releaseFactor) this.silenceMs += frameMs;
        else this.silenceMs = 0;
        if (this.silenceMs >= this.cfg.endSilenceMs) this.phase = 'idle';
        return null;

      default:
        return null;
    }
  }

  private maybeStart(): VadEvent | null {
    if (this.loudMs < this.cfg.minSpeechMs) return null;
    this.phase = 'speech';
    this.speechStartMs = this.candidateStartMs;
    this.silenceMs = 0;
    return { type: 'speechStart', startMs: this.speechStartMs };
  }
}
