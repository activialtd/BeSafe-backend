import { Injectable, NestMiddleware } from '@nestjs/common';
import { NextFunction, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';

export const CORRELATION_HEADER = 'x-correlation-id';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      correlationId: string;
    }
  }
}

@Injectable()
export class CorrelationIdMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction) {
    const incoming = req.header(CORRELATION_HEADER);
    const corId = incoming && incoming.length <= 64 ? incoming : uuidv4();
    req.correlationId = corId;
    res.setHeader(CORRELATION_HEADER, corId);
    next();
  }
}
