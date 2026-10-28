// The only file that talks to the voice provider (Gemini Live API).
// It mints single-use, short-lived tokens so the browser never receives the
// API key itself.

export interface VoiceProviderOptions {
  apiKey?: string;
  fetchFn?: typeof fetch;
}

interface GoogleTokenResponse {
  name: string;
}

function parseGoogleTokenResponse(data: unknown): GoogleTokenResponse {
  if (
    typeof data === 'object' &&
    data !== null &&
    'name' in data &&
    // Cast to inspect parsed JSON; the field's type is checked on the same line.
    typeof (data as Record<string, unknown>).name === 'string'
  ) {
    // Cast is safe: the check above proved name is a string.
    const name = (data as { name: string }).name;
    if (name.length > 0) {
      return { name };
    }
  }
  throw new Error('Voice provider response did not contain a valid token string');
}

export async function mintVoiceToken(options: VoiceProviderOptions = {}): Promise<string> {
  const apiKey = options.apiKey ?? process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is not configured');
  }

  const fetchImpl = options.fetchFn ?? fetch;
  const now = Date.now();

  const response = await fetchImpl('https://generativelanguage.googleapis.com/v1beta/auth_tokens', {
    method: 'POST',
    headers: {
      'x-goog-api-key': apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      uses: 1, // Single-use session
      expireTime: new Date(now + 30 * 60 * 1000).toISOString(), // 30 min duration
      newSessionExpireTime: new Date(now + 2 * 60 * 1000).toISOString(), // Must start within 2 min
    }),
  });

  if (!response.ok) {
    // Detailed for the server log only; the controller never sends this to the browser.
    const errorBody = await response.text();
    throw new Error(`Voice provider token request failed with status ${response.status}: ${errorBody}`);
  }

  const parsed = parseGoogleTokenResponse(await response.json());
  return parsed.name;
}
