import { Router } from 'express';
import { 
  checkUser, 
  register, 
  login, 
  logout, 
  getMe, 
  deleteAccount 
} from '../controllers/auth.controller';
import { authenticate } from '../middleware/auth';

const router = Router();

// Public auth routes
router.post('/check-user', checkUser);
router.post('/register', register);
router.post('/login', login);
router.post('/logout', logout);

// Authenticated auth routes
router.get('/me', authenticate, getMe);
router.delete('/account', authenticate, deleteAccount);

export default router;
