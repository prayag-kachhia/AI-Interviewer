import React, { useState } from 'react';
import { Link } from 'react-router';
import {
  PhoneOff,
  Loader2,
  AlertCircle,
  CheckCircle2,
  ArrowLeft,
} from 'lucide-react';
import { useInterview, formatClock } from './useInterview';
import { InterviewerCard } from './InterviewerCard';
import { MicrophoneCard } from './MicrophoneCard';
import { TypedResponseCard } from './TypedResponseCard';
import { TypedAnswerBox } from './TypedAnswerBox';
import { TranscriptPanel } from './TranscriptPanel';
import { InterviewCountdown } from './InterviewCountdown';
import { EndConfirmationDialog } from './EndConfirmationDialog';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import './InterviewRoom.css';

export const InterviewRoom: React.FC = () => {
  const {
    sessionId,
    roleLabel,
    status,
    mode,
    typedAnswer,
    setTypedAnswer,
    submittingTyped,
    switchToTypedMode,
    handleTypedSubmit,
    endedAt,
    turns,
    elapsed,
    timeLimitMin,
    remainingSeconds,
    loading,
    notFound,
    error,
    voiceWarning,
    isAiSpeaking,
    isCandidateSpeaking,
    isListening,
    isReconnecting,
    isMuted,
    audioLevel,
    liveCandidateSpeech,
    currentAiQuestion,
    interviewComplete,
    savingTurn,
    ending,
    showAccessibilityFallback,
    setShowAccessibilityFallback,
    fallbackSpeechInput,
    setFallbackSpeechInput,
    transcriptEndRef,
    handleToggleMute,
    handleFinishSpeaking,
    handleReplayAiQuestion,
    handleFallbackSpokenSubmit,
    handleEndInterview,
    navigate,
  } = useInterview();

  const [isEndDialogOpen, setIsEndDialogOpen] = useState(false);

  const handleConfirmEnd = () => {
    setIsEndDialogOpen(false);
    void handleEndInterview();
  };

  if (loading) {
    return (
      <div className="min-h-[60vh] flex flex-col items-center justify-center gap-3">
        <Loader2 className="size-10 text-primary animate-spin" />
        <p className="text-sm font-medium text-muted-foreground">
          Connecting to your interview room...
        </p>
      </div>
    );
  }

  if (notFound) {
    return (
      <div className="max-w-md mx-auto my-12 px-4">
        <Card className="p-6 text-center flex flex-col items-center gap-4">
          <Alert variant="error" className="text-left">
            <AlertCircle className="size-4" />
            <AlertDescription>
              Interview session not found or inaccessible.
            </AlertDescription>
          </Alert>
          <p className="text-sm text-muted-foreground">
            This session may not exist or belongs to a different candidate account.
          </p>
          <Button asChild className="w-full">
            <Link to="/new-interview">Start a New Interview</Link>
          </Button>
        </Card>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto px-4 py-6 flex flex-col gap-5">
      {/* Top Header Bar */}
      <div className="flex flex-wrap justify-between items-center gap-4 pb-2 border-b border-border/60">
        <div className="flex flex-col gap-1.5">
          <div className="flex flex-wrap items-center gap-2.5">
            <h2 className="font-display text-2xl font-bold tracking-tight text-foreground capitalize m-0">
              AI Interview — {roleLabel}
            </h2>
            <Badge variant={status === 'LIVE' ? 'live' : 'ended'}>
              {status === 'LIVE' ? `LIVE • ${formatClock(elapsed)}` : 'ENDED'}
            </Badge>
            {mode === 'typed' && (
              <Badge variant="outline" className="text-xs uppercase tracking-wider font-semibold">
                Typed Mode
              </Badge>
            )}
          </div>
          <p className="text-xs text-muted-foreground m-0">
            Session ID: <code className="font-mono bg-secondary px-1.5 py-0.5 rounded text-foreground">{sessionId}</code> • {turns.length} transcript{' '}
            {turns.length === 1 ? 'turn' : 'turns'} recorded
          </p>
        </div>

        {status === 'LIVE' ? (
          <Button
            type="button"
            variant="destructive"
            onClick={() => setIsEndDialogOpen(true)}
            disabled={ending}
            loading={ending}
            className="gap-2"
          >
            <PhoneOff className="size-4" />
            End Interview
          </Button>
        ) : (
          <Button
            type="button"
            variant="outline"
            onClick={() => navigate('/dashboard')}
            className="gap-2"
          >
            <ArrowLeft className="size-4" />
            Back to Dashboard
          </Button>
        )}
      </div>

      {/* Error & Warning Banners */}
      {error && (
        <Alert variant="error">
          <AlertCircle className="size-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {isReconnecting && (
        <Alert variant="warning">
          <Loader2 className="size-4 animate-spin" />
          <AlertDescription>Reconnecting… Please hold on.</AlertDescription>
        </Alert>
      )}

      {voiceWarning && status === 'LIVE' && !isReconnecting && (
        <Alert variant="info">
          <AlertCircle className="size-4" />
          <AlertDescription>{voiceWarning}</AlertDescription>
        </Alert>
      )}

      {/* Ended Confirmation Banner */}
      {status === 'ENDED' && (
        <Card className="p-6 border-success/40 bg-success/5 gap-0">
          <div className="flex items-start gap-4">
            <div className="size-10 rounded-full bg-success/15 text-success flex items-center justify-center shrink-0">
              <CheckCircle2 className="size-6" />
            </div>
            <div className="flex-1 flex flex-col gap-2">
              <h3 className="font-display text-lg font-semibold text-foreground m-0">
                Interview Ended — Queued for Feedback Evaluation
              </h3>
              <p className="text-sm text-muted-foreground leading-relaxed m-0">
                Your session has been marked <strong>ENDED</strong> and a{' '}
                <code className="font-mono text-xs bg-muted px-1 rounded">session.ended</code> job has been
                recorded in the database for the Feedback module to evaluate your transcript.
              </p>
              <div className="flex flex-wrap gap-2.5 mt-2">
                <Button asChild size="sm">
                  <Link to="/new-interview">Practice Another Role</Link>
                </Button>
                <Button variant="outline" asChild size="sm">
                  <Link to="/dashboard">Return to Dashboard</Link>
                </Button>
              </div>
              {endedAt && (
                <p className="text-xs text-muted-foreground mt-1">
                  Ended at {new Date(endedAt).toLocaleTimeString()}
                </p>
              )}
            </div>
          </div>
        </Card>
      )}

      {/* Primary Studio Stage */}
      {status === 'LIVE' && (
        <>
          <InterviewCountdown elapsed={elapsed} timeLimitMin={timeLimitMin} />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5 mb-2">
            <InterviewerCard
              isAiSpeaking={isAiSpeaking}
              interviewComplete={interviewComplete}
              currentAiQuestion={currentAiQuestion}
              onReplayAiQuestion={handleReplayAiQuestion}
            />
            {mode === 'typed' ? (
              <TypedResponseCard
                value={typedAnswer}
                onChange={setTypedAnswer}
                onSubmit={handleTypedSubmit}
                disabled={savingTurn || submittingTyped}
                submitting={savingTurn || submittingTyped}
                interviewComplete={interviewComplete}
              />
            ) : (
              <MicrophoneCard
                isMuted={isMuted}
                isListening={isListening}
                isCandidateSpeaking={isCandidateSpeaking}
                audioLevel={audioLevel}
                liveCandidateSpeech={liveCandidateSpeech}
                interviewComplete={interviewComplete}
                savingTurn={savingTurn}
                isAiSpeaking={isAiSpeaking}
                onToggleMute={handleToggleMute}
                onFinishSpeaking={handleFinishSpeaking}
              />
            )}
          </div>
        </>
      )}

      <EndConfirmationDialog
        isOpen={isEndDialogOpen}
        onClose={() => setIsEndDialogOpen(false)}
        onConfirm={handleConfirmEnd}
        remainingSeconds={remainingSeconds}
      />

      {/* Collapsible Accessibility / Simulated Speech Trigger */}
      {status === 'LIVE' && !interviewComplete && mode === 'voice' && (
        <TypedAnswerBox
          show={showAccessibilityFallback}
          onToggleShow={() => setShowAccessibilityFallback((prev) => !prev)}
          value={fallbackSpeechInput}
          onChange={setFallbackSpeechInput}
          onSubmit={handleFallbackSpokenSubmit}
          disabled={savingTurn || isAiSpeaking}
          savingTurn={savingTurn}
          onSwitchToTyped={switchToTypedMode}
        />
      )}

      {/* Live Stored Transcript Drawer */}
      <TranscriptPanel
        turns={turns}
        transcriptEndRef={transcriptEndRef}
      />
    </div>
  );
};
