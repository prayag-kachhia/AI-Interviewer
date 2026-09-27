// sessions — public entry point. Other modules import only from this file.
// Owner: live-session pair. Voice tokens, transcript turns, ending a session.
// May import from: identity, profile. Never imports feedback; emits a session.ended job.

import { Hono } from "hono";
import { VoiceTokenResponse } from "@interview/contracts";
import { mintVoiceToken } from "./voice-provider";

export interface SessionRecord {
  id: string;
  candidateId: string;
  roleId: string;
}

// STUB (live-session slice): in-memory session records until LS2 database tables are connected.
export const STUB_SESSIONS: Record<string, SessionRecord> = {
  "test-session-1": {
    id: "test-session-1",
    candidateId: "fixed-user-id", // Matches L2 stub auth fixed user id
    roleId: "frontend-engineer",
  },
  "other-session-2": {
    id: "other-session-2",
    candidateId: "different-user-id",
    roleId: "backend-engineer",
  },
};

export interface SessionsRouterDependencies {
  getSession?: (sessionId: string) => Promise<SessionRecord | null> | SessionRecord | null;
  mintToken?: () => Promise<string>;
}

type SessionsEnv = {
  Variables: {
    userId?: string;
  };
};

export function createSessionsRouter(deps: SessionsRouterDependencies = {}) {
  const router = new Hono<SessionsEnv>();

  const getSession =
    deps.getSession ??
    ((sessionId: string) => STUB_SESSIONS[sessionId] ?? null);

  const mintToken = deps.mintToken ?? (() => mintVoiceToken());

  // POST /sessions/:id/voice-token
  router.post("/:id/voice-token", async (c) => {
    const sessionId = c.req.param("id");

    // STUB (identity slice): until ID3 auth middleware lands, use fixed-user-id from L2 stub auth.
    // Explaining cast per CONTRIBUTING.md: Hono context get() returns unknown
    const currentUserId = (c.get("userId") as string | undefined) ?? "fixed-user-id";

    const session = await getSession(sessionId);

    // FR-27: If session is missing or belongs to another candidate, return 404 (not 403)
    if (!session || session.candidateId !== currentUserId) {
      return c.json({ error: "Session not found" }, 404);
    }

    try {
      const token = await mintToken();
      const responseBody = VoiceTokenResponse.parse({ token });
      return c.json(responseBody);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Failed to mint voice token";
      return c.json({ error: message }, 500);
    }
  });

  return router;
}

export { mintVoiceToken } from "./voice-provider";
