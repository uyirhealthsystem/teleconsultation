import cors from 'cors';
import express, { Application } from 'express';
import helmet from 'helmet';
import pinoHttp from 'pino-http';
import { errorHandler } from './middlewares/error.middleware';
import { notFoundHandler } from './middlewares/notFound.middleware';
import { AccessToken } from 'livekit-server-sdk';

import routes from './routes';
import { logger } from './utils/logger';

export function createApp(): Application {
  const app = express();

  
  app.use(helmet());
  app.use(cors());
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));
  app.use(pinoHttp({ logger }));

  // Used by the deploy pipeline to decide whether to keep or roll back a release
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
  });
  app.post('/get-token', async (req, res) => {
  const { roomName, participantName } = req.body;

  if (!roomName || !participantName) {
    return res.status(400).json({ error: 'Missing roomName or participantName' });
  }

 // Create an AccessToken using your LiveKit credentials (keep these secret!)
  const at = new AccessToken(
    process.env.LIVEKIT_API_KEY,
    process.env.LIVEKIT_API_SECRET,
    {
      identity: participantName,
      // Token expiration time (e.g., 10 minutes)
      ttl: '10m', 
    }
  );

    // Add permissions for the specific room
  at.addGrant({ 
    roomJoin: true, 
    room: roomName,
    canPublish: true,
    canSubscribe: true 
  });

  // Convert the token to a JWT string
  const token = await at.toJwt();

  res.json({ token });
});
  
  app.use('/api/v1/teleconsultation', routes);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}