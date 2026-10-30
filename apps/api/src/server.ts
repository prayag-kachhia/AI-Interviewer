import express, { Express, NextFunction, Request, Response } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import authRoutes from './routes/auth.routes';
import resumeRoutes from './routes/resume.routes';
import sessionRoutes from './routes/session.routes';
import feedbackRoutes from './routes/feedback.routes';

// Load environment variables
dotenv.config();

const app: Express = express();
const PORT = process.env.PORT || 3000;

// Middleware
// Only the web app may call the API from a browser.
app.use(cors({ origin: process.env.WEB_ORIGIN || 'http://localhost:5173' }));
app.use(express.json());

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/resume', resumeRoutes);
app.use('/api/sessions', sessionRoutes);
app.use('/api/sessions', feedbackRoutes);

// Health check endpoint
app.get('/health', (req: Request, res: Response) => {
  res.status(200).json({ status: 'ok', message: 'Backend is running' });
});

// Unknown API paths answer in the same JSON shape as every other API response.
app.use('/api', (_req: Request, res: Response) => {
  res.status(404).json({ success: false, message: 'Not found' });
});

// Last stop for errors no handler caught: a malformed JSON body, a file over multer's limit,
// or (in Express 5) a rejected promise in an async handler. Without this, Express replies
// with an HTML page that includes the stack trace.
app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  const status =
    typeof err === 'object' && err !== null && 'status' in err && typeof err.status === 'number'
      ? err.status
      : 500;
  if (status >= 500) {
    console.error('Unhandled error:', err);
    res.status(500).json({ success: false, message: 'Internal server error' });
    return;
  }
  res.status(status).json({ success: false, message: 'Invalid request' });
});

// Start server
if (process.env.NODE_ENV !== 'test') {
  // 0.0.0.0 so the server is reachable inside a container (Cloud Run).
  app.listen(Number(PORT), '0.0.0.0', () => {
    console.log(`Server is running on http://localhost:${PORT}`);
  });
}

export default app;
