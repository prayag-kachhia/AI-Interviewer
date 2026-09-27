import { Router } from 'express';
import multer from 'multer';
import { analyzeResume, getLatestResume, getResumeById } from '../controllers/resume.controller';
import { authenticate } from '../middleware/auth';

const router = Router();

// Configure multer for memory storage (keep file in RAM instead of disk)
// Max file size: 5MB
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, 
});

// Protect these routes with authentication middleware
router.post('/analyze', authenticate, upload.single('resume'), analyzeResume);
router.get('/latest', authenticate, getLatestResume);
router.get('/:id', authenticate, getResumeById);

export default router;
