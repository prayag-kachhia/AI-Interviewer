import '@testing-library/jest-dom/vitest';
import { test, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { InterviewRoom } from './InterviewRoom';
import { InterviewCountdown } from './InterviewCountdown';
import { DEFAULT_TIME_LIMIT_MIN } from './useInterview';
import * as api from '../../lib/api';

vi.mock('../../lib/api', () => ({
  getSession: vi.fn(),
  endSession: vi.fn(),
  postTurn: vi.fn(),
}));

vi.mock('../../lib/voiceAdapter', () => ({
  createVoiceSessionAdapter: () => ({
    providerLabel: 'Mock',
    isExternalProvider: false,
    isSpeechRecognitionSupported: true,
    connect: vi.fn().mockResolvedValue(undefined),
    speakAiQuestion: vi.fn().mockResolvedValue(undefined),
    startListening: vi.fn().mockResolvedValue(undefined),
    finishCandidateTurn: vi.fn(),
    setMuted: vi.fn(),
    disconnect: vi.fn(),
  }),
}));

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

function renderRoom() {
  return render(
    <MemoryRouter initialEntries={['/interview/sess-123']}>
      <Routes>
        <Route path="/interview/:sessionId" element={<InterviewRoom />} />
        <Route path="/interview/:sessionId/feedback" element={<p>Feedback page</p>} />
      </Routes>
    </MemoryRouter>
  );
}

beforeEach(() => {
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
  renderRoom();

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
  renderRoom();

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
  renderRoom();

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
  renderRoom();

  await waitFor(() => {
    expect(api.endSession).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Feedback page')).toBeInTheDocument();
  });
});
