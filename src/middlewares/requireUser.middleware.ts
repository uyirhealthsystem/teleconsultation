
import type { Request, Response, NextFunction } from "express";

export interface AuthenticatedRequest extends Request {
  userId: string;
  userRole: string;
}

export function requireUser(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  const userId = req.header("x-user-id");
  const userRole = req.header("x-user-role");

  if (!userId || !userRole) {
    res.status(401).json({
      success: false,
      message: "Authentication required",
    });
    return;
  }

  (req as AuthenticatedRequest).userId = userId;
  (req as AuthenticatedRequest).userRole = userRole;

  next();
}
