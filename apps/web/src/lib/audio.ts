/**
 * Audio processing utilities ported from spike/index.html for Gemini Live.
 *
 * - floatTo16BitPCM: converts Float32Array [-1.0, 1.0] to 16-bit PCM ArrayBuffer (little-endian)
 * - pcm16ToFloat: converts 16-bit PCM ArrayBuffer to Float32Array [-1.0, 1.0]
 * - base64Encode: converts binary ArrayBuffer to base64 string
 * - base64Decode: converts base64 string to binary ArrayBuffer
 * - PlaybackQueue: schedules 24kHz audio buffers back-to-back on an AudioContext with stop()
 */

/**
 * Converts browser microphone Float32Array [-1.0, 1.0] samples into
 * 16-bit signed PCM ArrayBuffer (little-endian) expected by Gemini Live.
 */
export function floatTo16BitPCM(float32Array: Float32Array): ArrayBuffer {
  const buffer = new ArrayBuffer(float32Array.length * 2);
  const view = new DataView(buffer);
  for (let i = 0; i < float32Array.length; i++) {
    const s = Math.max(-1, Math.min(1, float32Array[i]));
    view.setInt16(i * 2, s < 0 ? Math.round(s * 0x8000) : Math.round(s * 0x7fff), true);
  }
  return buffer;
}

/**
 * Converts 16-bit signed PCM ArrayBuffer (little-endian) from Gemini Live
 * into Float32Array [-1.0, 1.0] for browser playback.
 */
export function pcm16ToFloat(buffer: ArrayBuffer): Float32Array {
  const sampleCount = Math.floor(buffer.byteLength / 2);
  const view = new DataView(buffer);
  const float32 = new Float32Array(sampleCount);
  for (let i = 0; i < sampleCount; i++) {
    const int16 = view.getInt16(i * 2, true);
    float32[i] = int16 < 0 ? int16 / 32768 : int16 / 32767;
  }
  return float32;
}

/**
 * Encodes an ArrayBuffer of binary data into a base64 string.
 */
export function base64Encode(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

/**
 * Decodes a base64 string into an ArrayBuffer of binary data.
 */
export function base64Decode(base64: string): ArrayBuffer {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes.buffer;
}

/**
 * Manages smooth, gapless playback of streaming 24 kHz audio chunks
 * on a Web Audio AudioContext, with instant cancellation on interruption.
 */
export class PlaybackQueue {
  private ctx: AudioContext;
  private sampleRate: number;
  private nextPlayTime = 0;
  private activeSources: AudioBufferSourceNode[] = [];

  constructor(ctx: AudioContext, sampleRate = 24000) {
    this.ctx = ctx;
    this.sampleRate = sampleRate;
  }

  /**
   * Enqueues an audio chunk (as ArrayBuffer PCM16, Float32Array, or AudioBuffer)
   * for gapless playback scheduled right after any currently playing audio.
   */
  enqueue(audioData: ArrayBuffer | Float32Array | AudioBuffer): void {
    let audioBuffer: AudioBuffer;

    if (audioData instanceof Float32Array) {
      audioBuffer = this.ctx.createBuffer(1, audioData.length, this.sampleRate);
      audioBuffer.copyToChannel(audioData as Float32Array<ArrayBuffer>, 0);
    } else if (audioData instanceof ArrayBuffer) {
      const float32 = pcm16ToFloat(audioData);
      audioBuffer = this.ctx.createBuffer(1, float32.length, this.sampleRate);
      audioBuffer.copyToChannel(float32 as Float32Array<ArrayBuffer>, 0);
    } else {
      audioBuffer = audioData;
    }

    const source = this.ctx.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(this.ctx.destination);

    const currentTime = this.ctx.currentTime;
    if (this.nextPlayTime < currentTime) {
      this.nextPlayTime = currentTime + 0.05; // 50ms buffer for seamless streaming
    }

    source.start(this.nextPlayTime);
    this.nextPlayTime += audioBuffer.duration;

    this.activeSources.push(source);
    source.onended = () => {
      const idx = this.activeSources.indexOf(source);
      if (idx !== -1) {
        this.activeSources.splice(idx, 1);
      }
    };
  }

  /**
   * Immediately stops all currently playing and queued audio sources.
   * Used when candidate interrupts the interviewer.
   */
  stop(): void {
    for (const source of this.activeSources) {
      try {
        source.stop();
        source.disconnect();
      } catch {
        // already stopped or disconnected
      }
    }
    this.activeSources = [];
    this.nextPlayTime = this.ctx.currentTime;
  }

  /**
   * Number of sources currently playing or scheduled to play.
   */
  get pendingCount(): number {
    return this.activeSources.length;
  }
}
