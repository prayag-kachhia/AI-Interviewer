import {
  CandidateProfile,
  ResumeMatchCategoryScore,
  ResumeMatchResult,
  calculateResumeMatchOverallScore,
} from '@interview/contracts';
import { COMMON_SKILLS } from './heuristic.service';

/**
 * Standard English and job-description boilerplate stopwords to exclude
 * from term-frequency keyword extraction.
 */
const STOPWORDS = new Set([
  'a', 'about', 'above', 'across', 'after', 'afterwards', 'again', 'against', 'all',
  'almost', 'alone', 'along', 'already', 'also', 'although', 'always', 'am', 'among',
  'amongst', 'amount', 'an', 'and', 'another', 'any', 'anyhow', 'anyone', 'anything',
  'anyway', 'anywhere', 'are', 'around', 'as', 'at', 'back', 'be', 'became', 'because',
  'become', 'becomes', 'becoming', 'been', 'before', 'beforehand', 'behind', 'being',
  'below', 'beside', 'besides', 'between', 'beyond', 'both', 'bottom', 'but', 'by',
  'call', 'can', 'cannot', 'could', 'did', 'do', 'does', 'doing', 'done', 'down',
  'due', 'during', 'each', 'either', 'else', 'elsewhere', 'empty', 'enough', 'even',
  'ever', 'every', 'everyone', 'everything', 'everywhere', 'except', 'few', 'for',
  'former', 'formerly', 'from', 'front', 'full', 'further', 'get', 'give', 'go',
  'had', 'has', 'have', 'having', 'he', 'hence', 'her', 'here', 'hereafter', 'hereby',
  'herein', 'hereupon', 'hers', 'herself', 'him', 'himself', 'his', 'how', 'however',
  'hundred', 'i', 'if', 'in', 'inc', 'indeed', 'into', 'is', 'it', 'its', 'itself',
  'just', 'keep', 'last', 'latter', 'latterly', 'least', 'less', 'ltd', 'made', 'many',
  'may', 'me', 'meanwhile', 'might', 'mill', 'mine', 'more', 'moreover', 'most',
  'mostly', 'move', 'much', 'must', 'my', 'myself', 'name', 'namely', 'neither',
  'never', 'nevertheless', 'next', 'no', 'nobody', 'none', 'noone', 'nor', 'not',
  'nothing', 'now', 'nowhere', 'of', 'off', 'often', 'on', 'once', 'one', 'only',
  'onto', 'or', 'other', 'others', 'otherwise', 'our', 'ours', 'ourselves', 'out',
  'over', 'own', 'part', 'per', 'perhaps', 'please', 'put', 'rather', 're', 'same',
  'see', 'seem', 'seemed', 'seeming', 'seems', 'serious', 'several', 'she', 'should',
  'show', 'side', 'since', 'sincere', 'six', 'so', 'some', 'somehow', 'someone',
  'something', 'sometime', 'sometimes', 'somewhere', 'still', 'such', 'system',
  'take', 'ten', 'than', 'that', 'the', 'their', 'them', 'themselves', 'then',
  'thence', 'there', 'thereafter', 'thereby', 'therefore', 'therein', 'thereupon',
  'these', 'they', 'thick', 'thin', 'third', 'this', 'those', 'though', 'three',
  'through', 'throughout', 'thru', 'thus', 'to', 'together', 'too', 'top', 'toward',
  'towards', 'twelve', 'twenty', 'two', 'un', 'under', 'until', 'up', 'upon', 'us',
  'very', 'via', 'was', 'we', 'well', 'were', 'what', 'whatever', 'when', 'whence',
  'whenever', 'where', 'whereafter', 'whereas', 'whereby', 'wherein', 'whereupon',
  'wherever', 'whether', 'which', 'while', 'whither', 'who', 'whoever', 'whole',
  'whom', 'whose', 'why', 'will', 'with', 'within', 'without', 'would', 'yet',
  'you', 'your', 'yours', 'yourself', 'yourselves',
  // Common job-posting boilerplate words
  'job', 'jobs', 'description', 'role', 'roles', 'responsibilities', 'requirements',
  'qualification', 'qualifications', 'experience', 'experiences', 'skill', 'skills',
  'work', 'working', 'worker', 'team', 'teams', 'company', 'candidate', 'candidates',
  'position', 'positions', 'look', 'looks', 'looking', 'require', 'requires', 'requiring',
  'required', 'requirement', 'need', 'needs', 'needed', 'needing', 'seek', 'seeks',
  'seeking', 'sought', 'preferred', 'ability', 'abilities',
  'plus', 'strong', 'excellent', 'environment', 'join', 'apply', 'applying', 'help',
  'build', 'building', 'create', 'creating', 'year', 'years', 'day', 'days', 'opportunity',
  'opportunities', 'successful', 'degree', 'high', 'good', 'great', 'using', 'used',
  'based', 'knowledge', 'understanding', 'including', 'familiarity', 'hands', 'etc',
  'want', 'provide', 'support', 'ensure', 'perform', 'develop', 'developer', 'developers',
  'engineer', 'engineers', 'engineering', 'proven', 'track', 'record', 'level', 'bonus',
  'competitive', 'salary', 'benefits', 'equal', 'hire', 'hiring', 'ideal', 'profile',
]);

/**
 * Education / credential indicator patterns
 */
const DEGREE_INDICATORS = [
  /\b(?:bachelor|b\.?s\.?|b\.?tech\.?|b\.?e\.?|bca)\b/i,
  /\b(?:master|m\.?s\.?|m\.?tech\.?|mca|m\.?e\.?|mba)\b/i,
  /\b(?:ph\.?d\.?|doctorate)\b/i,
  /\b(?:computer science|information technology|software engineering|data science)\b/i,
  /\b(?:degree|diploma|university|college|institute|accredited)\b/i,
];

const CERTIFICATION_INDICATORS = [
  /\b(?:certified|certification|credential|licensed|license)\b/i,
  /\b(?:aws certified|azure|gcp certified|google cloud certified)\b/i,
  /\b(?:cka|ckad|pmp|cissp|comptia|ccna|ceh)\b/i,
];

export interface KeywordScorerInput {
  extractedText: string;
  parsedProfile?: CandidateProfile | string | null;
  jobDescription: string;
}

/**
 * Escapes special regex characters in a string.
 */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Builds a regex that safely matches a skill phrase at token/word boundaries,
 * properly handling programming tokens like "C++", "C#", ".NET", "Node.js", and "Go".
 */
export function createSkillRegex(skill: string): RegExp {
  const trimmed = skill.trim();
  const esc = escapeRegex(trimmed);
  const prefix = /^[a-zA-Z0-9]/.test(trimmed) ? '(?:^|[^a-zA-Z0-9])' : '(?:^|[\\s,;(\\[])';
  const suffix = /[+#]$/.test(trimmed) ? '(?![+#a-zA-Z])' : '(?![a-zA-Z0-9+#])';
  return new RegExp(prefix + esc + suffix, 'i');
}

/**
 * Parses and validates an optional CandidateProfile or raw JSON profile string.
 */
function normalizeProfile(parsedProfile?: CandidateProfile | string | null): CandidateProfile {
  if (!parsedProfile) {
    return {
      name: '',
      email: '',
      phone: '',
      summary: '',
      education: [],
      skills: [],
      projects: [],
      experience: [],
      certifications: [],
      achievements: [],
      languages: [],
    };
  }

  if (typeof parsedProfile === 'string') {
    try {
      const parsed = JSON.parse(parsedProfile);
      return CandidateProfile.parse(parsed);
    } catch {
      return {
        name: '',
        email: '',
        phone: '',
        summary: '',
        education: [],
        skills: [],
        projects: [],
        experience: [],
        certifications: [],
        achievements: [],
        languages: [],
      };
    }
  }

  try {
    return CandidateProfile.parse(parsedProfile);
  } catch {
    return {
      name: '',
      email: '',
      phone: '',
      summary: '',
      education: [],
      skills: [],
      projects: [],
      experience: [],
      certifications: [],
      achievements: [],
      languages: [],
    };
  }
}

/**
 * Extracts meaningful job-description keywords from:
 * 1. COMMON_SKILLS (from heuristic parser)
 * 2. Most frequent non-stopword terms in the job description
 *
 * Normalizes case and avoids duplicate keywords.
 */
export function extractJobKeywords(jobDescription: string): {
  skills: string[];
  terms: string[];
  all: string[];
} {
  const jd = jobDescription || '';
  const extractedSkills: string[] = [];
  const normalizedSkillsSet = new Set<string>();

  // 1. Extract matching COMMON_SKILLS (checking multi-word / longer skills first)
  const sortedSkills = [...COMMON_SKILLS].sort((a, b) => b.length - a.length);

  for (const skill of sortedSkills) {
    const rx = createSkillRegex(skill);
    if (rx.test(jd)) {
      const lower = skill.toLowerCase();
      if (!normalizedSkillsSet.has(lower)) {
        normalizedSkillsSet.add(lower);
        extractedSkills.push(skill);
      }
    }
  }

  // 2. Extract frequent non-stopword domain terms
  // Clean punctuation but keep internal hyphens or underscores
  const cleanedText = jd.replace(/[^\w\s-]/g, ' ');
  const tokens = cleanedText
    .split(/\s+/)
    .map((w) => w.trim().toLowerCase())
    .filter((w) => w.length >= 3 && /^[a-z][a-z0-9_-]+$/.test(w));

  const termCounts = new Map<string, number>();

  for (const token of tokens) {
    if (STOPWORDS.has(token) || normalizedSkillsSet.has(token)) {
      continue;
    }
    termCounts.set(token, (termCounts.get(token) || 0) + 1);
  }

  // Filter terms: words appearing >= 2 times in the JD per FR-34 specification
  const frequentTerms = Array.from(termCounts.entries())
    .filter(([, count]) => count >= 2)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([term]) => term.charAt(0).toUpperCase() + term.slice(1));

  // Combine and deduplicate case-insensitively
  const allKeywords: string[] = [];
  const seenAll = new Set<string>();

  for (const kw of [...extractedSkills, ...frequentTerms]) {
    const lower = kw.toLowerCase();
    if (!seenAll.has(lower)) {
      seenAll.add(lower);
      allKeywords.push(kw);
    }
  }

  return {
    skills: extractedSkills,
    terms: frequentTerms,
    all: allKeywords,
  };
}

/**
 * Checks whether a keyword is present in the resume text or profile.
 */
function isKeywordPresentInResume(
  keyword: string,
  resumeText: string,
  profile: CandidateProfile
): boolean {
  const rx = createSkillRegex(keyword);

  // Check raw resume text
  if (rx.test(resumeText)) {
    return true;
  }

  // Check structured profile skills
  for (const s of profile.skills) {
    if (rx.test(s) || s.trim().toLowerCase() === keyword.toLowerCase()) {
      return true;
    }
  }

  // Check experience & projects
  for (const exp of [...profile.experience, ...profile.projects]) {
    if (rx.test(exp)) {
      return true;
    }
  }

  // Check summary
  if (profile.summary && rx.test(profile.summary)) {
    return true;
  }

  return false;
}

/**
 * No-AI keyword scorer that compares an uploaded resume against a target job description (FR-34, RJ-14).
 *
 * Evaluates the 4 required categories using explainable, deterministic rules:
 * 1. Skills match (40%)
 * 2. Experience relevance (30%)
 * 3. Keyword coverage (20%)
 * 4. Education and credentials (10%)
 *
 * Computes the authoritative overall score via calculateResumeMatchOverallScore.
 */
export function scoreKeywordResumeMatch(input: KeywordScorerInput): ResumeMatchResult {
  const resumeText = input.extractedText || '';
  const jdText = (input.jobDescription || '').trim();
  const profile = normalizeProfile(input.parsedProfile);

  // 1. Extract keywords from Job Description
  const { skills: jdSkills, all: jobKeywords } = extractJobKeywords(jdText);

  // 2. Separate into matched and missing keywords
  const matchedKeywords: string[] = [];
  const missingKeywords: string[] = [];

  for (const kw of jobKeywords) {
    if (isKeywordPresentInResume(kw, resumeText, profile)) {
      matchedKeywords.push(kw);
    } else {
      missingKeywords.push(kw);
    }
  }

  // --- Category 1: Skills match (40% weight) ---
  const matchedSkillsCount = jdSkills.filter((s) =>
    isKeywordPresentInResume(s, resumeText, profile)
  ).length;

  let skillsScore = 0;
  if (jdSkills.length > 0) {
    const skillRatio = matchedSkillsCount / jdSkills.length;
    // Add bonus if candidate explicitly lists matched skills in profile.skills
    const explicitMatches = profile.skills.filter((ps) =>
      jdSkills.some((jds) => createSkillRegex(jds).test(ps) || ps.toLowerCase() === jds.toLowerCase())
    ).length;
    const explicitBonus = Math.min(10, explicitMatches * 3);
    skillsScore = Math.min(100, Math.round(skillRatio * 100 + (skillRatio > 0 ? explicitBonus : 0)));
  } else if (jobKeywords.length > 0) {
    // Fallback if no specific COMMON_SKILLS extracted
    skillsScore = Math.round((matchedKeywords.length / jobKeywords.length) * 100);
  }

  // --- Category 2: Experience relevance (30% weight) ---
  const experienceLines = [
    ...profile.experience,
    ...profile.projects,
  ];
  const combinedExpText = experienceLines.join(' ');

  // Count how many job keywords appear directly within work experience or project bullets
  const expKeywordHits = jobKeywords.filter((kw) => {
    const rx = createSkillRegex(kw);
    return rx.test(combinedExpText);
  }).length;

  let experienceScore = 0;
  if (jobKeywords.length > 0) {
    const hitRatio = expKeywordHits / jobKeywords.length;
    const structureBonus = experienceLines.length >= 3 ? 20 : experienceLines.length >= 1 ? 10 : 0;
    // Date/tenure signals in experience or resume text (e.g. "2020 - 2024", "3+ years")
    const dateSignal = /\b(?:20\d\d\s*[-–to]+\s*(?:20\d\d|present)|(?:[1-9]|10)\+?\s*years?)\b/i.test(
      resumeText
    )
      ? 10
      : 0;

    experienceScore = Math.min(100, Math.round(hitRatio * 70 + (hitRatio > 0 ? structureBonus + dateSignal : 0)));
  } else if (experienceLines.length > 0) {
    experienceScore = 60;
  }

  // --- Category 3: Keyword coverage (20% weight) ---
  let keywordScore = 0;
  if (jobKeywords.length > 0) {
    keywordScore = Math.round((matchedKeywords.length / jobKeywords.length) * 100);
  }

  // --- Category 4: Education and credentials (10% weight) ---
  const hasDegreeInResume = DEGREE_INDICATORS.some(
    (rx) => rx.test(resumeText) || profile.education.some((edu) => rx.test(edu))
  );
  const hasCertInResume = CERTIFICATION_INDICATORS.some(
    (rx) => rx.test(resumeText) || profile.certifications.some((cert) => rx.test(cert))
  );
  const jdMentionsDegree = DEGREE_INDICATORS.some((rx) => rx.test(jdText));

  let educationScore = 30; // base score for minimal candidate
  if (hasDegreeInResume) {
    educationScore = jdMentionsDegree ? 90 : 80;
    if (hasCertInResume) {
      educationScore = Math.min(100, educationScore + 10);
    }
  } else if (hasCertInResume) {
    educationScore = 60;
  } else if (profile.education.length > 0) {
    educationScore = 50;
  } else if (!resumeText.trim()) {
    educationScore = 0;
  }

  // Ensure all category scores are clamped to [0, 100]
  skillsScore = Math.min(100, Math.max(0, skillsScore));
  experienceScore = Math.min(100, Math.max(0, experienceScore));
  keywordScore = Math.min(100, Math.max(0, keywordScore));
  educationScore = Math.min(100, Math.max(0, educationScore));

  const categories: ResumeMatchCategoryScore[] = [
    {
      category: 'Skills match',
      score: skillsScore,
      comment:
        skillsScore >= 75
          ? `Strong overlap with target skills (${matchedSkillsCount}/${Math.max(1, jdSkills.length)} key skills found).`
          : skillsScore >= 40
            ? `Partial skills overlap (${matchedSkillsCount}/${Math.max(1, jdSkills.length)} key skills found).`
            : `Low overlap with core skills specified in the job description (${matchedSkillsCount}/${Math.max(1, jdSkills.length)} found).`,
    },
    {
      category: 'Experience relevance',
      score: experienceScore,
      comment:
        experienceScore >= 70
          ? `Work experience and projects strongly reflect required technologies and responsibilities.`
          : experienceScore >= 40
            ? `Some relevant experience found, but several role-specific workflows are not prominently featured.`
            : `Limited demonstrated experience with the target role's core domain technologies.`,
    },
    {
      category: 'Keyword coverage',
      score: keywordScore,
      comment:
        keywordScore >= 70
          ? `High overall keyword coverage (${matchedKeywords.length}/${Math.max(1, jobKeywords.length)} terms matched).`
          : keywordScore >= 40
            ? `Moderate keyword coverage (${matchedKeywords.length}/${Math.max(1, jobKeywords.length)} terms matched).`
            : `Low keyword coverage (${matchedKeywords.length}/${Math.max(1, jobKeywords.length)} terms matched).`,
    },
    {
      category: 'Education and credentials',
      score: educationScore,
      comment:
        educationScore >= 80
          ? `Educational qualifications align well with the target role.`
          : educationScore >= 50
            ? `Found general academic or credential references.`
            : `No specific degree or certification references detected on resume.`,
    },
  ];

  // Calculate authoritative overall score via shared formula
  const overallScore = calculateResumeMatchOverallScore(categories);

  // --- Strengths, Gaps, and Suggestions ---
  const strengths: string[] = [];
  const gaps: string[] = [];
  const suggestions: string[] = [];

  // Strengths
  if (matchedKeywords.length > 0) {
    strengths.push(`Matching keywords identified: ${matchedKeywords.slice(0, 5).join(', ')}.`);
  }
  if (skillsScore >= 70) {
    strengths.push('Demonstrates solid alignment with the required technical skills.');
  }
  if (experienceScore >= 70) {
    strengths.push('Work history and projects directly reference required technologies.');
  }
  if (educationScore >= 80) {
    strengths.push('Educational background meets or exceeds role requirements.');
  }
  if (strengths.length === 0) {
    strengths.push('Resume submitted for matching; baseline qualifications reviewed.');
  }

  // Gaps
  if (missingKeywords.length > 0) {
    gaps.push(`Key job requirements not found on resume: ${missingKeywords.slice(0, 5).join(', ')}.`);
  }
  if (skillsScore < 50 && jdSkills.length > 0) {
    gaps.push('Core skill coverage is low for the technical stack specified in the job description.');
  }
  if (experienceScore < 50) {
    gaps.push('Work experience section has limited demonstrated usage of the target role keywords.');
  }
  if (educationScore < 50 && jdMentionsDegree) {
    gaps.push('Job description indicates degree or certification preferences not clearly stated in resume.');
  }

  // Suggestions
  if (missingKeywords.length > 0) {
    suggestions.push(
      `If you have experience with ${missingKeywords.slice(0, 3).join(', ')}, highlight them in your skills and project descriptions.`
    );
  }
  if (experienceScore < 60) {
    suggestions.push(
      'Explicitly reference target technologies and measurable outcomes in your experience bullet points.'
    );
  }
  if (skillsScore >= 60 && experienceScore < 60) {
    suggestions.push(
      'Connect your listed technical skills directly to achievements in your work history.'
    );
  }
  if (suggestions.length === 0) {
    suggestions.push('Keep resume accomplishments up to date with quantifiable project metrics.');
  }

  return {
    score: overallScore,
    source: 'keywords',
    categories,
    matchedKeywords,
    missingKeywords,
    strengths,
    gaps,
    suggestions,
  };
}
