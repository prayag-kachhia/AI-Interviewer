import { CandidateProfile } from '../types';

const COMMON_SKILLS = [
  'JavaScript', 'TypeScript', 'Python', 'Java', 'C++', 'C#', 'Go', 'Rust', 'Ruby', 'PHP', 'Swift', 'Kotlin',
  'HTML', 'HTML5', 'CSS', 'CSS3', 'Tailwind', 'Bootstrap', 'Sass',
  'React', 'React.js', 'Next.js', 'Vue', 'Vue.js', 'Angular', 'Svelte',
  'Node.js', 'Express', 'Express.js', 'NestJS', 'Django', 'Flask', 'FastAPI', 'Spring Boot', '.NET', 'ASP.NET',
  'REST', 'RESTful APIs', 'GraphQL', 'gRPC', 'WebSockets', 'Microservices',
  'PostgreSQL', 'MySQL', 'MongoDB', 'Redis', 'SQLite', 'Oracle', 'Cassandra', 'DynamoDB', 'Prisma', 'TypeORM',
  'Docker', 'Kubernetes', 'AWS', 'Amazon Web Services', 'Azure', 'Google Cloud', 'GCP', 'Terraform', 'CI/CD',
  'Git', 'GitHub', 'GitLab', 'Linux', 'Unix', 'Nginx', 'Apache',
  'Agile', 'Scrum', 'Jira', 'Unit Testing', 'Jest', 'Vitest', 'Cypress', 'Playwright',
  'Machine Learning', 'Deep Learning', 'Data Science', 'TensorFlow', 'PyTorch', 'Pandas', 'NumPy', 'Scikit-learn',
  'OpenAI', 'Gemini', 'LLM', 'AI', 'NLP', 'Computer Vision'
];

/**
 * Robust heuristic parser that extracts structured candidate information from resume text
 * Used as a zero-dependency fallback when Gemini API is unavailable or unconfigured.
 */
export function extractResumeHeuristically(text: string): CandidateProfile {
  const lines = text
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line.length > 0);

  // 1. Extract Email
  const emailRegex = /([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/i;
  const emailMatch = text.match(emailRegex);
  const email = emailMatch ? emailMatch[1] : '';

  // 2. Extract Phone
  const phoneRegex = /(?:(?:\+?\d{1,3}[-.\s]?)?(?:\(?\d{2,4}\)?[-.\s]?)?\d{3,4}[-.\s]?\d{3,4}(?:[-.\s]?\d{1,4})?)/;
  let phone = '';
  for (const line of lines.slice(0, 10)) {
    const cleaned = line.replace(/[^\d+() -]/g, '');
    if (cleaned.length >= 10 && /\d{4,}/.test(cleaned)) {
      phone = line.match(phoneRegex)?.[0] || '';
      if (phone) break;
    }
  }

  // 3. Extract Name
  // Usually the first non-trivial line that is not email, phone, URL, or keyword
  let name = '';
  for (const line of lines.slice(0, 6)) {
    const lower = line.toLowerCase();
    if (
      lower.includes('resume') ||
      lower.includes('curriculum') ||
      lower.includes('vitae') ||
      lower.includes('@') ||
      lower.includes('http') ||
      lower.includes('www.') ||
      lower.includes('page') ||
      /\d{5,}/.test(line)
    ) {
      continue;
    }
    // Candidate name is usually 2-4 words, capitalized
    const words = line.split(/\s+/);
    if (words.length >= 2 && words.length <= 5 && line.length < 40) {
      name = line;
      break;
    }
  }
  if (!name && lines.length > 0) {
    name = lines[0].slice(0, 35);
  }

  // 4. Section Splitting
  const sections: Record<string, string[]> = {
    summary: [],
    skills: [],
    experience: [],
    education: [],
    projects: [],
    certifications: [],
    achievements: [],
    languages: []
  };

  let currentSection = 'summary';

  const SECTION_HEADERS: Record<string, string[]> = {
    summary: ['summary', 'professional summary', 'profile', 'about me', 'objective', 'career objective'],
    skills: ['skills', 'technical skills', 'skills & competencies', 'core competencies', 'technologies', 'tech stack'],
    experience: ['experience', 'work experience', 'employment history', 'work history', 'professional experience'],
    education: ['education', 'academic background', 'academics', 'qualifications'],
    projects: ['projects', 'key projects', 'personal projects', 'notable projects', 'academic projects'],
    certifications: ['certifications', 'certificates', 'licenses', 'courses'],
    achievements: ['achievements', 'awards', 'honors', 'accomplishments'],
    languages: ['languages', 'language proficiency', 'spoken languages']
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    
    // Skip page numbers and separator artifacts
    if (/^--\s*\d+\s*of\s*\d+\s*--/i.test(line) || /^page\s*\d+/i.test(line)) {
      continue;
    }

    const colonIdx = line.indexOf(':');
    let headerCandidate = line.toLowerCase().replace(/[:#*_-]/g, '').trim();
    let inlineContent = '';

    // If there is an inline colon e.g. "Education: BS Computer Science..."
    if (colonIdx > 0 && colonIdx < 30) {
      const beforeColon = line.slice(0, colonIdx).toLowerCase().replace(/[:#*_-]/g, '').trim();
      const afterColon = line.slice(colonIdx + 1).trim();
      for (const [secName, headers] of Object.entries(SECTION_HEADERS)) {
        if (headers.some(h => beforeColon === h)) {
          headerCandidate = beforeColon;
          inlineContent = afterColon;
          break;
        }
      }
    }

    // Check if line matches any section header
    let matchedSection: string | null = null;
    for (const [secName, headers] of Object.entries(SECTION_HEADERS)) {
      if (headers.some(h => headerCandidate === h || headerCandidate.startsWith(h + ' ') || headerCandidate.endsWith(' ' + h))) {
        matchedSection = secName;
        break;
      }
    }

    if (matchedSection) {
      currentSection = matchedSection;
      if (inlineContent && sections[currentSection]) {
        sections[currentSection].push(inlineContent);
      }
      continue;
    }

    if (sections[currentSection]) {
      sections[currentSection].push(line);
    }
  }

  // 5. Extract Skills
  const extractedSkills = new Set<string>();

  // A. Check for common skills in full text
  for (const skill of COMMON_SKILLS) {
    const escaped = skill.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`\\b${escaped}\\b`, 'i');
    if (regex.test(text)) {
      extractedSkills.add(skill);
    }
  }

  // B. Parse items from skills section
  if (sections.skills.length > 0) {
    for (const line of sections.skills) {
      const parts = line.split(/[,|•·;/\n]/).map(p => p.trim());
      for (const part of parts) {
        if (part.length > 1 && part.length < 30 && !part.toLowerCase().includes('skills')) {
          extractedSkills.add(part);
        }
      }
    }
  }

  // 6. Clean and parse experience items
  const experienceItems: string[] = [];
  if (sections.experience.length > 0) {
    let currentExp = '';
    for (const line of sections.experience) {
      // Check for bullet or title separator
      if (line.startsWith('•') || line.startsWith('-') || line.startsWith('*') || /^\d{4}/.test(line)) {
        if (currentExp) experienceItems.push(currentExp);
        currentExp = line.replace(/^[•\-*]\s*/, '');
      } else {
        if (!currentExp) {
          currentExp = line;
        } else {
          currentExp += ' - ' + line;
        }
      }
    }
    if (currentExp) experienceItems.push(currentExp);
  }

  // 7. Clean and parse education items
  const educationItems: string[] = [];
  if (sections.education.length > 0) {
    for (const line of sections.education) {
      const clean = line.replace(/^[•\-*]\s*/, '').trim();
      if (clean.length > 5) {
        educationItems.push(clean);
      }
    }
  }

  // 8. Clean and parse projects
  const projectItems: string[] = [];
  if (sections.projects.length > 0) {
    let currentProj = '';
    for (const line of sections.projects) {
      if (line.startsWith('•') || line.startsWith('-') || line.startsWith('*')) {
        if (currentProj) projectItems.push(currentProj);
        currentProj = line.replace(/^[•\-*]\s*/, '');
      } else {
        if (!currentProj) {
          currentProj = line;
        } else {
          currentProj += ': ' + line;
        }
      }
    }
    if (currentProj) projectItems.push(currentProj);
  }

  // 9. Summary
  let summary = sections.summary.join(' ').slice(0, 450);
  if (!summary) {
    const topSkills = Array.from(extractedSkills).slice(0, 5).join(', ');
    summary = `${name ? name + ' is a dedicated' : 'Dedicated'} professional with experience in ${topSkills || 'technology and engineering'}. Demonstrated expertise in project delivery, problem-solving, and collaboration.`;
  }

  // 10. Languages
  const languageList = ['English', 'Spanish', 'French', 'German', 'Hindi', 'Mandarin', 'Japanese', 'Arabic'];
  const extractedLanguages = languageList.filter(lang => {
    const regex = new RegExp(`\\b${lang}\\b`, 'i');
    return regex.test(text);
  });
  if (extractedLanguages.length === 0) {
    extractedLanguages.push('English');
  }

  return {
    name: name || 'Candidate',
    email: email || '',
    phone: phone || '',
    summary,
    skills: Array.from(extractedSkills).slice(0, 25),
    education: educationItems.slice(0, 5),
    experience: experienceItems.slice(0, 8),
    projects: projectItems.slice(0, 6),
    certifications: sections.certifications.slice(0, 5),
    achievements: sections.achievements.slice(0, 5),
    languages: extractedLanguages
  };
}
