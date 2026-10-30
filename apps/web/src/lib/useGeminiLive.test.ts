import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useGeminiLive } from './useGeminiLive';
import * as api from './api';

// Mock getVoiceToken
vi.mock('./api', () => ({
  getVoiceToken: vi.fn(),
}));

// Mock audio helpers
vi.mock('./audio', () => ({
  floatTo16BitPCM: vi.fn(() => new ArrayBuffer(10)),
  base64Decode: vi.fn(() => new ArrayBuffer(10)),
  PlaybackQueue: class MockPlaybackQueue {
    enqueue = vi.fn();
    stop = vi.fn();
    pendingCount = 0;
  },
}));

class MockWebSocket {
  static instances: MockWebSocket[] = [];
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;

  url: string;
  readyState: number = 0; // 0: CONNECTING, 1: OPEN, 2: CLOSING, 3: CLOSED
  sentMessages: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: ((err: unknown) => void) | null = null;
  onclose: (() => void) | null = null;

  constructor(url: string) {
    this.url = url;
    MockWebSocket.instances.push(this);
  }

  send(data: string) {
    this.sentMessages.push(data);
  }

  close() {
    this.readyState = 3; // CLOSED
    this.onclose?.();
  }

  // Helper to simulate server messages
  simulateMessage(obj: unknown) {
    this.onmessage?.({ data: JSON.stringify(obj) });
  }

  simulateOpen() {
    this.readyState = 1; // OPEN
    this.onopen?.();
  }
}

describe('useGeminiLive hook (Issue #72)', () => {
  const originalWebSocket = window.WebSocket;
  const originalAudioContext = window.AudioContext;
  let mockMediaStreamTrack: { stop: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    MockWebSocket.instances = [];
    (window as unknown as { WebSocket: unknown }).WebSocket = MockWebSocket;

    mockMediaStreamTrack = { stop: vi.fn() };
    Object.defineProperty(navigator, 'mediaDevices', {
      value: {
        getUserMedia: vi.fn().mockResolvedValue({
          getTracks: () => [mockMediaStreamTrack],
        }),
      },
      writable: true,
      configurable: true,
    });

    function MockAudioContext(this: any) {
      this.state = 'running';
      this.resume = vi.fn().mockResolvedValue(undefined);
      this.close = vi.fn().mockResolvedValue(undefined);
      this.createMediaStreamSource = vi.fn(() => ({
        connect: vi.fn(),
      }));
      this.createAnalyser = vi.fn(() => ({
        fftSize: 256,
        frequencyBinCount: 128,
        connect: vi.fn(),
        disconnect: vi.fn(),
        getByteFrequencyData: vi.fn(),
      }));
      this.createScriptProcessor = vi.fn(() => ({
        connect: vi.fn(),
        disconnect: vi.fn(),
        onaudioprocess: null,
      }));
      this.destination = {};
    }

    (window as unknown as { AudioContext: unknown }).AudioContext = MockAudioContext;
  });

  afterEach(() => {
    window.WebSocket = originalWebSocket;
    window.AudioContext = originalAudioContext;
    vi.clearAllMocks();
  });

  it('initializes in idle state', () => {
    const { result } = renderHook(() => useGeminiLive({ sessionId: 'session-123' }));
    expect(result.current.state).toBe('idle');
    expect(result.current.isMuted).toBe(false);
    expect(result.current.audioLevel).toBe(0);
    expect(result.current.partialCandidateText).toBe('');
    expect(result.current.partialAiText).toBe('');
  });

  it('transitions to failed if sessionId is missing', async () => {
    const onError = vi.fn();
    const { result } = renderHook(() => useGeminiLive({ onError }));

    await act(async () => {
      await result.current.connect();
    });

    expect(result.current.state).toBe('failed');
    expect(result.current.errorMessage).toContain('No sessionId');
    expect(onError).toHaveBeenCalled();
  });

  it('connects, sends setup message, and handles setupComplete', async () => {
    vi.mocked(api.getVoiceToken).mockResolvedValue('test-ephemeral-token');
    const { result } = renderHook(() => useGeminiLive({ sessionId: 'session-123' }));

    let connectPromise!: Promise<void>;
    act(() => {
      connectPromise = result.current.connect();
    });

    await vi.waitFor(() => {
      if (result.current.state === 'failed') {
        throw new Error('Connect failed with: ' + result.current.errorMessage);
      }
      expect(MockWebSocket.instances.length).toBe(1);
    });

    const ws = MockWebSocket.instances[0];
    expect(ws.url).toContain('access_token=test-ephemeral-token');

    // Socket opens
    act(() => {
      ws.simulateOpen();
    });

    // Verify setup message sent (without model or systemInstruction, as required)
    expect(ws.sentMessages.length).toBe(1);
    const sentSetup = JSON.parse(ws.sentMessages[0]);
    expect(sentSetup.setup).toBeDefined();
    expect(sentSetup.setup.model).toBeUndefined();
    expect(sentSetup.setup.systemInstruction).toBeUndefined();

    // Server sends setupComplete
    act(() => {
      ws.simulateMessage({ setupComplete: {} });
    });

    expect(result.current.state).toBe('connected');

    await act(async () => {
      await connectPromise;
    });
  });

  it('handles live transcriptions and interruption', async () => {
    vi.mocked(api.getVoiceToken).mockResolvedValue('test-token');
    const onTranscription = vi.fn();
    const { result } = renderHook(() =>
      useGeminiLive({ sessionId: 'session-123', onTranscription })
    );

    let p!: Promise<void>;
    act(() => {
      p = result.current.connect();
    });

    await vi.waitFor(() => {
      if (result.current.state === 'failed') {
        throw new Error('Connect failed with: ' + result.current.errorMessage);
      }
      expect(MockWebSocket.instances.length).toBe(1);
    });

    const ws = MockWebSocket.instances[0];
    act(() => {
      ws.simulateOpen();
      ws.simulateMessage({ setupComplete: {} });
    });

    await act(async () => {
      await p;
    });

    // Interviewer speaks transcription
    act(() => {
      ws.simulateMessage({
        serverContent: {
          outputTranscription: { text: 'Hello, welcome!' },
        },
      });
    });

    expect(result.current.partialAiText).toBe('Hello, welcome!');
    expect(onTranscription).toHaveBeenCalledWith({
      speaker: 'interviewer',
      text: 'Hello, welcome!',
    });

    // Candidate speaks transcription
    act(() => {
      ws.simulateMessage({
        serverContent: {
          inputTranscription: { text: 'Thank you.' },
        },
      });
    });

    expect(result.current.partialCandidateText).toBe('Thank you.');
    expect(onTranscription).toHaveBeenCalledWith({
      speaker: 'candidate',
      text: 'Thank you.',
    });

    // Candidate interrupts (FR-14)
    act(() => {
      ws.simulateMessage({
        serverContent: {
          interrupted: true,
        },
      });
    });

    expect(result.current.partialAiText).toBe('');
  });

  it('handles token or socket errors with failed state', async () => {
    vi.mocked(api.getVoiceToken).mockRejectedValue(new Error('Token timeout'));
    const onError = vi.fn();
    const { result } = renderHook(() =>
      useGeminiLive({ sessionId: 'session-123', onError })
    );

    await act(async () => {
      await result.current.connect();
    });

    expect(result.current.state).toBe('failed');
    expect(result.current.errorMessage).toBe('Token timeout');
    expect(onError).toHaveBeenCalled();
  });

  it('mutes and unmutes correctly', () => {
    const { result } = renderHook(() => useGeminiLive({ sessionId: 'session-123' }));

    act(() => {
      result.current.setMuted(true);
    });
    expect(result.current.isMuted).toBe(true);
    expect(result.current.audioLevel).toBe(0);

    act(() => {
      result.current.setMuted(false);
    });
    expect(result.current.isMuted).toBe(false);
  });

  it('disconnects and cleans up all audio and socket resources', async () => {
    vi.mocked(api.getVoiceToken).mockResolvedValue('test-token');
    const { result } = renderHook(() => useGeminiLive({ sessionId: 'session-123' }));

    let p!: Promise<void>;
    act(() => {
      p = result.current.connect();
    });

    await vi.waitFor(() => {
      if (result.current.state === 'failed') {
        throw new Error('Connect failed with: ' + result.current.errorMessage);
      }
      expect(MockWebSocket.instances.length).toBe(1);
    });

    const ws = MockWebSocket.instances[0];
    act(() => {
      ws.simulateOpen();
      ws.simulateMessage({ setupComplete: {} });
    });

    await act(async () => {
      await p;
    });

    expect(result.current.state).toBe('connected');

    act(() => {
      result.current.disconnect();
    });

    expect(result.current.state).toBe('closed');
    expect(mockMediaStreamTrack.stop).toHaveBeenCalled();
    expect(ws.readyState).toBe(3);
  });
});
