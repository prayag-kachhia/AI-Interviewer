import '@testing-library/jest-dom/vitest';
import { describe, test, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { InterviewerCard } from './InterviewerCard';
import { MicrophoneCard } from './MicrophoneCard';
import { TranscriptPanel } from './TranscriptPanel';
import { TypedAnswerBox } from './TypedAnswerBox';
import { TypedResponseCard } from './TypedResponseCard';
import type { TurnData } from '../../types';

describe('Interview Room Cards Restyled (PK-5, #157)', () => {
  describe('InterviewerCard', () => {
    test('renders AI interviewer ready state when not speaking', () => {
      render(
        <InterviewerCard
          isAiSpeaking={false}
          interviewComplete={false}
          currentAiQuestion="Can you explain your experience with React?"
          onReplayAiQuestion={vi.fn()}
        />
      );

      expect(screen.getByText('AI Interviewer Ready')).toBeInTheDocument();
      expect(screen.getByText('AI Interviewer')).toBeInTheDocument();
      expect(
        screen.getByText('"Can you explain your experience with React?"')
      ).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Replay Spoken Question/i })).toBeEnabled();
    });

    test('renders AI speaking active state and calls replay handler', () => {
      const onReplay = vi.fn();
      render(
        <InterviewerCard
          isAiSpeaking={true}
          interviewComplete={false}
          currentAiQuestion="What are the trade-offs of microservices?"
          onReplayAiQuestion={onReplay}
        />
      );

      expect(screen.getByText('AI is speaking...')).toBeInTheDocument();
      const replayBtn = screen.getByRole('button', { name: /Replay Spoken Question/i });
      expect(replayBtn).toBeDisabled();
    });
  });

  describe('MicrophoneCard', () => {
    test('renders muted state correctly and toggles mute', () => {
      const onToggleMute = vi.fn();
      render(
        <MicrophoneCard
          isMuted={true}
          isListening={false}
          isCandidateSpeaking={false}
          audioLevel={0}
          liveCandidateSpeech=""
          interviewComplete={false}
          savingTurn={false}
          isAiSpeaking={false}
          onToggleMute={onToggleMute}
          onFinishSpeaking={vi.fn()}
        />
      );

      expect(screen.getByText('Microphone Muted')).toBeInTheDocument();
      const unmuteBtn = screen.getByRole('button', { name: /Unmute Mic/i });
      fireEvent.click(unmuteBtn);
      expect(onToggleMute).toHaveBeenCalledTimes(1);
    });

    test('renders candidate speaking state with live speech and done speaking button', () => {
      const onFinish = vi.fn();
      render(
        <MicrophoneCard
          isMuted={false}
          isListening={true}
          isCandidateSpeaking={true}
          audioLevel={0.5}
          liveCandidateSpeech="I have built full stack apps with Node and PostgreSQL."
          interviewComplete={false}
          savingTurn={false}
          isAiSpeaking={false}
          onToggleMute={vi.fn()}
          onFinishSpeaking={onFinish}
        />
      );

      expect(screen.getByText('Candidate Speaking')).toBeInTheDocument();
      expect(
        screen.getByText('"I have built full stack apps with Node and PostgreSQL."')
      ).toBeInTheDocument();

      const doneBtn = screen.getByRole('button', { name: /Done Speaking/i });
      fireEvent.click(doneBtn);
      expect(onFinish).toHaveBeenCalledTimes(1);
    });
  });

  describe('TranscriptPanel', () => {
    test('renders empty state when no turns exist and toggles panel visibility', () => {
      const ref = { current: null };
      render(<TranscriptPanel turns={[]} transcriptEndRef={ref} />);

      expect(screen.getByText('Recorded Session Transcript')).toBeInTheDocument();
      expect(
        screen.getByText(/Transcript turns will appear here as the AI interviewer/i)
      ).toBeInTheDocument();

      const toggleBtn = screen.getByRole('button', { name: 'Hide Transcript' });
      fireEvent.click(toggleBtn);
      expect(
        screen.queryByText(/Transcript turns will appear here/i)
      ).not.toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: 'Show Transcript' }));
      expect(
        screen.getByText(/Transcript turns will appear here/i)
      ).toBeInTheDocument();
    });

    test('renders chat bubbles for AI and Candidate turns', () => {
      const ref = { current: null };
      const turns: TurnData[] = [
        {
          id: 'turn-1',
          sessionId: 'sess-1',
          turnIndex: 1,
          speaker: 'AI',
          text: 'Welcome to your interview. Tell me about your background.',
          timestampSec: 2.5,
          createdAt: new Date().toISOString(),
        },
        {
          id: 'turn-2',
          sessionId: 'sess-1',
          turnIndex: 2,
          speaker: 'CANDIDATE',
          text: 'I am a computer science student specializing in backend systems.',
          timestampSec: 15.0,
          createdAt: new Date().toISOString(),
        },
      ];

      render(<TranscriptPanel turns={turns} transcriptEndRef={ref} />);

      expect(
        screen.getByText('Welcome to your interview. Tell me about your background.')
      ).toBeInTheDocument();
      expect(
        screen.getByText('I am a computer science student specializing in backend systems.')
      ).toBeInTheDocument();
      expect(screen.getByText(/Turn #1 • AI Interviewer/i)).toBeInTheDocument();
      expect(screen.getByText(/Turn #2 • Candidate/i)).toBeInTheDocument();
    });
  });

  describe('TypedAnswerBox', () => {
    test('toggles accessibility fallback and submits typed answer', () => {
      const onToggle = vi.fn();
      const onChange = vi.fn();
      const onSubmit = vi.fn((e) => e.preventDefault());

      const { rerender } = render(
        <TypedAnswerBox
          show={false}
          onToggleShow={onToggle}
          value=""
          onChange={onChange}
          onSubmit={onSubmit}
          disabled={false}
          savingTurn={false}
        />
      );

      const toggleBtn = screen.getByRole('button', {
        name: /Microphone unavailable\? Use spoken-turn accessibility fallback/i,
      });
      fireEvent.click(toggleBtn);
      expect(onToggle).toHaveBeenCalledTimes(1);

      rerender(
        <TypedAnswerBox
          show={true}
          onToggleShow={onToggle}
          value="My typed answer"
          onChange={onChange}
          onSubmit={onSubmit}
          disabled={false}
          savingTurn={false}
        />
      );

      expect(screen.getByDisplayValue('My typed answer')).toBeInTheDocument();
      const submitBtn = screen.getByRole('button', { name: 'Submit Spoken Turn' });
      expect(submitBtn).toBeEnabled();
      fireEvent.click(submitBtn);
      expect(onSubmit).toHaveBeenCalledTimes(1);
    });

    test('renders Type instead button when callback is provided and triggers it', () => {
      const onSwitch = vi.fn();
      render(
        <TypedAnswerBox
          show={false}
          onToggleShow={vi.fn()}
          value=""
          onChange={vi.fn()}
          onSubmit={vi.fn()}
          disabled={false}
          savingTurn={false}
          onSwitchToTyped={onSwitch}
        />
      );

      const switchBtn = screen.getByRole('button', { name: /Type instead/i });
      expect(switchBtn).toBeInTheDocument();
      fireEvent.click(switchBtn);
      expect(onSwitch).toHaveBeenCalledTimes(1);
    });
  });

  describe('TypedResponseCard (PK-4, #156)', () => {
    test('renders ready state with disabled submit when empty', () => {
      render(
        <TypedResponseCard
          value=""
          onChange={vi.fn()}
          onSubmit={vi.fn()}
          disabled={false}
          submitting={false}
          interviewComplete={false}
        />
      );

      expect(screen.getByText('Type Your Answer')).toBeInTheDocument();
      expect(screen.getByText('Your Response')).toBeInTheDocument();
      const textarea = screen.getByRole('textbox', { name: /Type your interview answer/i });
      expect(textarea).toBeInTheDocument();
      expect(textarea).toBeEnabled();

      const submitBtn = screen.getByRole('button', { name: /Submit Answer/i });
      expect(submitBtn).toBeDisabled();
    });

    test('updates value and submits on button click or Ctrl+Enter', () => {
      const onSubmit = vi.fn();
      const onChange = vi.fn();

      const { rerender } = render(
        <TypedResponseCard
          value="My scalable architecture design"
          onChange={onChange}
          onSubmit={onSubmit}
          disabled={false}
          submitting={false}
          interviewComplete={false}
        />
      );

      expect(screen.getByText('31 characters')).toBeInTheDocument();
      const submitBtn = screen.getByRole('button', { name: /Submit Answer/i });
      expect(submitBtn).toBeEnabled();

      fireEvent.click(submitBtn);
      expect(onSubmit).toHaveBeenCalledTimes(1);

      const textarea = screen.getByRole('textbox', { name: /Type your interview answer/i });
      fireEvent.keyDown(textarea, { key: 'Enter', ctrlKey: true });
      expect(onSubmit).toHaveBeenCalledTimes(2);

      // Verify submitting state
      rerender(
        <TypedResponseCard
          value="My scalable architecture design"
          onChange={onChange}
          onSubmit={onSubmit}
          disabled={false}
          submitting={true}
          interviewComplete={false}
        />
      );

      expect(screen.getByText('Saving transcript...')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Submit Answer/i })).toBeDisabled();
    });
  });
});
