import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import prisma from '../db';
import { getUserResourceOr404 } from '../errors';
import { CreateResumeMatchInput, ResumeMatch } from '@interview/contracts';
import { matchResumeWithJobDescription } from '../services/resume-match.service';

const router = Router();

export const MAX_MATCH_RETENTION_PER_USER = 20;

/**
 * Transforms a Prisma ResumeMatch record into the shared ResumeMatch contract shape.
 */
export function formatResumeMatch(match: {
  id: string;
  resumeId: string;
  jobDescription: string;
  score: number;
  source: string;
  result: any;
  createdAt: Date | string;
}): ResumeMatch {
  const parsedResult =
    typeof match.result === 'string' ? JSON.parse(match.result) : match.result;

  return {
    id: match.id,
    resumeId: match.resumeId,
    jobDescription: match.jobDescription,
    score: match.score,
    source: match.source as 'ai' | 'keywords',
    categories: parsedResult?.categories ?? [],
    matchedKeywords: parsedResult?.matchedKeywords ?? [],
    missingKeywords: parsedResult?.missingKeywords ?? [],
    strengths: parsedResult?.strengths ?? [],
    gaps: parsedResult?.gaps ?? [],
    suggestions: parsedResult?.suggestions ?? [],
    createdAt:
      match.createdAt instanceof Date
        ? match.createdAt.toISOString()
        : String(match.createdAt),
  };
}

/**
 * Route A — POST /api/resume/:id/matches
 * Compares an existing candidate resume against a job description.
 * Grades with Gemini (or fallback to keywords), saves result,
 * enforces 20-result retention cap per user, and returns HTTP 201.
 */
router.post('/:id/matches', authenticate, async (req, res) => {
  const userId = req.user!.id;
  const resumeId = req.params.id as string;

  const parsedInput = CreateResumeMatchInput.safeParse(req.body);
  if (!parsedInput.success) {
    const firstIssue = parsedInput.error.issues[0];
    res.status(400).json({
      success: false,
      message: `${firstIssue?.path.join('.') || 'jobDescription'}: ${firstIssue?.message || 'Invalid job description'}`,
    });
    return;
  }

  const { jobDescription } = parsedInput.data;

  // Verify resume ownership (FR-27: another user's resume returns 404, not 403)
  const resume = await getUserResourceOr404(
    prisma.resume.findFirst({
      where: { id: resumeId, userId },
    })
  );

  // Grade the resume against the target job description
  const result = await matchResumeWithJobDescription(
    {
      extractedText: resume.extractedText,
      parsedProfile: resume.parsedProfile,
    },
    jobDescription
  );

  // Transactionally insert new match and enforce 20-result cap per user
  const savedMatch = await prisma.$transaction(async (tx) => {
    const created = await tx.resumeMatch.create({
      data: {
        resumeId: resume.id,
        userId,
        jobDescription,
        score: result.score,
        source: result.source,
        result: result as any,
      },
    });

    // Identify older matches beyond newest 20 for this user across all their resumes
    const userMatches = await tx.resumeMatch.findMany({
      where: { userId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: { id: true },
    });

    if (userMatches.length > MAX_MATCH_RETENTION_PER_USER) {
      const excessIds = userMatches
        .slice(MAX_MATCH_RETENTION_PER_USER)
        .map((m) => m.id);

      await tx.resumeMatch.deleteMany({
        where: {
          id: { in: excessIds },
          userId, // Scope to authenticated user
        },
      });
    }

    return created;
  });

  res.status(201).json({
    success: true,
    data: formatResumeMatch(savedMatch),
  });
});

/**
 * Route B — GET /api/resume/:id/matches
 * Returns all match records for the requested resume owned by the authenticated user,
 * ordered newest first.
 */
router.get('/:id/matches', authenticate, async (req, res) => {
  const userId = req.user!.id;
  const resumeId = req.params.id as string;

  // Verify resume ownership (FR-27: return 404 if not found or owned by another user)
  const resume = await getUserResourceOr404(
    prisma.resume.findFirst({
      where: { id: resumeId, userId },
    })
  );

  const matches = await prisma.resumeMatch.findMany({
    where: {
      resumeId: resume.id,
      userId,
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
  });

  res.status(200).json({
    success: true,
    data: matches.map(formatResumeMatch),
  });
});

/**
 * Route C — DELETE /api/resume/:id/matches/:matchId
 * Deletes a match record owned by the authenticated user.
 * Returns HTTP 404 if the resume or match belongs to another user (FR-27).
 * Returns HTTP 204 on success.
 */
router.delete('/:id/matches/:matchId', authenticate, async (req, res) => {
  const userId = req.user!.id;
  const resumeId = req.params.id as string;
  const matchId = req.params.matchId as string;

  // Verify resume ownership
  const resume = await getUserResourceOr404(
    prisma.resume.findFirst({
      where: { id: resumeId, userId },
    })
  );

  // Verify match ownership and association with the resume
  const match = await getUserResourceOr404(
    prisma.resumeMatch.findFirst({
      where: {
        id: matchId,
        resumeId: resume.id,
        userId,
      },
    })
  );

  await prisma.resumeMatch.delete({
    where: { id: match.id },
  });

  res.status(204).send();
});

export default router;
