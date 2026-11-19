/**
 * A stand-in for the Gemini API, used only by the end-to-end test (P-14).
 *
 * The API reaches it because the test starts the server with GOOGLE_GEMINI_BASE_URL pointing
 * here: the @google/genai SDK reads that variable, so no production code knows about this fake.
 * Production never sets the variable (deploy.yml replaces every env var on each deploy).
 *
 * It answers the four kinds of call the API makes, told apart by their response schema:
 * - grading (schema has `scores`): one score per rubric category, plus per-answer feedback
 *   built from the transcript, the same way deriveExpectedQuestions pairs questions with answers;
 * - improvement insights (schema has `topics`);
 * - resume parsing (JSON with no schema);
 * - the next interview question (plain text).
 */

import { createServer, type Server } from 'node:http';

export const FAKE_SUMMARY = 'Clear, structured answers with concrete examples from your projects.';

type Json = Record<string, unknown>;

/** Finds the enum of rubric categories anywhere in the grading schema. */
function findCategoryEnum(node: unknown): string[] | null {
  if (!node || typeof node !== 'object') return null;
  const obj = node as Json;
  const category = obj.category as Json | undefined;
  if (category && Array.isArray(category.enum)) return category.enum as string[];
  for (const value of Object.values(obj)) {
    const found = findCategoryEnum(value);
    if (found) return found;
  }
  return null;
}

/** The questions the grader expects per-answer feedback for, read from the prompt's transcript. */
function expectedQuestions(prompt: string): string[] {
  const transcript = prompt.slice(prompt.lastIndexOf('Transcript:'));
  const questions: string[] = [];
  let pending: string[] = [];
  let previousWasCandidate = false;
  for (const line of transcript.split('\n')) {
    if (line.startsWith('Interviewer: ')) {
      pending.push(line.slice('Interviewer: '.length).trim());
      previousWasCandidate = false;
    } else if (line.startsWith('Candidate: ')) {
      if (!previousWasCandidate) questions.push(pending.join(' '));
      pending = [];
      previousWasCandidate = true;
    }
  }
  return questions;
}

function firstAnswer(prompt: string): string {
  const line = prompt.split('\n').find((l) => l.startsWith('Candidate: '));
  return line ? line.slice('Candidate: '.length).slice(0, 60) : 'my answer';
}

/** Every `text` field in the request's contents, in order (the prompt). */
function collectText(node: unknown): string[] {
  if (typeof node === 'string') return [node];
  if (Array.isArray(node)) return node.flatMap(collectText);
  if (node && typeof node === 'object') {
    const obj = node as Json;
    if (typeof obj.text === 'string') return [obj.text];
    return Object.values(obj).flatMap(collectText);
  }
  return [];
}

let questionNumber = 0;

export function fakeReply(body: Json): string {
  const prompt = collectText(body.contents).join('\n');
  const config = (body.generationConfig ?? {}) as Json;
  const schema = JSON.stringify(config.responseSchema ?? config.responseJsonSchema ?? {});

  if (schema.includes('"scores"')) {
    const categories = findCategoryEnum(config.responseSchema ?? config.responseJsonSchema) ?? [];
    return JSON.stringify({
      summary: FAKE_SUMMARY,
      scores: categories.map((category) => ({
        category,
        score: 4,
        comment: `Good ${category.toLowerCase()} overall.`,
        strengths: ['Explained the reasoning step by step'],
        improvements: ['Add numbers to show the impact'],
        quote: firstAnswer(prompt),
      })),
      perAnswer: expectedQuestions(prompt).map((question) => ({
        question,
        summary: 'A focused answer that stayed on the question.',
        strengths: ['Concrete example'],
        improvements: ['Mention trade-offs'],
      })),
    });
  }

  if (schema.includes('"topics"')) {
    return JSON.stringify({ topics: [{ topic: 'System Design', score: 3, summary: 'Solid basics.' }] });
  }

  if (config.responseMimeType === 'application/json') {
    return JSON.stringify({
      name: 'E2E Candidate',
      email: 'e2e.candidate@example.com',
      phone: '+91 90000 00000',
      summary: 'Final-year student who builds full-stack web apps.',
      education: ['B.Tech ICT, DA-IICT, 2027'],
      skills: ['TypeScript', 'React', 'PostgreSQL'],
      projects: ['AI Interviewer: spoken mock interviews'],
      experience: ['Intern, Example Corp (2025)'],
      certifications: [],
      achievements: [],
      languages: ['English'],
      looksLikeResume: true,
    });
  }

  questionNumber += 1;
  return `Question ${questionNumber}: tell me about a project where you had to make a design trade-off.`;
}

/** Starts the fake on FAKE_GEMINI_PORT (default 4100). Run with `bun e2e/fake-gemini.ts`. */
export function startFakeGemini(port = Number(process.env.FAKE_GEMINI_PORT ?? 4100)): Server {
  const server = createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk) => (raw += chunk));
    req.on('end', () => {
      res.setHeader('Content-Type', 'application/json');
      if (req.method !== 'POST' || !(req.url ?? '').split('?')[0].endsWith(':generateContent')) {
        res.statusCode = 404;
        res.end('{"error":{"code":404,"message":"not faked"}}');
        return;
      }
      const text = fakeReply(JSON.parse(raw || '{}') as Json);
      res.end(
        JSON.stringify({
          candidates: [{ content: { role: 'model', parts: [{ text }] }, finishReason: 'STOP' }],
          usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 50, totalTokenCount: 150 },
        })
      );
    });
  });
  server.listen(port, '127.0.0.1', () => console.log(`[fake-gemini] listening on http://127.0.0.1:${port}`));
  return server;
}

if (process.argv[1]?.endsWith('fake-gemini.ts')) startFakeGemini();
