import { createApp } from './app';
import { env } from './config/env';
import { logger } from './utils/logger';

const app = createApp();

const server = app.listen(env.port, () => {
  logger.info(`Service listening on port ${env.port} [${env.nodeEnv}]`);
});

function shutdown(signal: string): void {
  logger.info(`${signal} received, shutting down gracefully`);
  server.close((err) => {
    if (err) {
      logger.error(err, 'Error during shutdown');
      process.exit(1);
    }
    process.exit(0);
  });
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

process.on('unhandledRejection', (reason) => {
  logger.error(reason, 'Unhandled Rejection');
});

process.on('uncaughtException', (err) => {
  logger.error(err, 'Uncaught Exception');
  process.exit(1);
});