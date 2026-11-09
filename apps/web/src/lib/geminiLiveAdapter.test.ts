import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { GeminiLiveVoiceAdapter } from './geminiLiveAdapter';
import { getVoiceToken } from './api';
import type { VoiceAdapterCallbacks } from './voiceAdapter';

vi.mock('./api', () => ({
  getVoiceToken: vi.fn(),
}));

const mockPlaybackQueue = { enqueue: vi.fn(), stop: vi.fn() };

vi.mock('./audio', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./audio')>()),
  PlaybackQueue: class {
    constructor() {
      return mockPlaybackQueue;
    }
  },
}));

class MockWebSocket {
  static instances: MockWebSocket[] = [];
  static CONNECTING = 0;
  static OPEN = 1;

  readyState = MockWebSocket.CONNECTING;
  sentMessages: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;

  url: string;

  constructor(url: string) {
    this.url = url;
    MockWebSocket.instances.push(this);
  }

  send(data: string) {
    this.sentMessages.push(data);
  }

  close() {
    this.readyState = 3;
    this.onclose?.();
  }

  simulateOpen() {
    this.readyState = MockWebSocket.OPEN;
    this.onopen?.();
  }

  simulateMessage(message: unknown) {
    this.onmessage?.({ data: JSON.stringify(message) });
  }

  sent() {
    return this.sentMessages.map((message) => JSON.parse(message));
  }
}

type AudioProcessHandler = (event: { inputBuffer: { getChannelData: () => Float32Array } }) => void;

class MockScriptProcessor {
  connect = vi.fn();
  disconnect = vi.fn();
  onaudioprocess: AudioProcessHandler | null = null;
}

class MockAudioContext {
  static instances: MockAudioContext[] = [];

  state = 'running';
  destination = {};
  processor = new MockScriptProcessor();
  resume = vi.fn();
  close = vi.fn().mockResolvedValue(undefined);
  createMediaStreamSource = vi.fn(() => ({ connect: vi.fn() }));
  createAnalyser = vi.fn(() => ({
    frequencyBinCount: 128,
    getByteFrequencyData: vi.fn(),
    connect: vi.fn(),
    disconnect: vi.fn(),
  }));
  createScriptProcessor = vi.fn(() => this.processor);

  constructor() {
    MockAudioContext.instances.push(this);
  }
}

const micTrack = { stop: vi.fn() };
const micStream = { getTracks: () => [micTrack] };
const getUserMedia = vi.fn();

function makeCallbacks(): VoiceAdapterCallbacks {
  return { onStateChange: vi.fn(), onTranscript: vi.fn(), onAudioLevel: vi.fn(), onError: vi.fn() };
}

async function connectReady(sessionId = 'session-1') {
  const adapter = new GeminiLiveVoiceAdapter();
  const callbacks = makeCallbacks();
  await adapter.connect(sessionId, callbacks);
  const ws = MockWebSocket.instances[MockWebSocket.instances.length - 1];
  ws.simulateOpen();
  ws.simulateMessage({ setupComplete: {} });
  return { adapter, callbacks, ws };
}

describe('GeminiLiveVoiceAdapter (VI-1, #130)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    MockWebSocket.instances = [];
    MockAudioContext.instances = [];
    vi.stubGlobal('WebSocket', MockWebSocket);
    vi.stubGlobal('AudioContext', MockAudioContext);
    Object.defineProperty(navigator, 'mediaDevices', {
      value: { getUserMedia },
      configurable: true,
    });
    getUserMedia.mockResolvedValue(micStream);
    vi.mocked(getVoiceToken).mockResolvedValue('test-token-123');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sends setup without model or systemInstruction, and streams the mic only after setupComplete', async () => {
    const adapter = new GeminiLiveVoiceAdapter();
    const callbacks = makeCallbacks();
    await adapter.connect('session-1', callbacks);

    const ws = MockWebSocket.instances[0];
    expect(ws.url).toContain('access_token=test-token-123');

    ws.simulateOpen();
    const [{ setup }] = ws.sent();
    expect(setup.generationConfig.responseModalities).toEqual(['AUDIO']);
    expect(setup.model).toBeUndefined();
    expect(setup.systemInstruction).toBeUndefined();
    expect(MockAudioContext.instances).toHaveLength(1); // output only, no mic capture yet

    ws.simulateMessage({ setupComplete: {} });
    expect(MockAudioContext.instances).toHaveLength(2);
    expect(callbacks.onStateChange).toHaveBeenLastCalledWith('LISTENING');
  });

  it('plays a spoken AI turn and reports both transcripts', async () => {
    const { callbacks, ws } = await connectReady();

    ws.simulateMessage({
      serverContent: {
        outputTranscription: { text: 'Hello, welcome to your mock interview.' },
        modelTurn: { parts: [{ inlineData: { mimeType: 'audio/pcm;rate=24000', data: 'AQID' } }] },
      },
    });
    expect(callbacks.onTranscript).toHaveBeenCalledWith({
      speaker: 'AI',
      text: 'Hello, welcome to your mock interview.',
      isFinal: false,
    });
    expect(callbacks.onStateChange).toHaveBeenLastCalledWith('AI_SPEAKING');
    expect(mockPlaybackQueue.enqueue).toHaveBeenCalled();

    ws.simulateMessage({ serverContent: { inputTranscription: { text: 'Thank you for having me.' } } });
    expect(callbacks.onTranscript).toHaveBeenCalledWith({
      speaker: 'CANDIDATE',
      text: 'Thank you for having me.',
      isFinal: false,
    });

    ws.simulateMessage({ serverContent: { turnComplete: true } });
    expect(callbacks.onStateChange).toHaveBeenLastCalledWith('LISTENING');
  });

  it('stops playback at once when the candidate interrupts', async () => {
    const { callbacks, ws } = await connectReady();

    ws.simulateMessage({ serverContent: { interrupted: true } });

    expect(mockPlaybackQueue.stop).toHaveBeenCalled();
    expect(callbacks.onStateChange).toHaveBeenLastCalledWith('LISTENING');
  });

  it('sends a text cue into the live session', async () => {
    const { adapter, ws } = await connectReady();
    ws.sentMessages = [];

    adapter.sendText('[the candidate is thinking; offer brief encouragement]');

    expect(ws.sent()).toEqual([
      {
        clientContent: {
          turns: [{ role: 'user', parts: [{ text: '[the candidate is thinking; offer brief encouragement]' }] }],
          turnComplete: true,
        },
      },
    ]);
  });

  it('sends mic audio while unmuted and nothing while muted', async () => {
    const { adapter, callbacks, ws } = await connectReady();
    const { onaudioprocess } = MockAudioContext.instances[1].processor;
    const audioEvent = { inputBuffer: { getChannelData: () => new Float32Array([0, 0.5]) } };
    ws.sentMessages = [];

    onaudioprocess?.(audioEvent);
    expect(ws.sent()[0].realtimeInput.audio.mimeType).toBe('audio/pcm;rate=16000');

    adapter.setMuted(true);
    ws.sentMessages = [];
    onaudioprocess?.(audioEvent);
    expect(ws.sentMessages).toHaveLength(0);
    expect(callbacks.onAudioLevel).toHaveBeenLastCalledWith(0);
  });

  it('releases the mic, playback and stored handle on disconnect', async () => {
    const { adapter, callbacks, ws } = await connectReady();
    ws.simulateMessage({ sessionResumptionUpdate: { newHandle: 'handle-123', resumable: true } });
    expect(sessionStorage.getItem('gemini_resumption_session-1')).toBe('handle-123');

    adapter.disconnect();

    expect(callbacks.onStateChange).toHaveBeenLastCalledWith('IDLE');
    expect(micTrack.stop).toHaveBeenCalled();
    expect(mockPlaybackQueue.stop).toHaveBeenCalled();
    expect(ws.readyState).toBe(3);
    expect(sessionStorage.getItem('gemini_resumption_session-1')).toBeNull();
  });

  it('opens nothing when disconnected while waiting for the microphone', async () => {
    let grantMic: (stream: typeof micStream) => void = () => {};
    getUserMedia.mockReturnValue(
      new Promise((resolve) => {
        grantMic = resolve;
      })
    );
    const adapter = new GeminiLiveVoiceAdapter();
    const connecting = adapter.connect('session-1', makeCallbacks());
    await vi.waitFor(() => expect(getUserMedia).toHaveBeenCalled());

    adapter.disconnect();
    grantMic(micStream);
    await connecting;

    expect(MockWebSocket.instances).toHaveLength(0);
    expect(micTrack.stop).toHaveBeenCalled();
  });

  it('fails with ERROR when the voice token cannot be fetched', async () => {
    vi.mocked(getVoiceToken).mockRejectedValue(new Error('Token network error'));
    const callbacks = makeCallbacks();

    await new GeminiLiveVoiceAdapter().connect('session-fail', callbacks);

    expect(callbacks.onError).toHaveBeenCalledWith('Token network error');
    expect(callbacks.onStateChange).toHaveBeenLastCalledWith('ERROR');
  });

  describe('session resumption', () => {
    it('resumes with the stored handle on GoAway, without going back to IDLE', async () => {
      vi.mocked(getVoiceToken).mockResolvedValueOnce('token-first').mockResolvedValueOnce('token-second');
      const { callbacks, ws: ws1 } = await connectReady('session-goaway');
      ws1.simulateMessage({ sessionResumptionUpdate: { newHandle: 'handle-abc', resumable: true } });

      ws1.simulateMessage({ goAway: {} });

      await vi.waitFor(() => expect(MockWebSocket.instances).toHaveLength(2));
      const ws2 = MockWebSocket.instances[1];
      expect(ws2.url).toContain('access_token=token-second');
      ws2.simulateOpen();
      expect(ws2.sent()[0].setup.sessionResumption).toEqual({ handle: 'handle-abc' });
      expect(vi.mocked(callbacks.onStateChange).mock.calls.filter(([s]) => s === 'IDLE')).toHaveLength(1);
    });

    it('resumes after a page reload with the handle from sessionStorage', async () => {
      sessionStorage.setItem('gemini_resumption_session-reload', 'stored-handle');

      const adapter = new GeminiLiveVoiceAdapter();
      await adapter.connect('session-reload', makeCallbacks());
      const ws = MockWebSocket.instances[0];
      ws.simulateOpen();

      expect(ws.sent()[0].setup.sessionResumption).toEqual({ handle: 'stored-handle' });
    });

    it('ignores a handle that is not resumable', async () => {
      const { ws } = await connectReady();

      ws.simulateMessage({ sessionResumptionUpdate: { newHandle: 'not-yet', resumable: false } });

      expect(sessionStorage.getItem('gemini_resumption_session-1')).toBeNull();
    });

    it('fails instead of reconnecting when the socket drops without a handle', async () => {
      const { callbacks, ws } = await connectReady();

      ws.close();

      expect(MockWebSocket.instances).toHaveLength(1);
      expect(callbacks.onError).toHaveBeenCalledWith('Gemini Live WebSocket disconnected unexpectedly');
      expect(callbacks.onStateChange).toHaveBeenLastCalledWith('ERROR');
    });

    it('does not retry when the microphone is denied during a resume', async () => {
      sessionStorage.setItem('gemini_resumption_session-1', 'stored-handle');
      getUserMedia.mockRejectedValue(new Error('Permission denied'));
      const callbacks = makeCallbacks();

      await new GeminiLiveVoiceAdapter().connect('session-1', callbacks);

      expect(getVoiceToken).toHaveBeenCalledTimes(1);
      expect(callbacks.onError).toHaveBeenCalledWith('Permission denied');
    });

    it('gives up after 3 failed reconnects', async () => {
      const { callbacks, ws } = await connectReady();
      ws.simulateMessage({ sessionResumptionUpdate: { newHandle: 'handle-abc', resumable: true } });

      ws.close();
      for (let attempt = 2; attempt <= 4; attempt++) {
        await vi.waitFor(() => expect(MockWebSocket.instances).toHaveLength(attempt));
        MockWebSocket.instances[attempt - 1].close();
      }

      expect(MockWebSocket.instances).toHaveLength(4);
      expect(callbacks.onError).toHaveBeenCalledWith('Reconnection failed after 3 attempts');
      expect(callbacks.onStateChange).toHaveBeenLastCalledWith('ERROR');
    });
  });
});
