// Laeuft im Audio-Thread des Browsers. Sammelt das Mikrofonsignal in Bloecke
// fester Laenge und reicht sie an die Seite weiter (src/voice/micInput.ts).
// Bewusst eine fertige .js-Datei in public/: Ein AudioWorklet wird ueber
// seine Adresse geladen, nicht ueber den Bundler.

class CaptureProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.size = options.processorOptions.frameSize;
    this.buffer = new Float32Array(this.size);
    this.fill = 0;
  }

  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    if (!channel) return true;
    let i = 0;
    while (i < channel.length) {
      const n = Math.min(channel.length - i, this.size - this.fill);
      this.buffer.set(channel.subarray(i, i + n), this.fill);
      this.fill += n;
      i += n;
      if (this.fill === this.size) {
        const out = this.buffer;
        this.buffer = new Float32Array(this.size);
        this.fill = 0;
        this.port.postMessage(out, [out.buffer]);
      }
    }
    return true;
  }
}

registerProcessor('voice-arena-capture', CaptureProcessor);
