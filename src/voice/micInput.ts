// Mikrofon: holt das Signal ueber getUserMedia und liefert es in Rahmen
// fester Dauer samt Effektivwert (Pegel).

import type { VoiceConfig } from '../combat';

export type FrameHandler = (samples: Float32Array, rms: number, endMs: number, frameMs: number) => void;

export class MicInput {
  sampleRate = 0;
  onFrame: FrameHandler | null = null;

  private context: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private node: AudioWorkletNode | null = null;

  get running(): boolean {
    return this.context !== null;
  }

  /** Fragt das Mikrofon an und beginnt zu liefern. Wirft mit lesbarer Meldung. */
  async start(mic: VoiceConfig['mic'], frameMs: number): Promise<void> {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error(
        'Dieser Browser gibt kein Mikrofon frei. Das geht nur auf localhost oder über https.',
      );
    }
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        video: false,
        audio: {
          channelCount: 1,
          echoCancellation: mic.echoCancellation,
          noiseSuppression: mic.noiseSuppression,
          autoGainControl: mic.autoGainControl,
        },
      });
    } catch (error) {
      const name = error instanceof DOMException ? error.name : '';
      if (name === 'NotAllowedError' || name === 'SecurityError') {
        throw new Error('Der Zugriff auf das Mikrofon wurde abgelehnt.');
      }
      if (name === 'NotFoundError') throw new Error('Es wurde kein Mikrofon gefunden.');
      throw new Error(`Das Mikrofon lässt sich nicht öffnen (${name || String(error)}).`);
    }

    const context = new AudioContext();
    this.context = context;
    this.sampleRate = context.sampleRate;
    await context.resume();
    await context.audioWorklet.addModule(new URL('audio/capture-worklet.js', document.baseURI).href);

    const frameSize = Math.max(1, Math.round((context.sampleRate * frameMs) / 1000));
    const exactFrameMs = (frameSize / context.sampleRate) * 1000;
    const source = context.createMediaStreamSource(this.stream);
    const node = new AudioWorkletNode(context, 'voice-arena-capture', {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      channelCount: 1,
      processorOptions: { frameSize },
    });
    this.node = node;
    node.port.onmessage = (event: MessageEvent<Float32Array>) => {
      const samples = event.data;
      let sum = 0;
      for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
      const rms = Math.sqrt(sum / Math.max(1, samples.length));
      this.onFrame?.(samples, rms, performance.now(), exactFrameMs);
    };

    // Stumm an den Ausgang haengen: Manche Browser rechnen einen Knoten nur,
    // wenn er irgendwo ankommt. Zu hoeren ist nichts.
    const mute = context.createGain();
    mute.gain.value = 0;
    source.connect(node);
    node.connect(mute);
    mute.connect(context.destination);
  }

  stop(): void {
    if (this.node) {
      this.node.port.onmessage = null;
      this.node.disconnect();
      this.node = null;
    }
    if (this.stream) {
      for (const track of this.stream.getTracks()) track.stop();
      this.stream = null;
    }
    if (this.context) {
      void this.context.close();
      this.context = null;
    }
  }
}
