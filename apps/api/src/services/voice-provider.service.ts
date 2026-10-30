// The only file that talks to the voice provider (Gemini Live API).
// It mints single-use, short-lived tokens so the browser never receives the
// API key itself.

export class VoiceProviderTimeoutError extends Error {
  constructor(message = 'Voice service unavailable, try again') {
    super(message);
    this.name = 'VoiceProviderTimeoutError';
  }
}

export interface VoiceProviderOptions {
  apiKey?: string;
  fetchFn?: typeof fetch;
  timeoutMs?: number;
  briefing?: string;
  model?: string;
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
  const timeoutMs = options.timeoutMs ?? 5000;
  const now = Date.now();

  // Checked on 2026-10-30: v1beta is the working Google Generative Language endpoint for ephemeral auth_tokens with bidiGenerateContentSetup.
  const endpoint = 'https://generativelanguage.googleapis.com/v1beta/auth_tokens';
  const signal = AbortSignal.timeout(timeoutMs);

  const model = options.model ?? process.env.GEMINI_LIVE_MODEL ?? 'models/gemini-3.8-live';
  const briefing = options.briefing;

  const requestBody: Record<string, unknown> = {
    uses: 1, // Single-use session
    expireTime: new Date(now + 30 * 60 * 1000).toISOString(), // 30 min duration
    newSessionExpireTime: new Date(now + 2 * 60 * 1000).toISOString(), // Must start within 2 min
  };

  // Lock the briefing, audio modality, and context compression into the token (FR-13, DR-02, NFR-09)
  // In the REST API, the SDK's liveConnectConstraints translates to bidiGenerateContentSetup and fieldMask.
  if (briefing) {
    requestBody.bidiGenerateContentSetup = {
      model,
      generationConfig: {
        responseModalities: ['AUDIO'],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: {
              voiceName: 'Puck',
            },
          },
        },
      },
      systemInstruction: {
        parts: [{ text: briefing }],
      },
      inputAudioTranscription: {},
      outputAudioTranscription: {},
      contextWindowCompression: {
        slidingWindow: {},
      },
      sessionResumption: {},
    };
    requestBody.fieldMask =
      'model,generationConfig.responseModalities,generationConfig.speechConfig,systemInstruction.parts,inputAudioTranscription,outputAudioTranscription,contextWindowCompression.slidingWindow,sessionResumption';
  }

  let response: Response;
  try {
    response = await fetchImpl(endpoint, {
      method: 'POST',
      headers: {
        'x-goog-api-key': apiKey,
        'Content-Type': 'application/json',
      },
      signal,
      body: JSON.stringify(requestBody),
    });
  } catch (error: any) {
    if (
      error instanceof VoiceProviderTimeoutError ||
      error?.name === 'TimeoutError' ||
      error?.name === 'AbortError'
    ) {
      throw new VoiceProviderTimeoutError();
    }
    throw error;
  }

  if (!response.ok) {
    // Detailed for the server log only; the controller never sends this to the browser.
    const errorBody = await response.text();
    throw new Error(`Voice provider token request failed with status ${response.status}: ${errorBody}`);
  }

  const parsed = parseGoogleTokenResponse(await response.json());
  return parsed.name;
}
