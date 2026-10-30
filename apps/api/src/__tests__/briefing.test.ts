import { describe, it, expect } from 'vitest';
import { buildBriefing } from '../services/briefing.service';

describe('Briefing Service — buildBriefing (FR-13, FR-15, FR-17, DR-01)', () => {
  it('builds a briefing for a Software Engineer session with structure, timing, and persona', () => {
    const briefing = buildBriefing({ roleId: 'software-engineer' });

    expect(briefing).toContain('Software Engineer');
    expect(briefing).toContain('Senior Software Engineering Interviewer');
    // Structure requirements (DR-01)
    expect(briefing).toContain('1. Introduction');
    expect(briefing).toContain('2. Core Technical Questions');
    expect(briefing).toContain('3. Wrap-up & Closing');
    // Follow-up and single question constraints (FR-15)
    expect(briefing).toContain('ONE question at a time');
    expect(briefing).toContain('follow-up');
    // Time limit (FR-17)
    expect(briefing).toContain('15 minutes');
    // Voice guidelines
    expect(briefing).toContain('VOICE CONVERSATION GUIDELINES');
    expect(briefing).toContain('DO NOT use markdown');
  });

  it('builds role-specific briefings for Data Analyst and Backend Developer', () => {
    const dataAnalystBriefing = buildBriefing({ roleId: 'data-analyst' });
    expect(dataAnalystBriefing).toContain('Data Analyst');
    expect(dataAnalystBriefing).toContain('SQL');

    const backendBriefing = buildBriefing({ roleId: 'backend-developer' });
    expect(backendBriefing).toContain('Backend Developer');
    expect(backendBriefing).toContain('API design');
  });

  it('includes custom time limit in the briefing', () => {
    const briefing = buildBriefing({ roleId: 'software-engineer', timeLimitMin: 25 });
    expect(briefing).toContain('25 minutes');
  });

  it('includes candidate focus area when provided (FR-07)', () => {
    const briefing = buildBriefing({
      roleId: 'backend-developer',
      focus: 'Distributed Systems and Caching',
    });

    expect(briefing).toContain('PRIMARY FOCUS AREA:');
    expect(briefing).toContain('Distributed Systems and Caching');
  });

  it('incorporates resumeSummary and instructs the interviewer to reference it (FR-08)', () => {
    const resumeText = 'Built a real-time analytics engine in Go and Kafka handling 50k req/s.';
    const briefing = buildBriefing({
      roleId: 'software-engineer',
      resumeSummary: resumeText,
    });

    expect(briefing).toContain('CANDIDATE RESUME SUMMARY:');
    expect(briefing).toContain(resumeText);
    expect(briefing).toContain('explicitly refer to at least one specific project');
  });

  it('lists pastQuestions and forbids repeating them (FR-16)', () => {
    const pastQuestions = [
      'How do you design a URL shortener?',
      'Explain how indexing improves B-tree performance.',
    ];
    const briefing = buildBriefing({
      roleId: 'backend-developer',
      pastQuestions,
    });

    expect(briefing).toContain('PREVIOUSLY ASKED QUESTIONS (DO NOT REPEAT):');
    expect(briefing).toContain('- How do you design a URL shortener?');
    expect(briefing).toContain('- Explain how indexing improves B-tree performance.');
    expect(briefing).toContain('Never ask any of the questions listed above');
  });
});
