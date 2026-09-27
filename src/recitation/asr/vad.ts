/**
 * Energy voice-activity detection and input level (spec §10.6), on 16 kHz samples in 10 ms frames.
 *
 * Speech is energy clearly above an adaptive noise floor (the floor follows quiet stretches down quickly and
 * creeps up slowly, so a steady fan or room tone is learned). A short hangover keeps the pauses between words
 * inside one speech region. Only used for status ("No speech") and, from M4, flushing; never for dropping audio.
 */
const FRAME = 160; // 10 ms at 16 kHz
const SPEECH_DB_ABOVE_FLOOR = 12;
const MIN_SPEECH_DB = -55;
const HANGOVER_FRAMES = 40; // 400 ms
const FLOOR_RISE_DB = 0.01; // per frame (1 dB/s)

export interface VadChange {
  speech: boolean;
  /** 16 kHz sample index where the change happened */
  atSample: number;
}

export class EnergyVad {
  private partial = new Float32Array(FRAME);
  private fill = 0;
  private sample = 0;
  private floor = -70;
  private speech = false;
  private quiet = 0;
  private levelAcc = 0;
  private levelN = 0;

  /** Feeds samples; returns speech/non-speech transitions. */
  push(x: Float32Array): VadChange[] {
    const changes: VadChange[] = [];
    for (let i = 0; i < x.length; i++) {
      this.partial[this.fill++] = x[i];
      this.levelAcc += x[i] * x[i];
      this.levelN++;
      if (this.fill < FRAME) continue;
      this.fill = 0;
      let e = 0;
      for (let k = 0; k < FRAME; k++) e += this.partial[k] * this.partial[k];
      const db = 10 * Math.log10(e / FRAME + 1e-12);
      this.floor = db < this.floor ? db : this.floor + FLOOR_RISE_DB;
      const loud = db > Math.max(this.floor + SPEECH_DB_ABOVE_FLOOR, MIN_SPEECH_DB);
      const at = this.sample + i + 1;
      if (loud) {
        this.quiet = 0;
        if (!this.speech) {
          this.speech = true;
          changes.push({ speech: true, atSample: at - FRAME });
        }
      } else if (this.speech && ++this.quiet > HANGOVER_FRAMES) {
        this.speech = false;
        changes.push({ speech: false, atSample: at - this.quiet * FRAME });
      }
    }
    this.sample += x.length;
    return changes;
  }

  get inSpeech() {
    return this.speech;
  }

  /** RMS since the last call (for the level meter), 0..1. */
  takeLevel(): number {
    const rms = this.levelN ? Math.sqrt(this.levelAcc / this.levelN) : 0;
    this.levelAcc = 0;
    this.levelN = 0;
    return rms;
  }
}
