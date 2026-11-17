export type {
  CandidateProfile,
  Role,
  SessionStatus,
  TurnSpeaker,
  InterviewMode,
  ImprovementPlan,
  TopicPlan,
  PlanAction,
  TopicScore,
  LearningResource,
  InsightTopic,
  UpdateRoadmapProgressInput,
  CategoryScore,
} from '@interview/contracts';
import type { CandidateProfile, Role, Session, Turn, ImprovementPlan, CategoryScore } from '@interview/contracts';

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
  source?: 'ai' | 'heuristic';
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

export interface HistorySession extends Session {
  overallScore?: number | null;
  categoryScores?: CategoryScore[] | null;
}

export type SessionData = HistorySession;

export interface SessionsListResponse {
  success: boolean;
  message?: string;
  data?: HistorySession[];
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

export interface InsightsResponse {
  success: boolean;
  message?: string;
  data?: ImprovementPlan;
}
