/* Microphone capture for the live conversation: averages the input down to 16 kHz, packs it as 16-bit PCM and posts 100 ms chunks with their loudness. */
class ValetCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.step = sampleRate / 16000;
    this.fill = 0;
    this.sum = 0;
    this.count = 0;
    this.out = new Int16Array(1600);
    this.n = 0;
    this.power = 0;
  }

  process(inputs) {
    const input = inputs[0] && inputs[0][0];
    if (!input) return true;
    for (let i = 0; i < input.length; i++) {
      this.sum += input[i];
      this.count++;
      this.fill++;
      if (this.fill < this.step) continue;
      this.fill -= this.step;
      const v = Math.max(-1, Math.min(1, this.sum / this.count));
      this.sum = 0;
      this.count = 0;
      this.out[this.n++] = v * 32767;
      this.power += v * v;
      if (this.n < this.out.length) continue;
      this.port.postMessage({ pcm: this.out.buffer, level: Math.sqrt(this.power / this.n) }, [this.out.buffer]);
      this.out = new Int16Array(1600);
      this.n = 0;
      this.power = 0;
    }
    return true;
  }
}

registerProcessor("valet-capture", ValetCapture);
