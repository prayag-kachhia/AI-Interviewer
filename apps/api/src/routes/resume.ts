import { Router } from 'express';
import multer from 'multer';
import { authenticate } from '../middleware/auth';
import prisma from '../db';
import { extractTextFromPdfBuffer } from '../services/pdf.service';
import { analyzeResumeWithAI } from '../services/gemini.service';
import { getUserResourceOr404 } from '../errors';

const router = Router();

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
  const profile = await analyzeResumeWithAI(extractedText);

  // 3. Save to database
  const resume = await prisma.resume.create({
    data: {
      userId,
      fileName,
      extractedText,
      parsedProfile: JSON.stringify(profile),
    },
  });

  res.status(200).json({
    success: true,
    message: 'Resume analyzed successfully',
    data: {
      resumeId: resume.id,
      profile,
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

  // Parse the stored JSON string back to an object
  const profile = JSON.parse(latestResume.parsedProfile);

  res.status(200).json({
    success: true,
    data: {
      resumeId: latestResume.id,
      fileName: latestResume.fileName,
      createdAt: latestResume.createdAt,
      profile,
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

  const profile = JSON.parse(resume.parsedProfile);

  res.status(200).json({
    success: true,
    data: {
      resumeId: resume.id,
      fileName: resume.fileName,
      createdAt: resume.createdAt,
      profile,
    },
  });
});

export default router;
