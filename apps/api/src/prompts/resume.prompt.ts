export const getResumeAnalysisPrompt = (extractedText: string): string => {
  return `
You are an expert AI recruiter and resume analyzer.
Your task is to analyze the provided document text and extract structured candidate information.

Please read the following text and determine whether it represents a genuine resume, CV, or candidate profile.

RULES:
1. First, evaluate whether this document appears to be a legitimate resume, CV, or candidate profile:
   - Set "looksLikeResume": true if the document appears to be a genuine resume, CV, or candidate profile containing professional/academic background, skills, or career history.
   - Set "looksLikeResume": false if the document is clearly NOT a resume (for example: a restaurant menu, invoice, receipt, bill, legal contract, terms of service, syllabus, newspaper article, arbitrary code or documentation, or random non-resume document).
2. ONLY extract information present in the resume. Do NOT hallucinate or invent qualifications.
3. If "looksLikeResume" is false or information is missing for a field, return an empty string "" or an empty array [] depending on the expected type.
4. Keep summaries concise.
5. Output valid JSON only, exactly matching the structure below. Do not wrap it in markdown code blocks, just raw JSON.

EXPECTED JSON STRUCTURE:
{
  "looksLikeResume": true,
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
