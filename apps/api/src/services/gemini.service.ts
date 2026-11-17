import { GoogleGenAI } from '@google/genai';
import { getResumeAnalysisPrompt } from '../prompts/resume.prompt';
import { CandidateProfile } from '@interview/contracts';
import { extractResumeHeuristically } from './heuristic.service';

export interface AnalyzeResumeResult {
  profile: CandidateProfile;
  source: 'ai' | 'heuristic';
}

export const analyzeResumeWithAI = async (extractedText: string): Promise<AnalyzeResumeResult> => {
  const apiKey = process.env.GEMINI_API_KEY?.trim();

  // If apiKey is missing or the default placeholder "AIzaSy...", use heuristic analysis directly
  const isPlaceholderKey = !apiKey || apiKey === 'AIzaSy...' || (apiKey.startsWith('AIzaSy...') && apiKey.length < 20);

  if (!isPlaceholderKey) {
    try {
      const ai = new GoogleGenAI({ apiKey, httpOptions: { timeout: 20_000 } });
      const result = await ai.models.generateContent({
        // gemini-1.5-flash was retired, so every call failed and silently fell back to the
        // heuristic parser. Pinned to a current model; override with GEMINI_RESUME_MODEL.
        model: process.env.GEMINI_RESUME_MODEL?.trim() || 'gemini-3.8-flash',
        contents: getResumeAnalysisPrompt(extractedText),
        config: { responseMimeType: 'application/json' },
      });
      const responseText = result.text ?? '';
      
      // Validate Gemini's JSON with CandidateProfile contract
      const raw = JSON.parse(responseText);
      const profile = CandidateProfile.parse(raw);

      return {
        profile,
        source: 'ai',
      };
    } catch (error: any) {
      // Logged as an error so a broken key or retired model is visible in the logs, not hidden.
      console.error('[AI Service] Gemini resume analysis failed; using the heuristic parser instead:', error.message || error);
    }
  } else {
    console.info('[AI Service] Using intelligent heuristic resume analyzer (no external Gemini API key configured).');
  }

  // Resilient fallback to heuristic parser
  return {
    profile: extractResumeHeuristically(extractedText),
    source: 'heuristic',
  };
};
