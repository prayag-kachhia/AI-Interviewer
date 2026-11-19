import { describe, it, expect } from 'vitest';
import {
  JOB_DESCRIPTION_MAX,
  CreateResumeMatchInput,
  ResumeMatch,
  ResumeMatchResult,
  RESUME_MATCH_CATEGORIES,
  calculateResumeMatchOverallScore,
} from '@interview/contracts';
import {
  scoreKeywordResumeMatch,
  extractJobKeywords,
  createSkillRegex,
} from '../services/resume-match.keywords';

describe('Resume Match — RJ-14 Contracts & Weighted Helper (#292, FR-34)', () => {
  describe('CreateResumeMatchInput schema', () => {
    it('accepts a valid job description within 4000 characters', () => {
      const input = {
        jobDescription: 'Looking for a senior backend developer with Node.js and PostgreSQL experience.',
      };
      const parsed = CreateResumeMatchInput.parse(input);
      expect(parsed.jobDescription).toBe(input.jobDescription);
    });

    it('trims surrounding whitespace from job description', () => {
      const input = {
        jobDescription: '   Senior Frontend Engineer with React and TypeScript.   ',
      };
      const parsed = CreateResumeMatchInput.parse(input);
      expect(parsed.jobDescription).toBe('Senior Frontend Engineer with React and TypeScript.');
    });

    it('accepts a valid 4000-character description (requirement 16)', () => {
      const desc4000 = 'a'.repeat(JOB_DESCRIPTION_MAX);
      const parsed = CreateResumeMatchInput.parse({ jobDescription: desc4000 });
      expect(parsed.jobDescription.length).toBe(4000);
    });

    it('rejects an empty job description (requirement 14)', () => {
      expect(() => CreateResumeMatchInput.parse({ jobDescription: '' })).toThrow();
    });

    it('rejects a whitespace-only job description', () => {
      expect(() => CreateResumeMatchInput.parse({ jobDescription: '    \n\t  ' })).toThrow();
    });

    it('rejects job descriptions longer than 4000 characters (requirement 15)', () => {
      const desc4001 = 'a'.repeat(JOB_DESCRIPTION_MAX + 1);
      expect(() => CreateResumeMatchInput.parse({ jobDescription: desc4001 })).toThrow();
    });
  });

  describe('ResumeMatch & ResumeMatchResult schemas', () => {
    it('validates a complete ResumeMatch payload', () => {
      const validMatch = {
        id: 'match-123',
        resumeId: 'resume-456',
        jobDescription: 'Looking for a full stack developer.',
        score: 82,
        source: 'keywords' as const,
        categories: [
          { category: 'Skills match', score: 85, comment: 'Strong skills match.' },
          { category: 'Experience relevance', score: 80, comment: 'Relevant past work.' },
          { category: 'Keyword coverage', score: 80, comment: 'Good coverage.' },
          { category: 'Education and credentials', score: 80, comment: 'Degree present.' },
        ],
        matchedKeywords: ['React', 'TypeScript', 'Node.js'],
        missingKeywords: ['Docker'],
        strengths: ['Strong match on React and TypeScript.'],
        gaps: ['Missing Docker.'],
        suggestions: ['Add Docker projects if experienced.'],
        createdAt: '2026-11-19T10:00:00.000Z',
      };

      const parsed = ResumeMatch.parse(validMatch);
      expect(parsed.id).toBe('match-123');
      expect(parsed.score).toBe(82);
      expect(parsed.source).toBe('keywords');
    });

    it('validates a ResumeMatchResult payload without persistence fields', () => {
      const validResult = {
        score: 75,
        source: 'keywords' as const,
        categories: [
          { category: 'Skills match', score: 80, comment: 'Good.' },
          { category: 'Experience relevance', score: 70, comment: 'Good.' },
          { category: 'Keyword coverage', score: 75, comment: 'Good.' },
          { category: 'Education and credentials', score: 75, comment: 'Good.' },
        ],
        matchedKeywords: ['Python'],
        missingKeywords: ['AWS'],
        strengths: ['Python match.'],
        gaps: ['AWS missing.'],
        suggestions: ['Learn AWS.'],
      };

      const parsed = ResumeMatchResult.parse(validResult);
      expect(parsed.score).toBe(75);
      expect(parsed.source).toBe('keywords');
    });

    it('rejects scores outside 0–100 in ResumeMatch', () => {
      const invalid = {
        id: 'm1',
        resumeId: 'r1',
        jobDescription: 'desc',
        score: 105,
        source: 'keywords',
        categories: [],
        matchedKeywords: [],
        missingKeywords: [],
        strengths: [],
        gaps: [],
        suggestions: [],
        createdAt: '2026-11-19T00:00:00.000Z',
      };
      expect(() => ResumeMatch.parse(invalid)).toThrow();
    });
  });

  describe('calculateResumeMatchOverallScore helper (requirement 11, 12, 13)', () => {
    it('correctly computes weighted overall score: 0.40*skills + 0.30*exp + 0.20*kw + 0.10*edu (requirement 11)', () => {
      // 0.40 * 100 + 0.30 * 100 + 0.20 * 100 + 0.10 * 100 = 100
      const perfect = [
        { category: 'Skills match', score: 100 },
        { category: 'Experience relevance', score: 100 },
        { category: 'Keyword coverage', score: 100 },
        { category: 'Education and credentials', score: 100 },
      ];
      expect(calculateResumeMatchOverallScore(perfect)).toBe(100);

      // 0.40 * 0 + 0.30 * 0 + 0.20 * 0 + 0.10 * 0 = 0
      const zero = [
        { category: 'Skills match', score: 0 },
        { category: 'Experience relevance', score: 0 },
        { category: 'Keyword coverage', score: 0 },
        { category: 'Education and credentials', score: 0 },
      ];
      expect(calculateResumeMatchOverallScore(zero)).toBe(0);

      // 0.40 * 85 + 0.30 * 70 + 0.20 * 60 + 0.10 * 90 = 34 + 21 + 12 + 9 = 76
      const balanced = [
        { category: 'Skills match', score: 85 },
        { category: 'Experience relevance', score: 70 },
        { category: 'Keyword coverage', score: 60 },
        { category: 'Education and credentials', score: 90 },
      ];
      expect(calculateResumeMatchOverallScore(balanced)).toBe(76);
    });

    it('correctly clamps out-of-range category scores below 0 and above 100 (requirement 12)', () => {
      const outOfRange = [
        { category: 'Skills match', score: 150 }, // clamped to 100 -> 40
        { category: 'Experience relevance', score: -30 }, // clamped to 0 -> 0
        { category: 'Keyword coverage', score: 50 }, // 10
        { category: 'Education and credentials', score: 200 }, // clamped to 100 -> 10
      ];
      // 40 + 0 + 10 + 10 = 60
      expect(calculateResumeMatchOverallScore(outOfRange)).toBe(60);
    });

    it('rounds fractional weighted scores to the nearest integer (requirement 13)', () => {
      // 0.40 * 82 (32.8) + 0.30 * 75 (22.5) + 0.20 * 63 (12.6) + 0.10 * 80 (8.0) = 75.9 -> 76
      const roundUp = [
        { category: 'Skills match', score: 82 },
        { category: 'Experience relevance', score: 75 },
        { category: 'Keyword coverage', score: 63 },
        { category: 'Education and credentials', score: 80 },
      ];
      expect(calculateResumeMatchOverallScore(roundUp)).toBe(76);

      // 0.40 * 80 (32.0) + 0.30 * 70 (21.0) + 0.20 * 61 (12.2) + 0.10 * 80 (8.0) = 73.2 -> 73
      const roundDown = [
        { category: 'Skills match', score: 80 },
        { category: 'Experience relevance', score: 70 },
        { category: 'Keyword coverage', score: 61 },
        { category: 'Education and credentials', score: 80 },
      ];
      expect(calculateResumeMatchOverallScore(roundDown)).toBe(73);
    });

    it('throws when any required category is missing', () => {
      const missingEdu = [
        { category: 'Skills match', score: 80 },
        { category: 'Experience relevance', score: 80 },
        { category: 'Keyword coverage', score: 80 },
      ];
      expect(() => calculateResumeMatchOverallScore(missingEdu)).toThrow(
        /Missing required category: "Education and credentials"/
      );
    });

    it('throws when duplicate categories are provided', () => {
      const duplicateSkills = [
        { category: 'Skills match', score: 80 },
        { category: 'Skills match', score: 90 },
        { category: 'Experience relevance', score: 70 },
        { category: 'Keyword coverage', score: 60 },
        { category: 'Education and credentials', score: 80 },
      ];
      expect(() => calculateResumeMatchOverallScore(duplicateSkills)).toThrow(
        /Duplicate category: "Skills match"/
      );
    });

    it('throws when an unexpected category is provided', () => {
      const unexpected = [
        { category: 'Skills match', score: 80 },
        { category: 'Experience relevance', score: 70 },
        { category: 'Keyword coverage', score: 60 },
        { category: 'Education and credentials', score: 80 },
        { category: 'Culture fit', score: 100 },
      ];
      expect(() => calculateResumeMatchOverallScore(unexpected)).toThrow(/Unexpected category/);
    });

    it('handles invalid or non-finite values safely by throwing', () => {
      expect(() =>
        calculateResumeMatchOverallScore([
          { category: 'Skills match', score: NaN },
          { category: 'Experience relevance', score: 70 },
          { category: 'Keyword coverage', score: 60 },
          { category: 'Education and credentials', score: 80 },
        ])
      ).toThrow(/must be a finite number/);

      expect(() =>
        calculateResumeMatchOverallScore([
          { category: 'Skills match', score: Infinity },
          { category: 'Experience relevance', score: 70 },
          { category: 'Keyword coverage', score: 60 },
          { category: 'Education and credentials', score: 80 },
        ])
      ).toThrow(/must be a finite number/);

      expect(() => calculateResumeMatchOverallScore(null as any)).toThrow(
        /Categories must be an array/
      );
    });
  });
});

describe('Resume Match — Keyword Scorer (RJ-14, FR-34)', () => {
  const matchingResumeText = `
    Alex Rivera
    alex.rivera@example.com | 555-0199 | San Francisco, CA

    SUMMARY
    Senior Full-Stack Engineer with 5+ years of experience designing scalable microservices
    using TypeScript, Node.js, React, and PostgreSQL. Proficient with Docker, AWS, and CI/CD.

    SKILLS
    Languages & Frameworks: TypeScript, JavaScript, Python, Node.js, Express, React, HTML5, CSS3
    Databases & Tools: PostgreSQL, Redis, Docker, Kubernetes, AWS, Git, CI/CD, Jest

    EXPERIENCE
    Senior Software Engineer | Acme Cloud Solutions (2021 - Present)
    - Architected and deployed microservices in TypeScript and Node.js with PostgreSQL and Redis caching.
    - Built customer-facing responsive interfaces using React, Next.js, and Tailwind CSS.
    - Automated deployment pipelines using Docker, Kubernetes, and GitHub Actions CI/CD on AWS.

    Software Engineer | TechStart Labs (2019 - 2021)
    - Developed backend REST APIs with Python, FastAPI, and PostgreSQL.
    - Implemented unit testing suites with Jest and PyTest, maintaining 90% test coverage.

    EDUCATION
    Bachelor of Science in Computer Science | University of California, Berkeley (2015 - 2019)

    CERTIFICATIONS
    AWS Certified Solutions Architect - Associate
  `;

  const matchingProfile = {
    name: 'Alex Rivera',
    email: 'alex.rivera@example.com',
    phone: '555-0199',
    summary: 'Senior Full-Stack Engineer with 5+ years of experience in TypeScript, React, Node.js, and PostgreSQL.',
    education: ['B.S. in Computer Science, UC Berkeley, 2019'],
    skills: ['TypeScript', 'JavaScript', 'Node.js', 'React', 'PostgreSQL', 'Redis', 'Docker', 'AWS', 'Git', 'CI/CD'],
    projects: ['Cloud microservices architecture with Docker and AWS'],
    experience: [
      'Senior Software Engineer at Acme Cloud Solutions (2021 - Present) working with TypeScript, Node.js, React, PostgreSQL, Docker, AWS.',
      'Software Engineer at TechStart Labs (2019 - 2021) with Python, FastAPI, and REST APIs.',
    ],
    certifications: ['AWS Certified Solutions Architect'],
    achievements: ['Decreased API latency by 45%'],
    languages: ['English'],
  };

  const unrelatedResumeText = `
    Chef Marco Rossi
    marco.rossi@example.com | 555-4321 | New York, NY

    SUMMARY
    Executive Chef with 10 years of culinary leadership in high-volume fine dining restaurants.
    Expertise in menu design, culinary inventory management, food safety, and kitchen team training.

    EXPERIENCE
    Executive Chef | Ristorante Bella Vista (2018 - Present)
    - Supervised a team of 15 cooks, managing daily kitchen operations and seasonal menus.
    - Reduced food waste by 22% through inventory tracking and local sourcing agreements.

    Head Chef | Trattoria Romana (2014 - 2018)
    - Prepared traditional Italian dishes and managed supplier procurement.

    EDUCATION
    Culinary Arts Diploma | Institute of Culinary Education (2012 - 2014)

    CERTIFICATIONS
    ServSafe Food Protection Manager Certification
  `;

  const unrelatedProfile = {
    name: 'Marco Rossi',
    email: 'marco.rossi@example.com',
    phone: '555-4321',
    summary: 'Executive Chef with 10 years of culinary leadership.',
    education: ['Culinary Arts Diploma, ICE, 2014'],
    skills: ['Culinary Arts', 'Menu Planning', 'Inventory Management', 'Food Safety'],
    projects: ['Seasonal Menu Overhaul'],
    experience: ['Executive Chef at Ristorante Bella Vista', 'Head Chef at Trattoria Romana'],
    certifications: ['ServSafe Manager'],
    achievements: ['Award of Culinary Excellence 2022'],
    languages: ['English', 'Italian'],
  };

  const techJobDescription = `
    Job Title: Senior Full-Stack Engineer
    Location: San Francisco, CA (Hybrid)

    About the Role:
    We are looking for a Senior Full-Stack Engineer to join our core product team. You will build
    and maintain high-throughput microservices and responsive web applications.

    Responsibilities:
    - Design and develop backend APIs using TypeScript, Node.js, and Express.
    - Build interactive user interfaces with React, Next.js, and modern CSS.
    - Design database schemas and optimize queries using PostgreSQL and Redis.
    - Containerize applications using Docker and manage deployments on AWS with CI/CD pipelines.
    - Write comprehensive automated tests with Jest or Vitest.

    Requirements:
    - 4+ years of professional software engineering experience.
    - Strong proficiency in TypeScript, JavaScript, React, and Node.js.
    - Hands-on experience with PostgreSQL, Docker, and AWS cloud infrastructure.
    - Familiarity with Git, microservices, and CI/CD workflows.
    - Bachelor's degree in Computer Science or equivalent practical experience.
  `;

  it('matching resume and job description produce a high score (requirement 1)', () => {
    const result = scoreKeywordResumeMatch({
      extractedText: matchingResumeText,
      parsedProfile: matchingProfile,
      jobDescription: techJobDescription,
    });

    expect(result.source).toBe('keywords');
    expect(result.score).toBeGreaterThanOrEqual(75);
    expect(result.matchedKeywords.length).toBeGreaterThan(5);
    expect(result.categories).toHaveLength(4);
    expect(result.strengths.length).toBeGreaterThan(0);
  });

  it('unrelated resume produces a low score and lists missing keywords (requirement 2)', () => {
    const result = scoreKeywordResumeMatch({
      extractedText: unrelatedResumeText,
      parsedProfile: unrelatedProfile,
      jobDescription: techJobDescription,
    });

    expect(result.source).toBe('keywords');
    expect(result.score).toBeLessThanOrEqual(30);
    expect(result.missingKeywords.length).toBeGreaterThan(5);
    expect(result.gaps.length).toBeGreaterThan(0);
    // Should flag missing core technical skills
    expect(result.missingKeywords).toContain('TypeScript');
    expect(result.missingKeywords).toContain('React');
    expect(result.missingKeywords).toContain('Node.js');
  });

  it('handles empty skills list without crashing (requirement 3)', () => {
    const emptyProfile = {
      ...matchingProfile,
      skills: [],
    };

    expect(() =>
      scoreKeywordResumeMatch({
        extractedText: matchingResumeText,
        parsedProfile: emptyProfile,
        jobDescription: techJobDescription,
      })
    ).not.toThrow();

    const result = scoreKeywordResumeMatch({
      extractedText: matchingResumeText,
      parsedProfile: emptyProfile,
      jobDescription: techJobDescription,
    });

    expect(result.score).toBeGreaterThan(50); // extractedText still contains the skills
  });

  it('correctly extracts matched keywords (requirement 4)', () => {
    const result = scoreKeywordResumeMatch({
      extractedText: matchingResumeText,
      parsedProfile: matchingProfile,
      jobDescription: techJobDescription,
    });

    // Tech JD mentions TypeScript, React, Node.js, PostgreSQL, Docker, AWS, Git, CI/CD
    expect(result.matchedKeywords).toContain('TypeScript');
    expect(result.matchedKeywords).toContain('React');
    expect(result.matchedKeywords).toContain('Node.js');
    expect(result.matchedKeywords).toContain('PostgreSQL');
    expect(result.matchedKeywords).toContain('Docker');
    expect(result.matchedKeywords).toContain('AWS');
  });

  it('correctly lists missing keywords (requirement 5)', () => {
    const jdWithMissingTools = `
      Required Skills:
      - TypeScript, React, Node.js
      - Rust, Kubernetes, Terraform, GraphQL
    `;

    const result = scoreKeywordResumeMatch({
      extractedText: matchingResumeText,
      parsedProfile: matchingProfile,
      jobDescription: jdWithMissingTools,
    });

    expect(result.missingKeywords).toContain('Rust');
    expect(result.missingKeywords).toContain('Terraform');
    expect(result.missingKeywords).toContain('GraphQL');
  });

  it('performs case-insensitive matching (requirement 6)', () => {
    const jdWithUpperLower = 'We require TYPESCRIPT, react, and PYTHON developers.';
    const resumeWithMixed = 'Experience with TypeScript, React, and Python.';

    const result = scoreKeywordResumeMatch({
      extractedText: resumeWithMixed,
      parsedProfile: { skills: ['typescript', 'REACT', 'Python'] } as any,
      jobDescription: jdWithUpperLower,
    });

    expect(result.matchedKeywords).toContain('TypeScript');
    expect(result.matchedKeywords).toContain('React');
    expect(result.matchedKeywords).toContain('Python');
    expect(result.missingKeywords).toHaveLength(0);
  });

  it('correctly matches multiword skills (requirement 7)', () => {
    const jdMultiword = `
      Looking for skills in Machine Learning, Unit Testing, and Google Cloud.
    `;
    const resumeMultiword = `
      Experienced in Machine Learning models, Unit Testing with Jest, and deploying on Google Cloud.
    `;

    const result = scoreKeywordResumeMatch({
      extractedText: resumeMultiword,
      parsedProfile: { skills: ['Machine Learning', 'Unit Testing', 'Google Cloud'] } as any,
      jobDescription: jdMultiword,
    });

    expect(result.matchedKeywords).toContain('Machine Learning');
    expect(result.matchedKeywords).toContain('Unit Testing');
    expect(result.matchedKeywords).toContain('Google Cloud');
  });

  it('skill regex avoids unsafe substring matches (e.g. Go in Django/Google, Java in JavaScript)', () => {
    const goRegex = createSkillRegex('Go');
    expect(goRegex.test('We use Go for backend')).toBe(true);
    expect(goRegex.test('We use Django for backend')).toBe(false);
    expect(goRegex.test('Experienced with Google services')).toBe(false);

    const javaRegex = createSkillRegex('Java');
    expect(javaRegex.test('Expert Java developer')).toBe(true);
    expect(javaRegex.test('Expert JavaScript developer')).toBe(false);

    const restRegex = createSkillRegex('REST');
    expect(restRegex.test('Building REST APIs')).toBe(true);
    expect(restRegex.test('Restaurant management portal')).toBe(false);

    const cplusplusRegex = createSkillRegex('C++');
    expect(cplusplusRegex.test('Developing in C++20')).toBe(true);
    expect(cplusplusRegex.test('C developer')).toBe(false);
  });

  it('ignores stopwords during keyword extraction (requirement 8)', () => {
    const jdText = `
      The ideal candidate will have strong skills and responsibilities to work with our team in an excellent environment.
      We are looking for Python and Docker.
    `;

    const { all } = extractJobKeywords(jdText);

    // Stopwords and boilerplate must not appear as keywords
    expect(all.map((w) => w.toLowerCase())).not.toContain('the');
    expect(all.map((w) => w.toLowerCase())).not.toContain('will');
    expect(all.map((w) => w.toLowerCase())).not.toContain('have');
    expect(all.map((w) => w.toLowerCase())).not.toContain('with');
    expect(all.map((w) => w.toLowerCase())).not.toContain('candidate');
    expect(all.map((w) => w.toLowerCase())).not.toContain('responsibilities');
    expect(all.map((w) => w.toLowerCase())).not.toContain('environment');

    // Real tech keywords must be extracted
    expect(all).toContain('Python');
    expect(all).toContain('Docker');
  });

  it('removes duplicate keywords from the extracted lists (requirement 9)', () => {
    const jdWithRepeats = `
      We need TypeScript, React, and TypeScript.
      Looking for React experience and more React and TypeScript development.
    `;

    const { all, skills } = extractJobKeywords(jdWithRepeats);

    const tsCount = skills.filter((s) => s.toLowerCase() === 'typescript').length;
    expect(tsCount).toBe(1);

    const reactCount = skills.filter((s) => s.toLowerCase() === 'react').length;
    expect(reactCount).toBe(1);

    const allTs = all.filter((s) => s.toLowerCase() === 'typescript').length;
    expect(allTs).toBe(1);
  });

  it('guarantees all four category scores are within 0–100 (requirement 10)', () => {
    const result = scoreKeywordResumeMatch({
      extractedText: matchingResumeText,
      parsedProfile: matchingProfile,
      jobDescription: techJobDescription,
    });

    for (const cat of result.categories) {
      expect(cat.score).toBeGreaterThanOrEqual(0);
      expect(cat.score).toBeLessThanOrEqual(100);
      expect(Number.isInteger(cat.score)).toBe(true);
    }
  });

  it('overall score is computed from the category scores via calculateResumeMatchOverallScore', () => {
    const result = scoreKeywordResumeMatch({
      extractedText: matchingResumeText,
      parsedProfile: matchingProfile,
      jobDescription: techJobDescription,
    });

    const expectedScore = calculateResumeMatchOverallScore(result.categories);
    expect(result.score).toBe(expectedScore);
  });

  it('handles completely blank resume gracefully with 0 or minimal baseline score', () => {
    const result = scoreKeywordResumeMatch({
      extractedText: '',
      parsedProfile: null,
      jobDescription: techJobDescription,
    });

    expect(result.score).toBeLessThanOrEqual(15);
    expect(result.matchedKeywords).toHaveLength(0);
    expect(result.missingKeywords.length).toBeGreaterThan(0);
  });
});
