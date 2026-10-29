import { describe, it, expect, vi } from "vitest";
import {
  floatTo16BitPCM,
  pcm16ToFloat,
  base64Encode,
  base64Decode,
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
