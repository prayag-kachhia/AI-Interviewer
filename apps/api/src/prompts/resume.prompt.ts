export const getResumeAnalysisPrompt = (extractedText: string): string => {
  return `
You are an expert AI recruiter and resume analyzer.
Your task is to extract structural information from the provided candidate's resume text.

Please read the following resume text and extract the information into a structured JSON format.

RULES:
1. ONLY extract information present in the resume. Do NOT hallucinate or invent qualifications.
2. If information is missing for a field, return an empty string "" or an empty array [] depending on the expected type.
3. Keep summaries concise.
4. Output valid JSON only, exactly matching the structure below. Do not wrap it in markdown code blocks, just raw JSON.

EXPECTED JSON STRUCTURE:
{
  "name": "Candidate's full name",
  "email": "Candidate's email address",
  "phone": "Candidate's phone number",
  "summary": "A brief 2-3 sentence professional summary based on the resume",
  "education": ["Degree from University (Year)", ...],
  "skills": ["Skill 1", "Skill 2", ...],
  "projects": ["Project Name: Brief description", ...],
  "experience": ["Role at Company (Duration): Brief description", ...],
  "certifications": ["Certification Name", ...],
  "achievements": ["Achievement 1", ...],
  "languages": ["Language 1", ...]
}

RESUME TEXT:
"""
${extractedText}
"""
`;
};
