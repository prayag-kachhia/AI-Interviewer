import { describe, expect, test } from "bun:test";
import { createApp } from "../../app";
import { VoiceTokenResponse } from "@interview/contracts";

describe("POST /sessions/:id/voice-token", () => {
  const app = createApp("http://localhost:5173");

  test("given the candidate's own session, when a token is requested, then a short-lived token comes back", async () => {
    // test-session-1 belongs to fixed-user-id in STUB_SESSIONS
    const res = await app.request("/sessions/test-session-1/voice-token", {
      method: "POST",
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    const parsed = VoiceTokenResponse.safeParse(body);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.token.length).toBeGreaterThan(0);
    }
  });

  test("given another candidate's session, then the API returns 404 (FR-27)", async () => {
    // other-session-2 belongs to different-user-id in STUB_SESSIONS
    const res = await app.request("/sessions/other-session-2/voice-token", {
      method: "POST",
    });

    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body).toEqual({ error: "Session not found" });
  });

  test("given an unknown session id, then the API returns 404", async () => {
    const res = await app.request("/sessions/non-existent-session-id/voice-token", {
      method: "POST",
    });

    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body).toEqual({ error: "Session not found" });
  });

  test("the provider API key never appears in any response (NFR-09)", async () => {
    const res = await app.request("/sessions/test-session-1/voice-token", {
      method: "POST",
    });

    const bodyText = await res.text();
    const apiKey = process.env.GEMINI_API_KEY;
    if (apiKey) {
      expect(bodyText).not.toContain(apiKey);
    }
  });
});
