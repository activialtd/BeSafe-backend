import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Request } from 'express';
import { Observable, map } from 'rxjs';

interface SuccessEnvelope<T> {
  ok: true;
  data: T;
  correlationId: string;
  timestamp: string;
}

/**
 * Wraps every successful HTTP response in a consistent envelope so the
 * mobile client can always destructure `{ok, data|error, correlationId}`.
 * If a handler already returns `{ok:false}` we leave it alone.
 */
@Injectable()
export class ResponseEnvelopeInterceptor<T> implements NestInterceptor<T, SuccessEnvelope<T> | T> {
  intercept(
    ctx: ExecutionContext,
    next: CallHandler<T>,
  ): Observable<SuccessEnvelope<T> | T> {
    const req = ctx.switchToHttp().getRequest<Request>();
    const correlationId = req?.correlationId ?? 'no-cor-id';
    return next.handle().pipe(
      map((data) => {
        if (data && typeof data === 'object' && (data as { ok?: unknown }).ok === false) {
          return data;
        }
        return {
          ok: true,
          data,
          correlationId,
          timestamp: new Date().toISOString(),
        };
      }),
    );
  }
}
