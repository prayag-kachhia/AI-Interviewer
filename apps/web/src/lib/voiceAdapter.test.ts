import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BrowserWebSpeechVoiceAdapter, type VoiceAdapterCallbacks } from './voiceAdapter';

interface MockSpeechRecognitionResult {
  isFinal: boolean;
  0: { transcript: string };
}

interface MockSpeechRecognitionEvent {
  resultIndex: number;
  results: MockSpeechRecognitionResult[];
}

class MockSpeechRecognition {
  static instances: MockSpeechRecognition[] = [];

  continuous = false;
  interimResults = false;
  lang = '';
  onresult: ((event: MockSpeechRecognitionEvent) => void) | null = null;
  onerror: ((event: { error: string }) => void) | null = null;
  onend: (() => void) | null = null;

  start = vi.fn();
  stop = vi.fn();

  constructor() {
    MockSpeechRecognition.instances.push(this);
  }

  simulateResult(transcript: string, isFinal = true) {
    this.onresult?.({
      resultIndex: 0,
      results: [{ isFinal, 0: { transcript } }],
    });
  }
}

class MockUtterance {
  static instances: MockUtterance[] = [];

  text: string;
  rate = 1;
  pitch = 1;
  onend: (() => void) | null = null;
  onerror: (() => void) | null = null;

  constructor(text: string) {
    this.text = text;
    MockUtterance.instances.push(this);
  }
}

class MockAudioContext {
  createMediaStreamSource = vi.fn(() => ({ connect: vi.fn() }));
  createAnalyser = vi.fn(() => ({
    fftSize: 256,
    frequencyBinCount: 16,
    getByteFrequencyData: vi.fn(),
  }));
  close = vi.fn().mockResolvedValue(undefined);
}

const micTrack = { stop: vi.fn(), enabled: true };
const micStream = {
  getTracks: () => [micTrack],
  getAudioTracks: () => [micTrack],
};

function makeCallbacks(): VoiceAdapterCallbacks {
  return {
    onStateChange: vi.fn(),
    onTranscript: vi.fn(),
    onAudioLevel: vi.fn(),
    onError: vi.fn(),
  };
}

function setSpeechSynthesis(value: unknown) {
  Object.defineProperty(window, 'speechSynthesis', {
    value,
    configurable: true,
    writable: true,
  });
}

function makeMockSpeechSynthesis(voices: Array<{ name: string }> = [{ name: 'English Voice' }]) {
  const listeners = new Map<string, Set<() => void>>();
  let currentVoices = voices;

  return {
    cancel: vi.fn(),
    speak: vi.fn((utterance: MockUtterance) => {
      utterance.onend?.();
    }),
    getVoices: vi.fn(() => currentVoices),
    addEventListener: vi.fn((type: string, listener: () => void) => {
      const set = listeners.get(type) ?? new Set<() => void>();
      set.add(listener);
      listeners.set(type, set);
    }),
    removeEventListener: vi.fn((type: string, listener: () => void) => {
      listeners.get(type)?.delete(listener);
    }),
    setVoices(nextVoices: Array<{ name: string }>) {
      currentVoices = nextVoices;
    },
    emitVoicesChanged() {
      listeners.get('voiceschanged')?.forEach((fn) => fn());
    },
  };
}

describe('BrowserWebSpeechVoiceAdapter', () => {
  const originalSpeechSynthesisDesc = Object.getOwnPropertyDescriptor(window, 'speechSynthesis');

  beforeEach(() => {
    MockSpeechRecognition.instances = [];
    MockUtterance.instances = [];
    vi.clearAllMocks();

    vi.stubGlobal('SpeechRecognition', MockSpeechRecognition);
    vi.stubGlobal('SpeechSynthesisUtterance', MockUtterance);
    vi.stubGlobal('AudioContext', MockAudioContext);
    vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1));
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    Object.defineProperty(navigator, 'mediaDevices', {
      value: { getUserMedia: vi.fn().mockResolvedValue(micStream) },
      configurable: true,
    });
    setSpeechSynthesis(makeMockSpeechSynthesis());
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    if (originalSpeechSynthesisDesc) {
      Object.defineProperty(window, 'speechSynthesis', originalSpeechSynthesisDesc);
    } else {
      Reflect.deleteProperty(window, 'speechSynthesis');
    }
  });

  it('ignores late speech recognition results arriving after finishCandidateTurn stops listening', async () => {
    vi.useFakeTimers();
    const adapter = new BrowserWebSpeechVoiceAdapter();
    const callbacks = makeCallbacks();
    await adapter.connect('s1', callbacks);

    await adapter.speakAiQuestion('First question?');
    const recognition = MockSpeechRecognition.instances[0];

    recognition.simulateResult('I built a caching service in Redis.');
    adapter.finishCandidateTurn();

    expect(callbacks.onTranscript).toHaveBeenLastCalledWith({
      speaker: 'CANDIDATE',
      text: 'I built a caching service in Redis.',
      isFinal: true,
    });
    expect(callbacks.onStateChange).toHaveBeenLastCalledWith('PROCESSING');

    vi.mocked(callbacks.onTranscript).mockClear();
    vi.mocked(callbacks.onStateChange).mockClear();

    // Browser speech APIs can fire a delayed onresult right after recognition.stop().
    recognition.simulateResult('in Redis.', true);
    await vi.advanceTimersByTimeAsync(6000);

    expect(callbacks.onTranscript).not.toHaveBeenCalled();
    expect(callbacks.onStateChange).not.toHaveBeenCalled();
  });

  it('clears stale partial text and pending silence timer when a new AI question starts', async () => {
    vi.useFakeTimers();
    const adapter = new BrowserWebSpeechVoiceAdapter();
    const callbacks = makeCallbacks();
    await adapter.connect('s1', callbacks);

    await adapter.speakAiQuestion('First question?');
    const recognition = MockSpeechRecognition.instances[0];

    // Candidate starts speaking partially but question changes before turn finishes.
    recognition.simulateResult('stale fragment', false);
    expect(callbacks.onTranscript).toHaveBeenLastCalledWith({
      speaker: 'CANDIDATE',
      text: 'stale fragment',
      isFinal: false,
    });

    await adapter.speakAiQuestion('Second question?');
    expect(callbacks.onTranscript).toHaveBeenCalledWith({
      speaker: 'CANDIDATE',
      text: '',
      isFinal: false,
    });

    vi.mocked(callbacks.onTranscript).mockClear();
    await vi.advanceTimersByTimeAsync(6000);
    expect(callbacks.onTranscript).not.toHaveBeenCalled();

    recognition.simulateResult('Fresh answer only.');
    adapter.finishCandidateTurn();
    expect(callbacks.onTranscript).toHaveBeenLastCalledWith({
      speaker: 'CANDIDATE',
      text: 'Fresh answer only.',
      isFinal: true,
    });
  });

  it('waits 5 seconds of silence before auto-submitting instead of 2.4 seconds, while allowing early finish', async () => {
    vi.useFakeTimers();
    const adapter = new BrowserWebSpeechVoiceAdapter();
    const callbacks = makeCallbacks();
    await adapter.connect('s1', callbacks);

    await adapter.speakAiQuestion('Tell me about Postgres indexing.');
    const recognition = MockSpeechRecognition.instances[0];

    recognition.simulateResult('We used B-tree indexes');
    await vi.advanceTimersByTimeAsync(4999);
    expect(vi.mocked(callbacks.onTranscript).mock.calls.filter(([e]) => e.isFinal)).toHaveLength(0);

    await vi.advanceTimersByTimeAsync(1);
    expect(callbacks.onTranscript).toHaveBeenLastCalledWith({
      speaker: 'CANDIDATE',
      text: 'We used B-tree indexes',
      isFinal: true,
    });

    // Clicking Done Speaking immediately submits without waiting for the 5s timer.
    await adapter.startListening();
    recognition.simulateResult('And partial indexes for hot rows.');
    adapter.finishCandidateTurn();
    expect(callbacks.onTranscript).toHaveBeenLastCalledWith({
      speaker: 'CANDIDATE',
      text: 'And partial indexes for hot rows.',
      isFinal: true,
    });
  });

  it('warns once when no speaking voices are available and moves cleanly to listening', async () => {
    const emptySynth = makeMockSpeechSynthesis([]);
    // Omit event target methods so getVoices() === [] settles immediately.
    setSpeechSynthesis({
      cancel: emptySynth.cancel,
      speak: emptySynth.speak,
      getVoices: emptySynth.getVoices,
    });

    const adapter = new BrowserWebSpeechVoiceAdapter();
    const callbacks = makeCallbacks();
    await adapter.connect('s1', callbacks);

    await adapter.speakAiQuestion('Question 1?');
    await adapter.speakAiQuestion('Question 2?');

    expect(emptySynth.speak).not.toHaveBeenCalled();
    expect(callbacks.onError).toHaveBeenCalledTimes(1);
    expect(callbacks.onError).toHaveBeenCalledWith(expect.stringMatching(/no browser speaking voices/i));
    expect(callbacks.onStateChange).toHaveBeenLastCalledWith('LISTENING');
  });

  it('waits briefly for lazy voiceschanged population before warning', async () => {
    vi.useFakeTimers();
    const synth = makeMockSpeechSynthesis([]);
    setSpeechSynthesis(synth);

    const adapter = new BrowserWebSpeechVoiceAdapter();
    const callbacks = makeCallbacks();
    await adapter.connect('s1', callbacks);

    const speakPromise = adapter.speakAiQuestion('Question 1?');
    await vi.advanceTimersByTimeAsync(50);
    synth.setVoices([{ name: 'Chrome OS Voice' }]);
    synth.emitVoicesChanged();
    await speakPromise;

    expect(callbacks.onError).not.toHaveBeenCalled();
    expect(synth.speak).toHaveBeenCalledTimes(1);
  });

  it('warns once when speechSynthesis is unavailable in the browser', async () => {
    Reflect.deleteProperty(window, 'speechSynthesis');

    const adapter = new BrowserWebSpeechVoiceAdapter();
    const callbacks = makeCallbacks();
    await adapter.connect('s1', callbacks);

    await adapter.speakAiQuestion('Question 1?');

    expect(callbacks.onError).toHaveBeenCalledTimes(1);
    expect(callbacks.onError).toHaveBeenCalledWith(expect.stringMatching(/no browser speaking voices/i));
    expect(callbacks.onStateChange).toHaveBeenLastCalledWith('LISTENING');
  });

  it('does not start recognition if disconnected while AI speech is playing', async () => {
    const synth = makeMockSpeechSynthesis([{ name: 'English Voice' }]);
    synth.speak.mockImplementation(() => {});
    setSpeechSynthesis(synth);

    const adapter = new BrowserWebSpeechVoiceAdapter();
    const callbacks = makeCallbacks();
    await adapter.connect('s1', callbacks);

    const recognition = MockSpeechRecognition.instances[0];
    const speaking = adapter.speakAiQuestion('Closing question?');
    await vi.waitFor(() => expect(MockUtterance.instances).toHaveLength(1));
    const utterance = MockUtterance.instances[0];

    adapter.disconnect();
    utterance.onerror?.();
    await speaking;

    expect(recognition.start).not.toHaveBeenCalled();
  });
});
