import type { TurnSpeaker } from '../types';

export interface FinishedTurn {
  speaker: TurnSpeaker;
  text: string;
}

export interface TranscriptAccumulatorOptions {
  onTurn: (turn: FinishedTurn) => void;
  onPartialUpdate?: (speaker: TurnSpeaker | null, partialText: string) => void;
  isSessionEnded?: () => boolean;
}

/**
 * Accumulates streaming transcription chunks and flushes them into clean turns
 * whenever the speaker changes or flushTurn is invoked.
 */
export class TranscriptAccumulator {
  private onTurn: (turn: FinishedTurn) => void;
  private onPartialUpdate?: (speaker: TurnSpeaker | null, partialText: string) => void;
  private isSessionEnded?: () => boolean;

  private currentSpeaker: TurnSpeaker | null = null;
  private currentBuffer = '';

  constructor(options: TranscriptAccumulatorOptions) {
    this.onTurn = options.onTurn;
    this.onPartialUpdate = options.onPartialUpdate;
    this.isSessionEnded = options.isSessionEnded;
  }

  /**
   * Handle incoming streaming chunks for a given speaker.
   * Drops empty or whitespace-only chunks.
   * Flushes the previous turn if the speaker changes.
   */
  public handleChunk(speaker: TurnSpeaker, chunk?: string | null): void {
    if (!chunk || chunk.trim().length === 0) {
      return;
    }

    if (this.currentSpeaker && this.currentSpeaker !== speaker) {
      this.flushTurn();
    }

    this.currentSpeaker = speaker;
    this.currentBuffer += chunk;
    this.onPartialUpdate?.(this.currentSpeaker, this.currentBuffer);
  }

  /**
   * Flush whatever turn is currently accumulated.
   * Drops empty/whitespace-only buffers and ignores calls if the session is ended.
   */
  public flushTurn(): void {
    const textToPost = this.currentBuffer.trim();
    const speakerToPost = this.currentSpeaker;

    this.currentBuffer = '';
    this.currentSpeaker = null;
    this.onPartialUpdate?.(null, '');

    if (!speakerToPost || textToPost.length === 0) {
      return;
    }

    if (this.isSessionEnded && this.isSessionEnded()) {
      return;
    }

    this.onTurn({
      speaker: speakerToPost,
      text: textToPost,
    });
  }

  /**
   * Resets internal buffer and speaker state without emitting a turn.
   */
  public reset(): void {
    this.currentBuffer = '';
    this.currentSpeaker = null;
    this.onPartialUpdate?.(null, '');
  }
}
