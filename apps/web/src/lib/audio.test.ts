import { describe, it, expect, vi } from "vitest";
import {
  floatTo16BitPCM,
  pcm16ToFloat,
  base64Encode,
  base64Decode,
  downsampleBuffer,
  PlaybackQueue,
} from "./audio";

describe("audio helpers (Issue #81)", () => {
  describe("floatTo16BitPCM and pcm16ToFloat", () => {
    it("round-trips Float32 samples within 1/32768 precision", () => {
      // Acceptance criteria: Given a Float32 sample array, when encoded and decoded, then the values round-trip within 1/32768
      const original = new Float32Array([0.0, 0.5, -0.5, 0.999, -0.999, 0.1234, -0.8765]);
      const encoded = floatTo16BitPCM(original);
      const decoded = pcm16ToFloat(encoded);

      expect(decoded.length).toBe(original.length);
      for (let i = 0; i < original.length; i++) {
        expect(Math.abs(decoded[i] - original[i])).toBeLessThanOrEqual(1 / 32768 + 1e-6);
      }
    });

    it("clamps values outside [-1.0, 1.0]", () => {
      const outOfBounds = new Float32Array([-2.5, 3.0]);
      const encoded = floatTo16BitPCM(outOfBounds);
      const decoded = pcm16ToFloat(encoded);

      expect(decoded[0]).toBeCloseTo(-1.0, 3);
      expect(decoded[1]).toBeCloseTo(1.0, 3);
    });

    it("handles empty arrays", () => {
      const empty = new Float32Array(0);
      const encoded = floatTo16BitPCM(empty);
      expect(encoded.byteLength).toBe(0);

      const decoded = pcm16ToFloat(encoded);
      expect(decoded.length).toBe(0);
    });
  });

  describe("base64Encode and base64Decode", () => {
    it("encodes and decodes binary data correctly", () => {
      const originalBytes = new Uint8Array([0, 1, 2, 255, 128, 64, 42]);
      const base64 = base64Encode(originalBytes.buffer);
      expect(typeof base64).toBe("string");

      const decodedBuffer = base64Decode(base64);
      const decodedBytes = new Uint8Array(decodedBuffer);

      expect(decodedBytes.length).toBe(originalBytes.length);
      for (let i = 0; i < originalBytes.length; i++) {
        expect(decodedBytes[i]).toBe(originalBytes[i]);
      }
    });
  });

  describe("downsampleBuffer", () => {
    it("returns 16 kHz audio unchanged", () => {
      const input = new Float32Array([0.1, -0.2, 0.3, -0.4]);
      expect(downsampleBuffer(input, 16000, 16000)).toBe(input);
    });

    it("downsamples 48 kHz to 16 kHz by averaging 3-sample groups", () => {
      const input = new Float32Array([0.3, 0.6, 0.9, -0.3, -0.6, -0.9]);
      const output = downsampleBuffer(input, 48000, 16000);

      expect(output.length).toBe(2);
      expect(output[0]).toBeCloseTo(0.6, 5);
      expect(output[1]).toBeCloseTo(-0.6, 5);
    });

    it("downsamples 44.1 kHz 40ms chunk (1764 samples) to 640 16 kHz samples", () => {
      const input = new Float32Array(1764).fill(0.25);
      const output = downsampleBuffer(input, 44100, 16000);

      expect(output.length).toBe(640);
      expect(output[0]).toBeCloseTo(0.25, 5);
      expect(output[639]).toBeCloseTo(0.25, 5);
    });

    it("handles empty buffers and rates below target", () => {
      const empty = new Float32Array(0);
      expect(downsampleBuffer(empty, 48000, 16000).length).toBe(0);

      const lowRate = new Float32Array([0.2, 0.4]);
      expect(downsampleBuffer(lowRate, 8000, 16000)).toBe(lowRate);
    });

    it("buffers 48 kHz quanta in PcmCaptureProcessor and emits 16 kHz Int16 frames", async () => {
      const posted: ArrayBuffer[] = [];
      class StubProcessor {
        port = { postMessage: (msg: ArrayBuffer) => posted.push(msg) };
      }
      type WorkletInstance = { process(inputs: Float32Array[][]): boolean };
      let Registered: (new () => WorkletInstance) | undefined;

      vi.stubGlobal("AudioWorkletProcessor", StubProcessor);
      vi.stubGlobal("sampleRate", 48000);
      vi.stubGlobal("registerProcessor", (_name: string, ctor: new () => WorkletInstance) => {
        Registered = ctor;
      });

      vi.resetModules();
      await import("./pcmCaptureWorklet");

      const processor = new Registered!();
      const quantum = new Float32Array(128).fill(0.5);
      for (let i = 0; i < 15; i++) {
        expect(processor.process([[quantum]])).toBe(true);
      }

      expect(posted).toHaveLength(1);
      expect(posted[0].byteLength).toBe(640 * 2);
      expect(pcm16ToFloat(posted[0])[0]).toBeCloseTo(0.5, 3);

      vi.unstubAllGlobals();
    });
  });

  describe("PlaybackQueue", () => {
    function createMockAudioContext() {
      const sources: Array<{
        buffer: unknown;
        connect: ReturnType<typeof vi.fn>;
        start: ReturnType<typeof vi.fn>;
        stop: ReturnType<typeof vi.fn>;
        disconnect: ReturnType<typeof vi.fn>;
        onended: (() => void) | null;
      }> = [];

      const mockCtx = {
        currentTime: 10,
        destination: {} as AudioDestinationNode,
        createBuffer: vi.fn((_channels: number, length: number, sampleRate: number) => ({
          duration: length / sampleRate,
          copyToChannel: vi.fn(),
        })),
        createBufferSource: vi.fn(() => {
          const source = {
            buffer: null,
            connect: vi.fn(),
            start: vi.fn(),
            stop: vi.fn(),
            disconnect: vi.fn(),
            onended: null as (() => void) | null,
          };
          sources.push(source);
          return source;
        }),
        _sources: sources,
      };

      return mockCtx;
    }

    it("schedules three buffers and stop() clears all pending sources", () => {
      // Acceptance criteria: Given three buffers queued, then stop() clears all pending sources
      const mockCtx = createMockAudioContext();
      const queue = new PlaybackQueue(mockCtx as unknown as AudioContext, 24000);

      const chunk1 = new Float32Array(2400); // 0.1s
      const chunk2 = new Float32Array(2400); // 0.1s
      const chunk3 = new Float32Array(2400); // 0.1s

      queue.enqueue(chunk1);
      queue.enqueue(chunk2);
      queue.enqueue(chunk3);

      expect(queue.pendingCount).toBe(3);
      expect(mockCtx._sources.length).toBe(3);
      expect(mockCtx._sources[0].start).toHaveBeenCalled();
      expect(mockCtx._sources[1].start).toHaveBeenCalled();
      expect(mockCtx._sources[2].start).toHaveBeenCalled();

      // Interrupt: call stop()
      queue.stop();

      expect(queue.pendingCount).toBe(0);
      for (const source of mockCtx._sources) {
        expect(source.stop).toHaveBeenCalledTimes(1);
        expect(source.disconnect).toHaveBeenCalledTimes(1);
      }
    });

    it("removes a source from pending when its onended callback fires", () => {
      const mockCtx = createMockAudioContext();
      const queue = new PlaybackQueue(mockCtx as unknown as AudioContext, 24000);

      const chunk = new Float32Array(2400);
      queue.enqueue(chunk);
      expect(queue.pendingCount).toBe(1);

      // Trigger playback finished
      mockCtx._sources[0].onended?.();
      expect(queue.pendingCount).toBe(0);
    });
  });
});
