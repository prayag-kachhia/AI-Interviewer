import {
  downsampleBuffer,
  floatTo16BitPCM,
  LIVE_INPUT_SAMPLE_RATE,
  PCM_CAPTURE_PROCESSOR,
} from './audio';

declare abstract class AudioWorkletProcessor {
  readonly port: MessagePort;
  constructor(options?: AudioWorkletNodeOptions);
  abstract process(
    inputs: Float32Array[][],
    outputs: Float32Array[][],
    parameters: Record<string, Float32Array>
  ): boolean;
}

declare function registerProcessor(
  name: string,
  processorCtor: new (options?: AudioWorkletNodeOptions) => AudioWorkletProcessor
): void;

declare const sampleRate: number;

/** Captures mic quanta, buffers ~40ms chunks, downsamples to 16 kHz Int16, and transfers frames. */
class PcmCaptureProcessor extends AudioWorkletProcessor {
  private readonly chunkSamples = Math.max(128, Math.round(sampleRate / 25));
  private pending = new Float32Array(this.chunkSamples * 2);
  private pendingLength = 0;

  process(inputs: Float32Array[][]): boolean {
    const channel = inputs[0]?.[0];
    if (!channel || channel.length === 0) return true;

    if (this.pendingLength + channel.length > this.pending.length) {
      const grown = new Float32Array((this.pendingLength + channel.length) * 2);
      grown.set(this.pending.subarray(0, this.pendingLength));
      this.pending = grown;
    }

    this.pending.set(channel, this.pendingLength);
    this.pendingLength += channel.length;

    while (this.pendingLength >= this.chunkSamples) {
      const chunk = this.pending.slice(0, this.chunkSamples);
      this.pending.copyWithin(0, this.chunkSamples, this.pendingLength);
      this.pendingLength -= this.chunkSamples;

      const resampled = downsampleBuffer(chunk, sampleRate, LIVE_INPUT_SAMPLE_RATE);
      const pcm = floatTo16BitPCM(resampled);
      this.port.postMessage(pcm, [pcm]);
    }

    return true;
  }
}

registerProcessor(PCM_CAPTURE_PROCESSOR, PcmCaptureProcessor);
