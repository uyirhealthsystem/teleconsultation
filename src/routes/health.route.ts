import { Router } from 'express';
import { prisma } from '../services/prisma.service';

const router = Router();

// Neon scales to zero; a cold start can take a few seconds to answer.
const DB_CHECK_TIMEOUT_MS = 5000;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms),
    ),
  ]);
}

// Liveness: the process is up and serving requests. No dependency checks, so a
// database blip never makes the deploy pipeline roll back a good release.
router.get('/', (_req, res) => {
  res.json({ status: 'ok' });
});

router.get('/live', (_req, res) => {
  res.json({ status: 'ok', uptime: Math.round(process.uptime()) });
});

// Readiness: the app can do real work, i.e. the database answers.
router.get('/ready', async (_req, res) => {
  const started = Date.now();
  try {
    await withTimeout(prisma.$queryRaw`SELECT 1`, DB_CHECK_TIMEOUT_MS);
    res.json({
      status: 'ok',
      checks: { database: { status: 'ok', latencyMs: Date.now() - started } },
    });
  } catch (err) {
    res.status(503).json({
      status: 'error',
      checks: {
        database: {
          status: 'error',
          error: err instanceof Error ? err.message : 'unknown error',
        },
      },
    });
  }
});

export default router;
