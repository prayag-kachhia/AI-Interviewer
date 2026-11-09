import { GoogleGenAI } from '@google/genai';
import { getResumeAnalysisPrompt } from '../prompts/resume.prompt';
import { CandidateProfile } from '../types';
import { extractResumeHeuristically } from './heuristic.service';

export const analyzeResumeWithAI = async (extractedText: string): Promise<CandidateProfile> => {
  const apiKey = process.env.GEMINI_API_KEY?.trim();

  // If apiKey is missing or the default placeholder "AIzaSy...", use heuristic analysis directly
  const isPlaceholderKey = !apiKey || apiKey === 'AIzaSy...' || apiKey.startsWith('AIzaSy...') && apiKey.length < 20;

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
      
      // Parse the JSON safely
      const profileData: CandidateProfile = JSON.parse(responseText);
      
      // Basic validation to ensure required fields exist
      return {
        name: profileData.name || '',
        email: profileData.email || '',
        phone: profileData.phone || '',
        summary: profileData.summary || '',
        education: Array.isArray(profileData.education) ? profileData.education : [],
        skills: Array.isArray(profileData.skills) ? profileData.skills : [],
        projects: Array.isArray(profileData.projects) ? profileData.projects : [],
        experience: Array.isArray(profileData.experience) ? profileData.experience : [],
        certifications: Array.isArray(profileData.certifications) ? profileData.certifications : [],
        achievements: Array.isArray(profileData.achievements) ? profileData.achievements : [],
        languages: Array.isArray(profileData.languages) ? profileData.languages : [],
      };
    } catch (error: any) {
      // Logged as an error so a broken key or retired model is visible in the logs, not hidden.
      console.error('[AI Service] Gemini resume analysis failed; using the heuristic parser instead:', error.message || error);
    }
  } else {
    console.info('[AI Service] Using intelligent heuristic resume analyzer (no external Gemini API key configured).');
  }

  // Resilient fallback to heuristic parser
  return extractResumeHeuristically(extractedText);
};
