/**
 * Microphone level for Memorize: the level of every 10 ms of input (dBFS; -120 for digital
 * silence), posted to the page in batches of five. Forgets everything when the input is disconnected (or on a
 * "reset" message), so a new turn's first frames never carry the last turn's audio.
 */
declare const sampleRate: number;
declare function registerProcessor(name: string, ctor: unknown): void;
declare class AudioWorkletProcessor {
  readonly port: MessagePort;
}

class LevelProcessor extends AudioWorkletProcessor {
  private frame = Math.round(sampleRate / 100);
  private sum = 0;
  private n = 0;
  private batch: number[] = [];

  constructor() {
    super();
    this.port.onmessage = () => this.reset();
  }

  private reset() {
    this.sum = 0;
    this.n = 0;
    this.batch = [];
  }

  process(inputs: Float32Array[][]): boolean {
    const ch = inputs[0]?.[0];
    if (!ch || !ch.length) {
      this.reset();
      return true;
    }
    for (let i = 0; i < ch.length; i++) {
      this.sum += ch[i] * ch[i];
      if (++this.n < this.frame) continue;
      this.batch.push(this.sum > 0 ? Math.max(-120, 10 * Math.log10(this.sum / this.n)) : -120);
      this.sum = 0;
      this.n = 0;
      if (this.batch.length >= 5) {
        this.port.postMessage(this.batch);
        this.batch = [];
      }
    }
    return true;
  }
}

registerProcessor("itqan-memorize-level", LevelProcessor);
