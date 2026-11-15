import { Router } from 'express';
import multer from 'multer';
import { authenticate } from '../middleware/auth';
import prisma from '../db';
import { extractTextFromPdfBuffer } from '../services/pdf.service';
import { analyzeResumeWithAI } from '../services/gemini.service';
import { getUserResourceOr404 } from '../errors';
import type { CandidateProfile } from '../types';

const router = Router();

function parseStoredProfile(rawJson: string): { profile: CandidateProfile; source?: 'ai' | 'heuristic' } {
  try {
    const parsed = JSON.parse(rawJson);
    const rawProfile = parsed && typeof parsed === 'object' && parsed.profile ? parsed.profile : parsed;
    let source: 'ai' | 'heuristic' | undefined;
    if (parsed?.source === 'ai' || rawProfile?.source === 'ai') {
      source = 'ai';
    } else if (parsed?.source === 'heuristic' || rawProfile?.source === 'heuristic') {
      source = 'heuristic';
    }

    const profile: CandidateProfile = {
      name: rawProfile?.name || '',
      email: rawProfile?.email || '',
      phone: rawProfile?.phone || '',
      summary: rawProfile?.summary || '',
      education: Array.isArray(rawProfile?.education) ? rawProfile?.education : [],
      skills: Array.isArray(rawProfile?.skills) ? rawProfile?.skills : [],
      projects: Array.isArray(rawProfile?.projects) ? rawProfile?.projects : [],
      experience: Array.isArray(rawProfile?.experience) ? rawProfile?.experience : [],
      certifications: Array.isArray(rawProfile?.certifications) ? rawProfile?.certifications : [],
      achievements: Array.isArray(rawProfile?.achievements) ? rawProfile?.achievements : [],
      languages: Array.isArray(rawProfile?.languages) ? rawProfile?.languages : [],
    };

    return {
      profile,
      ...(source ? { source } : {}),
    };
  } catch {
    return {
      profile: {
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
      },
      source: 'heuristic',
    };
  }
}

// Configure multer for memory storage (keep file in RAM instead of disk)
// Max file size: 5MB
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, 
});

// Protect these routes with authentication middleware
router.post('/analyze', authenticate, upload.single('resume'), async (req, res) => {
  const userId = req.user!.id;

  if (!req.file) {
    res.status(400).json({ success: false, message: 'No resume PDF uploaded' });
    return;
  }

  const isPdf = req.file.mimetype === 'application/pdf' || 
                req.file.mimetype === 'application/x-pdf' || 
                req.file.originalname.toLowerCase().endsWith('.pdf');

  if (!isPdf) {
    res.status(400).json({ success: false, message: 'Only PDF files are supported' });
    return;
  }

  const fileName = req.file.originalname;

  // 1. Extract text from PDF
  const extractedText = await extractTextFromPdfBuffer(req.file.buffer);

  if (!extractedText || extractedText.trim().length === 0) {
    res.status(400).json({ 
      success: false, 
      message: 'Could not extract text from this PDF. Please ensure the PDF contains selectable text (not scanned images).' 
    });
    return;
  }

  // 2. Analyze with Gemini
  const { profile, source } = await analyzeResumeWithAI(extractedText);

  // 3. Save to database
  const resume = await prisma.resume.create({
    data: {
      userId,
      fileName,
      extractedText,
      parsedProfile: JSON.stringify({
        ...profile,
        source,
      }),
    },
  });

  res.status(200).json({
    success: true,
    message: 'Resume analyzed successfully',
    data: {
      resumeId: resume.id,
      fileName: resume.fileName,
      createdAt: resume.createdAt,
      profile,
      source,
    },
  });
});

router.get('/latest', authenticate, async (req, res) => {
  const userId = req.user!.id;

  const latestResume = await getUserResourceOr404(
    prisma.resume.findFirst({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    })
  );

  const { profile, source } = parseStoredProfile(latestResume.parsedProfile);

  res.status(200).json({
    success: true,
    data: {
      resumeId: latestResume.id,
      fileName: latestResume.fileName,
      createdAt: latestResume.createdAt,
      profile,
      source,
    },
  });
});

router.get('/:id', authenticate, async (req, res) => {
  const userId = req.user!.id;
  const id = req.params.id as string;

  const resume = await getUserResourceOr404(
    prisma.resume.findFirst({
      where: { id, userId },
    })
  );

  const { profile, source } = parseStoredProfile(resume.parsedProfile);

  res.status(200).json({
    success: true,
    data: {
      resumeId: resume.id,
      fileName: resume.fileName,
      createdAt: resume.createdAt,
      profile,
      source,
    },
  });
});

export default router;
