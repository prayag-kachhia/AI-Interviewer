import express, { Express, Request, Response } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import authRoutes from './routes/auth.routes';
import resumeRoutes from './routes/resume.routes';
import sessionRoutes from './routes/session.routes';
import feedbackRoutes from './routes/feedback.routes';
import { runWorker } from './worker';

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

// Start server
if (process.env.NODE_ENV !== 'test') {
  app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
  });

  // One feedback worker runs inside the API so `bun run dev` is enough for the
  // full flow. Set WORKER=off to run workers separately (`bun run worker`).
  if (process.env.WORKER !== 'off') {
    runWorker(`api-${process.pid}`);
  }
}

export default app;
