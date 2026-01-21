// common/middleware/request-id.middleware.ts
// import { v4 as uuid } from 'uuid';
import { randomUUID } from 'crypto';

import { Request, Response, NextFunction } from 'express';

export function requestIdMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  const requestId = req.headers['x-request-id'] || randomUUID();
  req['requestId'] = requestId;
  res.setHeader('x-request-id', requestId);
  next();
}
