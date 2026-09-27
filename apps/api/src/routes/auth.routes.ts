import { Router } from 'express';
import { getMe, deleteAccount } from '../controllers/auth.controller';
import { authenticate } from '../middleware/auth';

const router = Router();

// All application auth/profile operations are protected by Supabase Auth.
// Sign-in, sign-up, and sign-out happen directly through Supabase in the
// browser and never send passwords to this API.
router.get('/me', authenticate, getMe);
router.delete('/account', authenticate, deleteAccount);

export default router;
