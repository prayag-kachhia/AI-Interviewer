import { GoogleGenerativeAI } from '@google/generative-ai';
import { getResumeAnalysisPrompt } from '../prompts/resume.prompt';
import { CandidateProfile } from '../types';
import { extractResumeHeuristically } from './heuristic.service';

export const analyzeResumeWithAI = async (extractedText: string): Promise<CandidateProfile> => {
  const apiKey = process.env.GEMINI_API_KEY?.trim();

  // If apiKey is missing or the default placeholder "AIzaSy...", use heuristic analysis directly
  const isPlaceholderKey = !apiKey || apiKey === 'AIzaSy...' || apiKey.startsWith('AIzaSy...') && apiKey.length < 20;

  if (!isPlaceholderKey) {
    try {
      const genAI = new GoogleGenerativeAI(apiKey);
      // Use standard supported Gemini model
      const model = genAI.getGenerativeModel({
        model: 'gemini-1.5-flash',
        generationConfig: {
          responseMimeType: 'application/json',
        },
      });

      const prompt = getResumeAnalysisPrompt(extractedText);
      const result = await model.generateContent(prompt);
      const responseText = result.response.text();
      
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
      console.warn('[AI Service] Gemini API call unsuccessful (API key invalid, rate limit, or model unavailable). Falling back to intelligent heuristic parser:', error.message || error);
    }
  } else {
    console.info('[AI Service] Using intelligent heuristic resume analyzer (no external Gemini API key configured).');
  }

  // Resilient fallback to heuristic parser
  return extractResumeHeuristically(extractedText);
};
