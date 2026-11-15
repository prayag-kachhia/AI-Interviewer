import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, test, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { InterviewRoom } from './InterviewRoom';
import { InterviewCountdown } from './InterviewCountdown';
import { DEFAULT_TIME_LIMIT_MIN } from './useInterview';
import * as api from '../../lib/api';
import type { VoiceAdapterCallbacks } from '../../lib/voiceAdapter';
import type { TurnData } from '../../types';

const mockState = vi.hoisted(() => ({
  liveInstances: [] as Array<{
    sessionId: string;
    callbacks: VoiceAdapterCallbacks;
    sendText: ReturnType<typeof vi.fn>;
    setMuted: ReturnType<typeof vi.fn>;
    disconnect: ReturnType<typeof vi.fn>;
  }>,
  browserInstances: [] as Array<{
    sessionId: string;
    callbacks: VoiceAdapterCallbacks;
    speakAiQuestion: ReturnType<typeof vi.fn>;
    finishCandidateTurn: ReturnType<typeof vi.fn>;
    setMuted: ReturnType<typeof vi.fn>;
    sendText: ReturnType<typeof vi.fn>;
    disconnect: ReturnType<typeof vi.fn>;
  }>,
}));

vi.mock('../../lib/api', () => ({
  getSession: vi.fn(),
  postTurn: vi.fn(),
  postNextQuestion: vi.fn(),
  endSession: vi.fn(),
}));

vi.mock('../../lib/geminiLiveAdapter', () => {
  class MockGeminiLiveVoiceAdapter {
    public readonly providerLabel = 'Google Gemini Live';
    public readonly isExternalProvider = true;
    public readonly isSpeechRecognitionSupported = true;
    public callbacks!: VoiceAdapterCallbacks;
    public sessionId = '';
    public sendText = vi.fn();
    public setMuted = vi.fn();
    public disconnect = vi.fn();

    async connect(sessionId: string, callbacks: VoiceAdapterCallbacks): Promise<void> {
      this.sessionId = sessionId;
      this.callbacks = callbacks;
      mockState.liveInstances.push(this);
      callbacks.onStateChange('IDLE');
    }
  }

  return { GeminiLiveVoiceAdapter: MockGeminiLiveVoiceAdapter };
});

vi.mock('../../lib/voiceAdapter', () => {
  class MockBrowserWebSpeechVoiceAdapter {
    public readonly providerLabel = 'Browser Web Speech Audio';
    public readonly isExternalProvider = false;
    public readonly isSpeechRecognitionSupported = true;
    public callbacks!: VoiceAdapterCallbacks;
    public sessionId = '';
    public speakAiQuestion = vi.fn(async () => {
      this.callbacks.onStateChange('LISTENING');
    });
    public finishCandidateTurn = vi.fn();
    public setMuted = vi.fn();
    public sendText = vi.fn();
    public disconnect = vi.fn();

    async connect(sessionId: string, callbacks: VoiceAdapterCallbacks): Promise<void> {
      this.sessionId = sessionId;
      this.callbacks = callbacks;
      mockState.browserInstances.push(this);
      callbacks.onStateChange('IDLE');
    }
  }

  return { BrowserWebSpeechVoiceAdapter: MockBrowserWebSpeechVoiceAdapter };
});

function makeSession(startedAt = new Date().toISOString()) {
  return {
    success: true,
    data: {
      id: 'sess-123',
      userId: 'usr-1',
      role: 'software-engineer',
      status: 'LIVE' as const,
      startedAt,
      endedAt: null,
      turns: [],
    },
  };
}

function makeTurn(overrides: Partial<TurnData> = {}): TurnData {
  return {
    id: 'turn-1',
    sessionId: 's1',
    speaker: 'AI',
    text: 'Default AI question?',
    timestampSec: 1.5,
    turnIndex: 1,
    createdAt: '2026-11-11T05:00:00.000Z',
    ...overrides,
  };
}

function renderRoom(sessionId = 's1') {
  return render(
    <MemoryRouter initialEntries={[`/interview/${sessionId}`]}>
      <Routes>
        <Route path="/interview/:sessionId" element={<InterviewRoom />} />
        <Route path="/interview/:sessionId/feedback" element={<p>Feedback page</p>} />
      </Routes>
    </MemoryRouter>
  );
}

beforeEach(() => {
  mockState.liveInstances.length = 0;
  mockState.browserInstances.length = 0;
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
  vi.clearAllMocks();
});

test.each([
  { elapsed: 0, clock: '15:00', label: 'Time Remaining', pct: '0', variant: 'primary' },
  { elapsed: 750, clock: '02:30', label: 'Wrapping Up Soon', pct: '83', variant: 'warning' },
  { elapsed: 860, clock: '00:40', label: 'Final Minute — Concluding', pct: '96', variant: 'danger' },
  { elapsed: 900, clock: '00:00', label: 'Time Limit Reached', pct: '100', variant: 'danger' },
])('renders countdown at $elapsed s as $clock ($variant)', ({ elapsed, clock, label, pct, variant }) => {
  render(<InterviewCountdown elapsed={elapsed} timeLimitMin={DEFAULT_TIME_LIMIT_MIN} />);

  const timer = screen.getByRole('timer');
  expect(timer).toHaveTextContent(clock);
  expect(timer).not.toHaveAttribute('aria-live');
  expect(screen.getByText(label)).toBeInTheDocument();

  const bar = screen.getByRole('progressbar');
  expect(bar).toHaveAttribute('aria-valuenow', pct);
  expect(bar.querySelector('.interview-progress-fill')).toHaveClass(variant);
});

test('End Interview opens native dialog confirmation and cancels cleanly', async () => {
  vi.mocked(api.getSession).mockResolvedValueOnce(makeSession());
  renderRoom('sess-123');

  fireEvent.click(await screen.findByRole('button', { name: 'End Interview' }));
  const dialog = screen.getByRole('dialog');
  expect(dialog).toBeInTheDocument();
  expect(api.endSession).not.toHaveBeenCalled();

  fireEvent.click(screen.getByRole('button', { name: 'Continue Interview' }));
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: 'End Interview' }));
  fireEvent(screen.getByRole('dialog'), new Event('cancel', { cancelable: true }));
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(api.endSession).not.toHaveBeenCalled();
});

test('confirming closes dialog immediately so error banner is visible when ending fails', async () => {
  vi.mocked(api.getSession).mockResolvedValueOnce(makeSession());
  vi.mocked(api.endSession).mockRejectedValueOnce({
    response: { data: { message: 'Could not reach server' } },
  });
  renderRoom('sess-123');

  fireEvent.click(await screen.findByRole('button', { name: 'End Interview' }));
  fireEvent.click(screen.getByRole('button', { name: /Yes, End Interview/ }));

  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(await screen.findByRole('alert')).toHaveTextContent('Could not reach server');
});

test('confirming ends interview and navigates to feedback on success', async () => {
  const session = makeSession();
  vi.mocked(api.getSession).mockResolvedValueOnce(session);
  vi.mocked(api.endSession).mockResolvedValueOnce({
    success: true,
    data: { ...session.data, status: 'ENDED', endedAt: new Date().toISOString() },
  });
  renderRoom('sess-123');

  fireEvent.click(await screen.findByRole('button', { name: 'End Interview' }));
  fireEvent.click(screen.getByRole('button', { name: /Yes, End Interview/ }));

  await waitFor(() => {
    expect(api.endSession).toHaveBeenCalledWith('sess-123');
    expect(screen.getByText('Feedback page')).toBeInTheDocument();
  });
});

test('auto-ends interview once when countdown reaches zero', async () => {
  const expired = new Date(Date.now() - (DEFAULT_TIME_LIMIT_MIN * 60 + 5) * 1000).toISOString();
  const session = makeSession(expired);
  vi.mocked(api.getSession).mockResolvedValueOnce(session);
  vi.mocked(api.endSession).mockResolvedValueOnce({
    success: true,
    data: { ...session.data, status: 'ENDED', endedAt: new Date().toISOString() },
  });
  renderRoom('sess-123');

  await waitFor(() => {
    expect(api.endSession).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Feedback page')).toBeInTheDocument();
  });
});

describe('InterviewRoom voice transport wiring (VI-8, #141)', () => {
  beforeEach(() => {
    mockState.liveInstances.length = 0;
    mockState.browserInstances.length = 0;
    Element.prototype.scrollIntoView = vi.fn();

    vi.mocked(api.getSession).mockResolvedValue({
      success: true,
      data: {
        id: 's1',
        userId: 'user-1',
        role: 'software-engineer',
        status: 'LIVE',
        startedAt: new Date().toISOString(),
        endedAt: null,
        turns: [],
      },
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('connects to GeminiLiveVoiceAdapter first and initiates the opening prompt on LISTENING', async () => {
    renderRoom();

    await waitFor(() => expect(mockState.liveInstances).toHaveLength(1));
    expect(mockState.browserInstances).toHaveLength(0);

    const live = mockState.liveInstances[0];
    act(() => {
      live.callbacks.onStateChange('LISTENING');
    });

    expect(live.sendText).toHaveBeenCalledTimes(1);
    expect(api.postNextQuestion).not.toHaveBeenCalled();

    act(() => {
      live.callbacks.onTranscript({ speaker: 'AI', text: 'Hello! ', isFinal: false });
      live.callbacks.onTranscript({ speaker: 'AI', text: 'Walk me through your API.', isFinal: false });
    });

    expect(screen.getByText(/Hello! Walk me through your API\./)).toBeInTheDocument();
  });

  it('automatically falls back to BrowserWebSpeechVoiceAdapter and POST /next-question when Live fails', async () => {
    vi.mocked(api.postNextQuestion).mockResolvedValueOnce({
      success: true,
      data: makeTurn({ id: 'ai-1', text: 'Tell me about your Redis caching layer.' }),
    });

    renderRoom();
    await waitFor(() => expect(mockState.liveInstances).toHaveLength(1));

    const live = mockState.liveInstances[0];
    await act(async () => {
      live.callbacks.onError?.('Token network error');
    });

    expect(live.disconnect).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(mockState.browserInstances).toHaveLength(1));

    const browser = mockState.browserInstances[0];
    expect(screen.getByText(/switched to browser speech fallback/i)).toBeInTheDocument();
    await waitFor(() => expect(api.postNextQuestion).toHaveBeenCalledWith('s1'));
    expect(browser.speakAiQuestion).toHaveBeenCalledWith('Tell me about your Redis caching layer.');
    expect(api.postTurn).not.toHaveBeenCalledWith('s1', 'AI', expect.any(String));
    expect(screen.getByText(/"Tell me about your Redis caching layer\."/)).toBeInTheDocument();
  });

  it('saves candidate turn before requesting the next question in fallback mode', async () => {
    const callOrder: string[] = [];

    vi.mocked(api.postNextQuestion)
      .mockImplementationOnce(async () => {
        callOrder.push('next-question-1');
        return { success: true, data: makeTurn({ id: 'ai-1', text: 'Opening question?' }) };
      })
      .mockImplementationOnce(async () => {
        callOrder.push('next-question-2');
        return { success: true, data: makeTurn({ id: 'ai-2', turnIndex: 3, text: 'Follow-up on TTL?' }) };
      });

    vi.mocked(api.postTurn).mockImplementationOnce(async (_sid, speaker, text) => {
      callOrder.push(`postTurn-${speaker}`);
      return {
        success: true,
        data: makeTurn({ id: 'cand-1', speaker: 'CANDIDATE', turnIndex: 2, text }),
      };
    });

    renderRoom();
    await waitFor(() => expect(mockState.liveInstances).toHaveLength(1));

    await act(async () => {
      mockState.liveInstances[0].callbacks.onError?.('WebSocket dropped');
    });

    await waitFor(() => expect(mockState.browserInstances).toHaveLength(1));
    const browser = mockState.browserInstances[0];

    await act(async () => {
      browser.callbacks.onTranscript({
        speaker: 'CANDIDATE',
        text: 'We used write-through caching in Redis.',
        isFinal: true,
      });
    });

    await waitFor(() => expect(browser.speakAiQuestion).toHaveBeenCalledWith('Follow-up on TTL?'));
    expect(callOrder).toEqual(['next-question-1', 'postTurn-CANDIDATE', 'next-question-2']);
  });

  it('speaks an existing unanswered AI turn on fallback resume without generating a duplicate question', async () => {
    vi.mocked(api.getSession).mockResolvedValueOnce({
      success: true,
      data: {
        id: 's1',
        userId: 'user-1',
        role: 'software-engineer',
        status: 'LIVE',
        startedAt: new Date().toISOString(),
        endedAt: null,
        turns: [makeTurn({ id: 'ai-existing', text: 'Existing AI prompt from before reload?' })],
      },
    });

    renderRoom();
    await waitFor(() => expect(mockState.liveInstances).toHaveLength(1));

    await act(async () => {
      mockState.liveInstances[0].callbacks.onError?.('Live unavailable');
    });

    await waitFor(() => expect(mockState.browserInstances).toHaveLength(1));
    const browser = mockState.browserInstances[0];

    await waitFor(() =>
      expect(browser.speakAiQuestion).toHaveBeenCalledWith('Existing AI prompt from before reload?')
    );
    expect(api.postNextQuestion).not.toHaveBeenCalled();
  });

  it('disconnects the active fallback adapter on unmount after switching from Live', async () => {
    vi.mocked(api.postNextQuestion).mockResolvedValueOnce({
      success: true,
      data: makeTurn({ id: 'ai-1', text: 'Question 1?' }),
    });

    const { unmount } = renderRoom();
    await waitFor(() => expect(mockState.liveInstances).toHaveLength(1));

    await act(async () => {
      mockState.liveInstances[0].callbacks.onError?.('Token unavailable');
    });

    await waitFor(() => expect(mockState.browserInstances).toHaveLength(1));
    const browser = mockState.browserInstances[0];

    unmount();
    expect(browser.disconnect).toHaveBeenCalledTimes(1);
  });

  describe('thinking-silence prompts (VI-6, #145)', () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    it('sends one thinking prompt after 9 s of quiet following an AI question and does not repeat after encouragement', async () => {
      renderRoom();
      await waitFor(() => expect(mockState.liveInstances).toHaveLength(1));

      vi.useFakeTimers();
      const live = mockState.liveInstances[0];

      // Opening LISTENING sends the intro cue only; no thinking prompt before AI asks Q1.
      act(() => {
        live.callbacks.onStateChange('LISTENING');
      });
      expect(live.sendText).toHaveBeenCalledTimes(1);

      await act(async () => {
        await vi.advanceTimersByTimeAsync(9000);
      });
      expect(live.sendText).toHaveBeenCalledTimes(1);

      // AI finishes asking Q1 and waits for the candidate.
      act(() => {
        live.callbacks.onStateChange('AI_SPEAKING');
        live.callbacks.onTranscript({ speaker: 'AI', text: 'Explain Redis eviction policies.', isFinal: false });
        live.callbacks.onStateChange('LISTENING');
      });

      // Quiet mic hum below threshold (0.03) must not delay the 9 s countdown.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(3000);
      });
      act(() => {
        live.callbacks.onAudioLevel?.(0.01);
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(5999);
      });
      expect(live.sendText).toHaveBeenCalledTimes(1);

      await act(async () => {
        await vi.advanceTimersByTimeAsync(1);
      });
      expect(live.sendText).toHaveBeenCalledTimes(2);
      expect(live.sendText).toHaveBeenLastCalledWith(
        '[the candidate is thinking; offer brief encouragement]'
      );

      // Encouragement reply from AI without candidate speech must not re-arm another prompt on Q1.
      act(() => {
        live.callbacks.onStateChange('AI_SPEAKING');
        live.callbacks.onTranscript({ speaker: 'AI', text: 'Take your time.', isFinal: false });
        live.callbacks.onStateChange('LISTENING');
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(15000);
      });
      expect(live.sendText).toHaveBeenCalledTimes(2);
    });

    it('resets the countdown when mic audio rises above threshold and re-arms on the next question', async () => {
      renderRoom();
      await waitFor(() => expect(mockState.liveInstances).toHaveLength(1));

      vi.useFakeTimers();
      const live = mockState.liveInstances[0];

      act(() => {
        live.callbacks.onStateChange('LISTENING');
        live.callbacks.onStateChange('AI_SPEAKING');
        live.callbacks.onTranscript({ speaker: 'AI', text: 'Question 1?', isFinal: false });
        live.callbacks.onStateChange('LISTENING');
      });

      // Loud audio above threshold resets the 9 s timer.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(6000);
      });
      act(() => {
        live.callbacks.onAudioLevel?.(0.15);
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(5000);
      });
      expect(live.sendText).toHaveBeenCalledTimes(1);

      await act(async () => {
        await vi.advanceTimersByTimeAsync(4000);
      });
      expect(live.sendText).toHaveBeenCalledTimes(2);

      // Candidate answers, then AI asks Q2 — silent pause on Q2 triggers one fresh prompt.
      act(() => {
        live.callbacks.onTranscript({ speaker: 'CANDIDATE', text: 'LRU evicts least recently used keys.', isFinal: false });
        live.callbacks.onStateChange('AI_SPEAKING');
        live.callbacks.onTranscript({ speaker: 'AI', text: 'Question 2?', isFinal: false });
        live.callbacks.onStateChange('LISTENING');
      });

      await act(async () => {
        await vi.advanceTimersByTimeAsync(9000);
      });
      expect(live.sendText).toHaveBeenCalledTimes(3);
      expect(live.sendText).toHaveBeenLastCalledWith(
        '[the candidate is thinking; offer brief encouragement]'
      );
    });

    it('does not prompt while muted or after switching to browser speech fallback', async () => {
      vi.mocked(api.postNextQuestion).mockResolvedValueOnce({
        success: true,
        data: makeTurn({ id: 'ai-1', text: 'Fallback question?' }),
      });

      renderRoom();
      await waitFor(() => expect(mockState.liveInstances).toHaveLength(1));

      vi.useFakeTimers();
      const live = mockState.liveInstances[0];

      act(() => {
        live.callbacks.onStateChange('LISTENING');
        live.callbacks.onStateChange('AI_SPEAKING');
        live.callbacks.onTranscript({ speaker: 'AI', text: 'Live Q1?', isFinal: false });
        live.callbacks.onStateChange('LISTENING');
      });

      fireEvent.click(screen.getByRole('button', { name: 'Mute Mic' }));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(12000);
      });
      expect(live.sendText).toHaveBeenCalledTimes(1);

      // Unmuting resumes the 9 s silence countdown, then fallback disables it.
      fireEvent.click(screen.getByRole('button', { name: 'Unmute Mic' }));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(8999);
      });
      expect(live.sendText).toHaveBeenCalledTimes(1);

      // Switching to browser fallback clears any Live timer and never calls fallback.sendText.
      await act(async () => {
        live.callbacks.onError?.('Network failure');
      });
      expect(mockState.browserInstances).toHaveLength(1);

      await act(async () => {
        await vi.advanceTimersByTimeAsync(15000);
      });
      expect(live.sendText).toHaveBeenCalledTimes(1);
      expect(mockState.browserInstances[0].sendText).not.toHaveBeenCalled();
    });
  });

  describe('Typed interview mode (PK-4, #156)', () => {
    it('skips microphone and voice adapter setup, displays typed badge, and requests opening question', async () => {
      vi.mocked(api.getSession).mockResolvedValueOnce({
        success: true,
        data: {
          id: 'typed-sess-1',
          userId: 'usr-1',
          role: 'software-engineer',
          mode: 'typed',
          status: 'LIVE',
          startedAt: new Date().toISOString(),
          endedAt: null,
          turns: [],
        },
      });

      vi.mocked(api.postNextQuestion).mockResolvedValueOnce({
        success: true,
        data: {
          id: 'turn-1',
          sessionId: 'typed-sess-1',
          speaker: 'AI',
          text: 'Welcome to your typed interview. Describe your experience with Node.js.',
          turnIndex: 1,
          timestampSec: 0,
          createdAt: new Date().toISOString(),
        },
      });

      renderRoom('typed-sess-1');

      // Microphone adapters are completely bypassed
      expect(mockState.liveInstances).toHaveLength(0);
      expect(mockState.browserInstances).toHaveLength(0);

      // Header indicates typed mode
      expect(await screen.findByText(/typed mode/i)).toBeInTheDocument();

      // Automatically requested opening question
      await waitFor(() => {
        expect(api.postNextQuestion).toHaveBeenCalledWith('typed-sess-1');
        expect(
          screen.getByText('"Welcome to your typed interview. Describe your experience with Node.js."')
        ).toBeInTheDocument();
      });

      // Renders typed answer card, not microphone card
      expect(screen.getByRole('textbox', { name: /Type your interview answer/i })).toBeInTheDocument();
      expect(screen.queryByText('Your Microphone')).not.toBeInTheDocument();
    });

    it('candidate types answer, calls postTurn and postNextQuestion, and repeats loop', async () => {
      vi.mocked(api.getSession).mockResolvedValueOnce({
        success: true,
        data: {
          id: 'typed-sess-2',
          userId: 'usr-1',
          role: 'software-engineer',
          mode: 'typed',
          status: 'LIVE',
          startedAt: new Date().toISOString(),
          endedAt: null,
          turns: [
            {
              id: 'turn-1',
              sessionId: 'typed-sess-2',
              speaker: 'AI',
              text: 'What are the main advantages of TypeScript?',
              turnIndex: 1,
              timestampSec: 0,
              createdAt: new Date().toISOString(),
            },
          ],
        },
      });

      vi.mocked(api.postTurn).mockResolvedValueOnce({
        success: true,
        data: {
          id: 'turn-2',
          sessionId: 'typed-sess-2',
          speaker: 'CANDIDATE',
          text: 'TypeScript provides static typing and early error detection.',
          turnIndex: 2,
          timestampSec: 10,
          createdAt: new Date().toISOString(),
        },
      });

      vi.mocked(api.postNextQuestion).mockResolvedValueOnce({
        success: true,
        data: {
          id: 'turn-3',
          sessionId: 'typed-sess-2',
          speaker: 'AI',
          text: 'Great. How do you handle asynchronous operations in TypeScript?',
          turnIndex: 3,
          timestampSec: 15,
          createdAt: new Date().toISOString(),
        },
      });

      renderRoom('typed-sess-2');

      expect(
        await screen.findByText('"What are the main advantages of TypeScript?"')
      ).toBeInTheDocument();

      const textarea = screen.getByRole('textbox', { name: /Type your interview answer/i });
      fireEvent.change(textarea, {
        target: { value: 'TypeScript provides static typing and early error detection.' },
      });

      const submitBtn = screen.getByRole('button', { name: /Submit Answer/i });
      expect(submitBtn).toBeEnabled();
      fireEvent.click(submitBtn);

      await waitFor(() => {
        expect(api.postTurn).toHaveBeenCalledWith(
          'typed-sess-2',
          'CANDIDATE',
          'TypeScript provides static typing and early error detection.'
        );
        expect(api.postNextQuestion).toHaveBeenCalledWith('typed-sess-2');
      });

      // Next question arrives and is displayed
      expect(
        await screen.findByText(
          '"Great. How do you handle asynchronous operations in TypeScript?"'
        )
      ).toBeInTheDocument();

      // Textarea resets ready for next answer
      expect(textarea).toHaveValue('');
    });

    it('dynamically switches from voice mode to typed mode via Type instead', async () => {
      vi.mocked(api.getSession).mockResolvedValueOnce({
        success: true,
        data: {
          id: 'voice-to-typed',
          userId: 'usr-1',
          role: 'software-engineer',
          mode: 'voice',
          status: 'LIVE',
          startedAt: new Date().toISOString(),
          endedAt: null,
          turns: [],
        },
      });

      vi.mocked(api.postNextQuestion).mockResolvedValueOnce({
        success: true,
        data: {
          id: 'turn-next-1',
          sessionId: 'voice-to-typed',
          speaker: 'AI',
          text: 'Opening question after switching to typed mode.',
          turnIndex: 1,
          timestampSec: 0,
          createdAt: new Date().toISOString(),
        },
      });

      renderRoom('voice-to-typed');

      // Starts in voice mode with GeminiLive
      await waitFor(() => expect(mockState.liveInstances).toHaveLength(1));
      const liveAdapter = mockState.liveInstances[0];

      // "Type instead" button is present
      const typeInsteadBtn = await screen.findByRole('button', { name: /Type instead/i });
      fireEvent.click(typeInsteadBtn);

      // Live adapter is disconnected
      expect(liveAdapter.disconnect).toHaveBeenCalled();

      // UI switches to typed mode
      expect(await screen.findByText(/typed mode/i)).toBeInTheDocument();
      expect(screen.getByRole('textbox', { name: /Type your interview answer/i })).toBeInTheDocument();
    });

    it('ends a typed interview and navigates to feedback', async () => {
      vi.mocked(api.getSession).mockResolvedValueOnce({
        success: true,
        data: {
          id: 'typed-end',
          userId: 'usr-1',
          role: 'software-engineer',
          mode: 'typed',
          status: 'LIVE',
          startedAt: new Date().toISOString(),
          endedAt: null,
          turns: [],
        },
      });

      vi.mocked(api.endSession).mockResolvedValueOnce({
        success: true,
        data: {
          id: 'typed-end',
          userId: 'usr-1',
          role: 'software-engineer',
          mode: 'typed',
          status: 'ENDED',
          startedAt: new Date().toISOString(),
          endedAt: new Date().toISOString(),
          turns: [],
        },
      });

      renderRoom('typed-end');

      fireEvent.click(await screen.findByRole('button', { name: 'End Interview' }));
      fireEvent.click(screen.getByRole('button', { name: /Yes, End Interview/ }));

      await waitFor(() => {
        expect(api.endSession).toHaveBeenCalledWith('typed-end');
        expect(screen.getByText('Feedback page')).toBeInTheDocument();
      });
    });
  });
});
