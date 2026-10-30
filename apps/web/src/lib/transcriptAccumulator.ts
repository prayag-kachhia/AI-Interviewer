import type { TurnSpeaker } from '../types';

export interface GeminiLiveServerContent {
  interrupted?: boolean;
  turnComplete?: boolean;
  inputTranscription?: { text?: string };
  outputTranscription?: { text?: string };
  [key: string]: unknown;
}

export interface TranscriptTurnRecord {
  speaker: TurnSpeaker;
  text: string;
  timestampSec: number;
}

export type PostTurnFunction = (
  sessionId: string,
  speaker: TurnSpeaker,
  text: string,
  timestampSec: number
) => Promise<unknown>;

export interface TranscriptAccumulatorOptions {
  sessionId: string;
  postTurnFn?: PostTurnFunction;
  onTurnPersisted?: (turn: TranscriptTurnRecord) => void;
  onPartialUpdate?: (speaker: TurnSpeaker | null, partialText: string) => void;
  getElapsedSeconds?: () => number;
  getSessionStatus?: () => 'LIVE' | 'ENDED';
}

/**
 * Accumulates streaming transcription chunks from Gemini Live and flushes them
 * into clean, singular turns whenever a speaker changes, turnComplete occurs,
 * or an interruption is received.
 *
 * Requirements: FR-12, FR-26 (Issue #88)
 */
export class TranscriptAccumulator {
  private sessionId: string;
  private postTurnFn?: PostTurnFunction;
  private onTurnPersisted?: (turn: TranscriptTurnRecord) => void;
  private onPartialUpdate?: (speaker: TurnSpeaker | null, partialText: string) => void;
  private getElapsedSeconds?: () => number;
  private getSessionStatus?: () => 'LIVE' | 'ENDED';

  private currentSpeaker: TurnSpeaker | null = null;
  private currentBuffer = '';
  private flushPromise: Promise<TranscriptTurnRecord | null> = Promise.resolve(null);

  constructor(options: TranscriptAccumulatorOptions) {
    this.sessionId = options.sessionId;
    this.postTurnFn = options.postTurnFn;
    this.onTurnPersisted = options.onTurnPersisted;
    this.onPartialUpdate = options.onPartialUpdate;
    this.getElapsedSeconds = options.getElapsedSeconds;
    this.getSessionStatus = options.getSessionStatus;
  }

  /**
   * Handle incoming streaming chunks for a given speaker.
   * Drops empty or whitespace-only chunks.
   * Flushes the previous turn if speaker changes.
   */
  public async handleChunk(
    speaker: TurnSpeaker,
    chunk?: string | null
  ): Promise<TranscriptTurnRecord | null> {
    if (!chunk || chunk.trim().length === 0) {
      return null;
    }

    let flushedTurn: TranscriptTurnRecord | null = null;

    // If speaker changes and we have an accumulated buffer, flush previous speaker's turn
    if (this.currentSpeaker && this.currentSpeaker !== speaker) {
      flushedTurn = await this.flushTurn();
    }

    this.currentSpeaker = speaker;
    this.currentBuffer += chunk;
    this.onPartialUpdate?.(this.currentSpeaker, this.currentBuffer);

    return flushedTurn;
  }

  /**
   * Flush and post whatever turn is currently accumulated.
   * Drops empty/whitespace-only buffers and rejects posting if session is ENDED.
   */
  public async flushTurn(): Promise<TranscriptTurnRecord | null> {
    const textToPost = this.currentBuffer.trim();
    const speakerToPost = this.currentSpeaker;

    // Reset accumulator state immediately
    this.currentBuffer = '';
    this.currentSpeaker = null;
    this.onPartialUpdate?.(null, '');

    if (!speakerToPost || textToPost.length === 0) {
      return null;
    }

    // Do not post if session is already ended
    if (this.getSessionStatus && this.getSessionStatus() === 'ENDED') {
      return null;
    }

    const timestampSec = this.getElapsedSeconds ? this.getElapsedSeconds() : 0;
    const turnRecord: TranscriptTurnRecord = {
      speaker: speakerToPost,
      text: textToPost,
      timestampSec,
    };

    // Chain execution to preserve turn order
    this.flushPromise = this.flushPromise.then(async () => {
      if (this.postTurnFn) {
        await this.postTurnFn(this.sessionId, turnRecord.speaker, turnRecord.text, turnRecord.timestampSec);
      } else {
        const { postTurn } = await import('./api');
        await postTurn(this.sessionId, turnRecord.speaker, turnRecord.text, turnRecord.timestampSec);
      }
      this.onTurnPersisted?.(turnRecord);
      return turnRecord;
    });

    return this.flushPromise;
  }

  /**
   * Triggered when an interruption occurs (e.g. Candidate interrupts AI).
   * Immediately flushes the AI's partial sentence as its own turn.
   */
  public async handleInterrupted(): Promise<TranscriptTurnRecord | null> {
    return this.flushTurn();
  }

  /**
   * Triggered when a turn completes.
   * Flushes the accumulated text.
   */
  public async handleTurnComplete(): Promise<TranscriptTurnRecord | null> {
    return this.flushTurn();
  }

  /**
   * Convenience dispatcher for Gemini Live serverContent messages.
   */
  public async processServerContent(
    serverContent?: GeminiLiveServerContent | null
  ): Promise<TranscriptTurnRecord | null> {
    if (!serverContent) return null;

    // 1. Interruption detected
    if (serverContent.interrupted) {
      return this.handleInterrupted();
    }

    // 2. Candidate input transcription
    if (serverContent.inputTranscription?.text) {
      return this.handleChunk('CANDIDATE', serverContent.inputTranscription.text);
    }

    // 3. AI output transcription
    if (serverContent.outputTranscription?.text) {
      return this.handleChunk('AI', serverContent.outputTranscription.text);
    }

    // 4. Turn completion flag
    if (serverContent.turnComplete) {
      return this.handleTurnComplete();
    }

    return null;
  }

  /**
   * Current partial line being spoken.
   */
  public getPartialText(): string {
    return this.currentBuffer;
  }

  /**
   * Current active speaker accumulating chunks.
   */
  public getCurrentSpeaker(): TurnSpeaker | null {
    return this.currentSpeaker;
  }

  /**
   * Reset the buffer without posting.
   */
  public reset(): void {
    this.currentBuffer = '';
    this.currentSpeaker = null;
    this.onPartialUpdate?.(null, '');
  }
}

