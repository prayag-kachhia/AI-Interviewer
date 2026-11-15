export type { CandidateProfile, Role, SessionStatus, TurnSpeaker } from '@interview/contracts';
import type { CandidateProfile, Role, Session, Turn } from '@interview/contracts';

export interface User {
  id: string;
  name: string;
  email: string;
}

export interface AuthResponse {
  success: boolean;
  message?: string;
  data?: {
    token: string;
    user: User;
  };
}

export interface ResumeData {
  resumeId: string;
  fileName: string;
  createdAt: string;
  profile: CandidateProfile;
}

export interface ResumeResponse {
  success: boolean;
  message?: string;
  data?: ResumeData;
}

// ---------------------------------------------------------------------------
// Slice A — Live Session
// ---------------------------------------------------------------------------

export type InterviewVoiceState =
  | 'IDLE'
  | 'AI_SPEAKING'
  | 'LISTENING'
  | 'CANDIDATE_SPEAKING'
  | 'PROCESSING'
  | 'RECONNECTING'
  | 'ERROR';

export type TurnData = Turn;

export type SessionData = Session;

export interface SessionsListResponse {
  success: boolean;
  message?: string;
  data?: SessionData[];
}

export interface RolesResponse {
  success: boolean;
  message?: string;
  data?: Role[];
}

export interface SessionResponse {
  success: boolean;
  message?: string;
  data?: SessionData;
}

export interface TurnResponse {
  success: boolean;
  message?: string;
  data?: TurnData;
}

export interface TurnsListResponse {
  success: boolean;
  message?: string;
  data?: TurnData[];
}
