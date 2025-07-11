import { Request, Response, NextFunction } from 'express';
import * as admin from 'firebase-admin';

// Define the extended request type
export interface RequestWithUser extends Request {
  user?: admin.auth.DecodedIdToken;
}

export const verifyToken = async (req: Request, res: Response, next: NextFunction) => {
  const token = req.headers.authorization?.split('Bearer ')[1];

  if (!token) {
    return res.status(401).json({ message: 'No token provided' });
  }

  try {
    const decodedToken = await admin.auth().verifyIdToken(token);
    (req as RequestWithUser).user = decodedToken;
    next();
  } catch (error) {
    res.status(401).json({ message: 'Invalid token' });
  }
};

export const checkRole = (roles: string[]) => {
  return (req: Request, res: Response, next: NextFunction) => {
    const userReq = req as RequestWithUser;
    if (!userReq.user) {
      return res.status(401).json({ message: 'Unauthorized' });
    }

    const userRole = userReq.user.role;
    if (roles.includes(userRole)) {
      next();
    } else {
      res.status(403).json({ message: 'Forbidden' });
    }
  };
};
