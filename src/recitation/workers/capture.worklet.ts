/**
 * Microphone capture (spec §10.6): copies each render quantum into the shared ring buffer. Nothing else.
 */
import { RingWriter, type RingBuffers } from "../asr/ring";

declare const currentFrame: number;
declare function registerProcessor(name: string, ctor: unknown): void;
declare class AudioWorkletProcessor {
  readonly port: MessagePort;
  constructor(options?: { processorOptions?: unknown });
}

class CaptureProcessor extends AudioWorkletProcessor {
  private ring: RingWriter;
  constructor(options: { processorOptions: RingBuffers }) {
    super(options);
    this.ring = new RingWriter(options.processorOptions);
  }
  process(inputs: Float32Array[][]): boolean {
    const ch = inputs[0]?.[0];
    if (ch && ch.length) this.ring.write(ch, currentFrame);
    return true;
  }
}

registerProcessor("itqan-capture", CaptureProcessor);
