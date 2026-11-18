import axios from 'axios';
import { CreateSessionInput, EndReason, Feedback, ImprovementPlan, VoiceToken } from '@interview/contracts';
import type { z } from 'zod';
import { supabase } from './supabase';
import type {
  ResumeResponse,
  RolesResponse,
  SessionResponse,
  SessionsListResponse,
  TurnResponse,
  TurnsListResponse,
  TurnSpeaker,
} from '../types';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000/api';

const api = axios.create({
  baseURL: API_URL,
});

/**
 * Attach the current Supabase access token to authenticated API requests.
 *
 * The frontend deliberately does not keep or generate an application/local
 * authentication token. Supabase Auth is the single source of truth for the
 * browser session; the backend validates the Bearer token on protected routes.
 */
api.interceptors.request.use(async (config) => {
  try {
    const {
      data: { session },
    } = await supabase.auth.getSession();

    if (session?.access_token) {
      config.headers.Authorization = `Bearer ${session.access_token}`;
    }
  } catch (error) {
    console.error('Unable to read Supabase session:', error);
  }

  return config;
});

// Resume endpoints
export const uploadResume = async (file: File): Promise<ResumeResponse> => {
  const formData = new FormData();
  formData.append('resume', file);

  const { data } = await api.post<ResumeResponse>('/resume/analyze', formData, {
    headers: {
      'Content-Type': 'multipart/form-data',
    },
  });
  return data;
};

export const getLatestResume = async (): Promise<ResumeResponse> => {
  const { data } = await api.get<ResumeResponse>('/resume/latest');
  return data;
};

// Authenticated application-profile endpoints.
// Supabase Auth handles sign-in/sign-up/sign-out in AuthContext; these
// endpoints never receive a password from the browser.
export const getMe = async (): Promise<{ success: boolean; data: any }> => {
  const { data } = await api.get('/auth/me');
  return data;
};


export const deleteUserAccount = async (): Promise<{
  success: boolean;
  message: string;
}> => {
  await api.delete<void>('/auth/account');

  return {
    success: true,
    message: 'Account deleted successfully',
  };
};

// Download the authenticated user's personal data export.
export const exportMyData = async (): Promise<Blob> => {
  const { data } = await api.get<Blob>('/me/export', {
    responseType: 'blob',
  });
  return data;
};

// ---------------------------------------------------------------------------
// Slice A — Live Session Endpoints
// ---------------------------------------------------------------------------

export const getRoles = async (): Promise<RolesResponse> => {
  const { data } = await api.get<RolesResponse>('/sessions/roles');
  return data;
};

export const getSessions = async (): Promise<SessionsListResponse> => {
  const { data } = await api.get<SessionsListResponse>('/sessions');
  return data;
};

export const createSession = async (setup: z.input<typeof CreateSessionInput>): Promise<SessionResponse> => {
  const { data } = await api.post<SessionResponse>('/sessions', setup);
  return data;
};

export const getSession = async (sessionId: string): Promise<SessionResponse> => {
  const { data } = await api.get<SessionResponse>(`/sessions/${sessionId}`);
  return data;
};

export const getTurns = async (sessionId: string): Promise<TurnsListResponse> => {
  const { data } = await api.get<TurnsListResponse>(`/sessions/${sessionId}/turns`);
  return data;
};

export const postTurn = async (
  sessionId: string,
  speaker: TurnSpeaker,
  text: string
): Promise<TurnResponse> => {
  const { data } = await api.post<TurnResponse>(`/sessions/${sessionId}/turns`, {
    speaker,
    text,
  });
  return data;
};

// Server-generated next AI question (PK-3); the backend saves the AI turn before returning it.
export const postNextQuestion = async (
  sessionId: string,
  remainingSeconds?: number
): Promise<TurnResponse> => {
  const body = remainingSeconds !== undefined ? { remainingSeconds } : undefined;
  const { data } = await api.post<TurnResponse>(`/sessions/${sessionId}/next-question`, body);
  return data;
};

export const endSession = async (
  sessionId: string,
  endReason?: EndReason | string | null
): Promise<SessionResponse> => {
  const payload = endReason ? { endReason } : undefined;
  const { data } = await api.post<SessionResponse>(`/sessions/${sessionId}/end`, payload);
  return data;
};

export const endInterviewSession = endSession;

export const deleteSession = async (
  sessionId: string
): Promise<{ success: boolean; message?: string }> => {
  const { data } = await api.delete<{ success: boolean; message?: string }>(
    `/sessions/${sessionId}`
  );
  return data;
};

export const updateSessionKeep = async (
  sessionId: string,
  keep: boolean
): Promise<SessionResponse> => {
  const { data } = await api.patch<SessionResponse>(
    `/sessions/${sessionId}/keep`,
    { keep }
  );
  return data;
};

// Feedback — the results screen polls this until the status is not 'pending'.
// Short-lived voice token for Gemini Live (POST /api/sessions/:id/voice-token, LS3)
export const getVoiceToken = async (sessionId: string): Promise<string> => {
  const { data } = await api.post<{ success: boolean; data: VoiceToken }>(
    `/sessions/${sessionId}/voice-token`
  );
  return data.data.token;
};

// Feedback (FB3) — the results screen polls this until the status is not 'pending'.
export const getFeedback = async (sessionId: string): Promise<Feedback> => {
  const { data } = await api.get<{ success: boolean; data?: unknown }>(`/sessions/${sessionId}/feedback`);
  return Feedback.parse(data.data);
};

// Re-queues failed feedback; the reply is the feedback back in the pending state.
export const retryFeedback = async (sessionId: string): Promise<Feedback> => {
  const { data } = await api.post<{ success: boolean; data?: unknown }>(`/sessions/${sessionId}/feedback/retry`);
  return Feedback.parse(data.data);
};

// Candidate insights & improvement plan (V-5, V-6)
export const getInsights = async (): Promise<ImprovementPlan> => {
  const { data } = await api.get<{ success: boolean; data?: unknown }>('/insights');
  return ImprovementPlan.parse(data.data);
};

export const updateRoadmapProgress = async (
  actionId: string,
  completed: boolean = true
): Promise<ImprovementPlan> => {
  const { data } = await api.patch<{ success: boolean; data?: unknown }>('/insights/progress', {
    actionId,
    completed,
  });
  return ImprovementPlan.parse(data.data);
};

export default api;
