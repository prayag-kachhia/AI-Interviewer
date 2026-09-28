import { Request, Response } from 'express';
import prisma from '../utils/db';
import { extractTextFromPdfBuffer } from '../services/pdf.service';
import { analyzeResumeWithAI } from '../services/gemini.service';
import { getUserResourceOr404, NotFoundError } from '../utils/resource';

export const analyzeResume = async (req: Request, res: Response): Promise<void> => {
  try {
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
  } catch (error: any) {
    console.error('Resume analysis error:', error);
    res.status(500).json({ success: false, message: error?.message || 'Failed to process resume' });
  }
};

export const getLatestResume = async (req: Request, res: Response): Promise<void> => {
  try {
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
  } catch (error) {
    if (error instanceof NotFoundError) {
      res.status(404).json({ success: false, message: 'Resource not found' });
      return;
    }
    console.error('Fetch resume error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch resume' });
  }
};

export const getResumeById = async (req: Request, res: Response): Promise<void> => {
  try {
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
  } catch (error) {
    if (error instanceof NotFoundError) {
      res.status(404).json({ success: false, message: 'Resource not found' });
      return;
    }
    console.error('Fetch resume by ID error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch resume' });
  }
};
