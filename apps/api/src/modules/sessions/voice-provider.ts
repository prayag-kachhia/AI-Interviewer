import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

export interface VoiceProviderOptions {
  apiKey?: string;
  fetchFn?: typeof fetch;
}

interface GoogleTokenResponse {
  name: string;
}

function getApiKey(): string | undefined {
  if (process.env.GEMINI_API_KEY) {
    return process.env.GEMINI_API_KEY;
  }
  const candidates = [
    resolve(process.cwd(), "apps/api/.env"),
    resolve(process.cwd(), ".env"),
    resolve(import.meta.dir, "../../../.env"),
  ];
  for (const path of candidates) {
    if (existsSync(path)) {
      const content = readFileSync(path, "utf-8");
      for (const line of content.split("\n")) {
        const match = line.match(/^\s*GEMINI_API_KEY\s*=\s*(.+?)\s*$/);
        const val = match?.[1];
        if (val) {
          return val.replace(/^["']|["']$/g, "").trim();
        }
      }
    }
  }
  return undefined;
}

function parseGoogleTokenResponse(data: unknown): GoogleTokenResponse {
  if (
    typeof data === "object" &&
    data !== null &&
    "name" in data &&
    // Explaining cast per CONTRIBUTING.md: safely inspect dynamically parsed JSON
    typeof (data as Record<string, unknown>).name === "string"
  ) {
    // Explaining cast per CONTRIBUTING.md: validated string field above
    const name = (data as { name: string }).name;
    if (name.length > 0) {
      return { name };
    }
  }
  throw new Error("Voice provider response did not contain a valid token string");
}

// Quarantined voice provider client (Gemini Multimodal Live API).
// Mints single-use, short-lived tokens so the client never receives the master API key (NFR-09).
export async function mintVoiceToken(options: VoiceProviderOptions = {}): Promise<string> {
  const apiKey = options.apiKey ?? getApiKey();
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is not configured");
  }

  const fetchImpl = options.fetchFn ?? fetch;
  const now = Date.now();

  const response = await fetchImpl("https://generativelanguage.googleapis.com/v1beta/auth_tokens", {
    method: "POST",
    headers: {
      "x-goog-api-key": apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      uses: 1, // Single-use session
      expireTime: new Date(now + 30 * 60 * 1000).toISOString(), // 30 min duration
      newSessionExpireTime: new Date(now + 2 * 60 * 1000).toISOString(), // Must start within 2 min
    }),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Voice provider token request failed with status ${response.status}: ${errorBody}`);
  }

  const parsed = parseGoogleTokenResponse(await response.json());
  return parsed.name;
}
