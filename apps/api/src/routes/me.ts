import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import prisma from '../db';

const router = Router();

/**
 * Export the authenticated user's application data as a JSON file.
 */
router.get('/export', authenticate, async (req, res) => {
  const userId = req.user?.id;

  if (!userId) {
    res.status(401).json({
      success: false,
      message: 'Unauthorized',
    });
    return;
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      name: true,
      email: true,
      createdAt: true,
      updatedAt: true,
      resumes: true,
      improvementPlan: true,
      sessions: {
        orderBy: { createdAt: 'desc' },
        include: {
          turns: {
            orderBy: { turnIndex: 'asc' },
          },
          feedback: true,
        },
      },
      resumeMatches: {
        orderBy: { createdAt: 'desc' },
      },
    },
  });

  if (!user) {
    res.status(404).json({
      success: false,
      message: 'User not found',
    });
    return;
  }

  res.setHeader('Content-Type', 'application/json');
  res.setHeader(
    'Content-Disposition',
    'attachment; filename="my-data-export.json"'
  );

  res.status(200).json({
    exportedAt: new Date().toISOString(),
    profile: {
      id: user.id,
      name: user.name,
      email: user.email,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    },
    resumes: user.resumes,
    improvementPlan: user.improvementPlan,
    sessions: user.sessions,
    resumeMatches: user.resumeMatches,
  });
});

export default router;
