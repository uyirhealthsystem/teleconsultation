import cors from 'cors';
import express, { Application } from 'express';
import helmet from 'helmet';
import pinoHttp from 'pino-http';
import { errorHandler } from './middlewares/error.middleware';
import { notFoundHandler } from './middlewares/notFound.middleware';
import paymentWebhookRoutes from './routes/payment.webhook.routes.js';

import routes from './routes';
import { logger } from './utils/logger';

export function createApp(): Application {
  const app = express();

  
  app.use(helmet());
  app.use(cors());
  // app.use(express.json());
  app.use(
  express.json({
    verify: (req, _res, buf) => {
      (req as express.Request & { rawBody?: Buffer }).rawBody =
        Buffer.from(buf);
    },
  }),
);
  app.use(express.urlencoded({ extended: true }));
  app.use(pinoHttp({ logger }));

  // Used by the deploy pipeline to decide whether to keep or roll back a release
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  app.use('/api/v1/webhooks/payments', paymentWebhookRoutes);
  app.use('/api/v1/teleconsultation', routes);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}