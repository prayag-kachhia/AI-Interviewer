import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { GeminiLiveVoiceAdapter } from './geminiLiveAdapter';
import * as api from './api';
import type { VoiceAdapterCallbacks } from './voiceAdapter';

// Mock getVoiceToken
vi.mock('./api', () => ({
  getVoiceToken: vi.fn(),
}));

// Mock audio helpers
const mockPlaybackQueueInstance = {
  enqueue: vi.fn(),
  stop: vi.fn(),
  pendingCount: 0,
};

vi.mock('./audio', () => ({
  floatTo16BitPCM: vi.fn(() => new ArrayBuffer(10)),
  base64Decode: vi.fn(() => new ArrayBuffer(10)),
  PlaybackQueue: class MockPlaybackQueue {
    constructor() {
      return mockPlaybackQueueInstance;
    }
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

  simulateMessage(obj: unknown) {
    this.onmessage?.({ data: JSON.stringify(obj) });
  }

  simulateOpen() {
    this.readyState = 1; // OPEN
    this.onopen?.();
  }
}

describe('GeminiLiveVoiceAdapter (Issue #130 / VI-1)', () => {
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
      this.currentTime = 0;
      this.resume = vi.fn().mockResolvedValue(undefined);
      this.close = vi.fn().mockResolvedValue(undefined);
      this.createMediaStreamSource = vi.fn(() => ({
        connect: vi.fn(),
      }));
      this.createAnalyser = vi.fn(() => ({
        fftSize: 256,
        frequencyBinCount: 128,
        getByteFrequencyData: vi.fn((arr: Uint8Array) => arr.fill(50)),
        connect: vi.fn(),
        disconnect: vi.fn(),
      }));
      this.createScriptProcessor = vi.fn(() => ({
        connect: vi.fn(),
        disconnect: vi.fn(),
        onaudioprocess: null,
      }));
      this.createBuffer = vi.fn(() => ({
        duration: 0.1,
        copyToChannel: vi.fn(),
      }));
      this.createBufferSource = vi.fn(() => ({
        buffer: null,
        connect: vi.fn(),
        disconnect: vi.fn(),
        start: vi.fn(),
        stop: vi.fn(),
        onended: null,
      }));
      this.destination = {};
    }

    (window as unknown as { AudioContext: unknown }).AudioContext = MockAudioContext;
    (window as unknown as { webkitAudioContext: unknown }).webkitAudioContext = MockAudioContext;
  });

  afterEach(() => {
    (window as unknown as { WebSocket: unknown }).WebSocket = originalWebSocket;
    (window as unknown as { AudioContext: unknown }).AudioContext = originalAudioContext;
    vi.restoreAllMocks();
  });

  it('implements VoiceSessionAdapter properties', () => {
    const adapter = new GeminiLiveVoiceAdapter();
    expect(adapter.providerLabel).toBe('Google Gemini Live');
    expect(adapter.isExternalProvider).toBe(true);
    expect(adapter.isSpeechRecognitionSupported).toBe(true);
  });

  it('connects, sends setup handshake, and handles setupComplete', async () => {
    vi.mocked(api.getVoiceToken).mockResolvedValue('test-token-123');

    const adapter = new GeminiLiveVoiceAdapter();
    const callbacks: VoiceAdapterCallbacks = {
      onStateChange: vi.fn(),
      onTranscript: vi.fn(),
      onAudioLevel: vi.fn(),
      onError: vi.fn(),
    };

    const p = adapter.connect('session-1', callbacks);

    await vi.waitFor(() => {
      expect(MockWebSocket.instances.length).toBe(1);
    });

    const ws = MockWebSocket.instances[0];
    expect(ws.url).toContain('access_token=test-token-123');

    // Simulate socket open
    ws.simulateOpen();

    expect(ws.sentMessages.length).toBe(1);
    const setupMsg = JSON.parse(ws.sentMessages[0]);
    expect(setupMsg.setup).toBeDefined();
    expect(setupMsg.setup.generationConfig.responseModalities).toEqual(['AUDIO']);
    expect(setupMsg.setup.generationConfig.speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName).toBe(
      'Puck'
    );

    // Simulate setupComplete from server
    ws.simulateMessage({ setupComplete: {} });
    await p;

    expect(callbacks.onStateChange).toHaveBeenCalledWith('LISTENING');
  });

  it('handles incoming spoken turns and audio playback', async () => {
    vi.mocked(api.getVoiceToken).mockResolvedValue('test-token-123');

    const adapter = new GeminiLiveVoiceAdapter();
    const callbacks: VoiceAdapterCallbacks = {
      onStateChange: vi.fn(),
      onTranscript: vi.fn(),
      onAudioLevel: vi.fn(),
      onError: vi.fn(),
    };

    const p = adapter.connect('session-1', callbacks);
    await vi.waitFor(() => expect(MockWebSocket.instances.length).toBe(1));
    const ws = MockWebSocket.instances[0];
    ws.simulateOpen();
    ws.simulateMessage({ setupComplete: {} });
    await p;

    // AI speaks audio and sends output transcription
    ws.simulateMessage({
      serverContent: {
        outputTranscription: { text: 'Hello, welcome to your mock interview.' },
        modelTurn: {
          parts: [{ inlineData: { mimeType: 'audio/pcm;rate=24000', data: 'AQID' } }],
        },
      },
    });

    expect(callbacks.onTranscript).toHaveBeenCalledWith({
      speaker: 'AI',
      text: 'Hello, welcome to your mock interview.',
      isFinal: false,
    });
    expect(callbacks.onStateChange).toHaveBeenCalledWith('AI_SPEAKING');
    expect(mockPlaybackQueueInstance.enqueue).toHaveBeenCalled();

    // Candidate speaks
    ws.simulateMessage({
      serverContent: {
        inputTranscription: { text: 'Thank you for having me.' },
      },
    });

    expect(callbacks.onTranscript).toHaveBeenCalledWith({
      speaker: 'CANDIDATE',
      text: 'Thank you for having me.',
      isFinal: false,
    });
    expect(callbacks.onStateChange).toHaveBeenCalledWith('LISTENING');

    // Turn complete
    ws.simulateMessage({
      serverContent: {
        turnComplete: true,
      },
    });

    expect(callbacks.onStateChange).toHaveBeenCalledWith('LISTENING');
  });

  it('handles candidate interruption by immediately cutting off audio', async () => {
    vi.mocked(api.getVoiceToken).mockResolvedValue('test-token-123');

    const adapter = new GeminiLiveVoiceAdapter();
    const callbacks: VoiceAdapterCallbacks = {
      onStateChange: vi.fn(),
      onTranscript: vi.fn(),
      onAudioLevel: vi.fn(),
      onError: vi.fn(),
    };

    const p = adapter.connect('session-1', callbacks);
    await vi.waitFor(() => expect(MockWebSocket.instances.length).toBe(1));
    const ws = MockWebSocket.instances[0];
    ws.simulateOpen();
    ws.simulateMessage({ setupComplete: {} });
    await p;

    mockPlaybackQueueInstance.stop.mockClear();

    // AI gets interrupted
    ws.simulateMessage({
      serverContent: {
        interrupted: true,
      },
    });

    expect(mockPlaybackQueueInstance.stop).toHaveBeenCalled();
    expect(callbacks.onStateChange).toHaveBeenCalledWith('LISTENING');
  });

  it('implements sendText to send cue messages over WebSocket', async () => {
    vi.mocked(api.getVoiceToken).mockResolvedValue('test-token-123');

    const adapter = new GeminiLiveVoiceAdapter();
    const callbacks: VoiceAdapterCallbacks = {
      onStateChange: vi.fn(),
      onTranscript: vi.fn(),
      onAudioLevel: vi.fn(),
      onError: vi.fn(),
    };

    const p = adapter.connect('session-1', callbacks);
    await vi.waitFor(() => expect(MockWebSocket.instances.length).toBe(1));
    const ws = MockWebSocket.instances[0];
    ws.simulateOpen();
    ws.simulateMessage({ setupComplete: {} });
    await p;

    ws.sentMessages = [];
    adapter.sendText('[the candidate is thinking; offer brief encouragement]');

    expect(ws.sentMessages.length).toBe(1);
    const cueMsg = JSON.parse(ws.sentMessages[0]);
    expect(cueMsg.clientContent.turns[0].parts[0].text).toBe(
      '[the candidate is thinking; offer brief encouragement]'
    );
    expect(cueMsg.clientContent.turnComplete).toBe(true);
  });

  it('handles mute and unmute', async () => {
    vi.mocked(api.getVoiceToken).mockResolvedValue('test-token-123');

    const adapter = new GeminiLiveVoiceAdapter();
    const callbacks: VoiceAdapterCallbacks = {
      onStateChange: vi.fn(),
      onTranscript: vi.fn(),
      onAudioLevel: vi.fn(),
      onError: vi.fn(),
    };

    const p = adapter.connect('session-1', callbacks);
    await vi.waitFor(() => expect(MockWebSocket.instances.length).toBe(1));
    const ws = MockWebSocket.instances[0];
    ws.simulateOpen();
    ws.simulateMessage({ setupComplete: {} });
    await p;

    adapter.setMuted(true);
    expect(callbacks.onAudioLevel).toHaveBeenCalledWith(0);
  });

  it('disconnects and tears down audio and socket resources cleanly', async () => {
    vi.mocked(api.getVoiceToken).mockResolvedValue('test-token-123');
    sessionStorage.setItem('gemini_resumption_session-1', 'handle-123');

    const adapter = new GeminiLiveVoiceAdapter();
    const callbacks: VoiceAdapterCallbacks = {
      onStateChange: vi.fn(),
      onTranscript: vi.fn(),
      onAudioLevel: vi.fn(),
      onError: vi.fn(),
    };

    const p = adapter.connect('session-1', callbacks);
    await vi.waitFor(() => expect(MockWebSocket.instances.length).toBe(1));
    const ws = MockWebSocket.instances[0];
    ws.simulateOpen();
    ws.simulateMessage({ setupComplete: {} });
    await p;

    adapter.disconnect();

    expect(callbacks.onStateChange).toHaveBeenCalledWith('IDLE');
    expect(mockMediaStreamTrack.stop).toHaveBeenCalled();
    expect(mockPlaybackQueueInstance.stop).toHaveBeenCalled();
    expect(sessionStorage.getItem('gemini_resumption_session-1')).toBeNull();
  });

  it('handles token failure with fail helper and ERROR state', async () => {
    vi.mocked(api.getVoiceToken).mockRejectedValue(new Error('Token network error'));

    const adapter = new GeminiLiveVoiceAdapter();
    const callbacks: VoiceAdapterCallbacks = {
      onStateChange: vi.fn(),
      onTranscript: vi.fn(),
      onAudioLevel: vi.fn(),
      onError: vi.fn(),
    };

    await adapter.connect('session-fail', callbacks);

    expect(callbacks.onError).toHaveBeenCalledWith('Token network error');
    expect(callbacks.onStateChange).toHaveBeenCalledWith('ERROR');
  });

  it('reconnects with session resumption handle on GoAway', async () => {
    vi.mocked(api.getVoiceToken)
      .mockResolvedValueOnce('token-first')
      .mockResolvedValueOnce('token-second');

    const adapter = new GeminiLiveVoiceAdapter();
    const callbacks: VoiceAdapterCallbacks = {
      onStateChange: vi.fn(),
      onTranscript: vi.fn(),
      onAudioLevel: vi.fn(),
      onError: vi.fn(),
    };

    const p = adapter.connect('session-goaway', callbacks);
    await vi.waitFor(() => expect(MockWebSocket.instances.length).toBe(1));
    const ws1 = MockWebSocket.instances[0];
    ws1.simulateOpen();
    ws1.simulateMessage({ setupComplete: {} });
    ws1.simulateMessage({
      sessionResumptionUpdate: { newHandle: 'resumed-handle-abc', resumable: true },
    });
    await p;

    // Server fires top-level goAway
    ws1.simulateMessage({ goAway: {} });

    // Should trigger reconnect with token-second and resumption handle
    await vi.waitFor(() => expect(MockWebSocket.instances.length).toBe(2));
    const ws2 = MockWebSocket.instances[1];
    expect(ws2.url).toContain('access_token=token-second');

    ws2.simulateOpen();
    const setup2 = JSON.parse(ws2.sentMessages[0]);
    expect(setup2.setup.sessionResumption).toEqual({ handle: 'resumed-handle-abc' });
  });
});
