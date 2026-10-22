import { NextFunction, Request, Response } from 'express';
import { ApiError } from '../utils/ApiError';
import { logger } from '../utils/logger';

export function errorHandler(
  err: Error | ApiError,
  _req: Request,
  res: Response,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _next: NextFunction,
): void {
  const statusCode = err instanceof ApiError ? err.statusCode : 500;
  const message = err instanceof ApiError ? err.message : 'Internal Server Error';

  if (statusCode >= 500) {
    logger.error({ err }, message);
  } else {
    logger.warn({ err }, message);
  }

  res.status(statusCode).json({
    status: 'error',
    statusCode,
    message,
  });
}
