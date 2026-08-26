import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { ZodError } from 'zod';
import { ApiError, ErrorCode } from '../api-error';

interface ErrorPayload {
  ok: false;
  error: {
    code: ErrorCode;
    message: string;
    details?: unknown;
  };
  correlationId: string;
  timestamp: string;
}

/**
 * Backstop for every uncaught error in the HTTP layer.
 * Never lets an exception crash the app or leak a stack trace.
 */
@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const req = ctx.getRequest<Request>();
    const res = ctx.getResponse<Response>();
    const correlationId = req?.correlationId ?? 'no-cor-id';

    const { status, payload } = this.normalise(exception, correlationId);

    // Log with severity based on status
    const logCtx = {
      corId: correlationId,
      path: req?.originalUrl,
      method: req?.method,
      status,
      code: payload.error.code,
    };
    if (status >= 500) {
      this.logger.error(
        `${payload.error.code} — ${payload.error.message} ${JSON.stringify(logCtx)}`,
        exception instanceof Error ? exception.stack : undefined,
      );
    } else if (status >= 400) {
      this.logger.warn(`${payload.error.code} — ${payload.error.message} ${JSON.stringify(logCtx)}`);
    }

    if (res && !res.headersSent) {
      res.status(status).json(payload);
    }
  }

  private normalise(
    exception: unknown,
    correlationId: string,
  ): { status: number; payload: ErrorPayload } {
    // Our own ApiError → straight through
    if (exception instanceof ApiError) {
      const response = exception.getResponse() as {
        code: ErrorCode;
        message: string;
        details?: unknown;
      };
      return {
        status: exception.getStatus(),
        payload: {
          ok: false,
          error: {
            code: response.code,
            message: response.message,
            details: response.details,
          },
          correlationId,
          timestamp: new Date().toISOString(),
        },
      };
    }

    // Zod validation
    if (exception instanceof ZodError) {
      return {
        status: HttpStatus.BAD_REQUEST,
        payload: {
          ok: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Request validation failed',
            details: exception.issues.map((i) => ({
              path: i.path.join('.'),
              message: i.message,
            })),
          },
          correlationId,
          timestamp: new Date().toISOString(),
        },
      };
    }

    // Any Nest HttpException we didn't wrap ourselves
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const resp = exception.getResponse();
      let message = exception.message;
      let details: unknown = undefined;
      if (typeof resp === 'object' && resp !== null) {
        const anyResp = resp as { message?: string | string[]; error?: string };
        if (Array.isArray(anyResp.message)) {
          details = anyResp.message;
          message = 'Request validation failed';
        } else if (typeof anyResp.message === 'string') {
          message = anyResp.message;
        }
      }
      return {
        status,
        payload: {
          ok: false,
          error: {
            code: this.codeForStatus(status),
            message,
            details,
          },
          correlationId,
          timestamp: new Date().toISOString(),
        },
      };
    }

    // Everything else: swallow the details, don't leak stack traces
    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      payload: {
        ok: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'An unexpected error occurred. Support has been notified.',
        },
        correlationId,
        timestamp: new Date().toISOString(),
      },
    };
  }

  private codeForStatus(status: number): ErrorCode {
    if (status === 400) return 'VALIDATION_ERROR';
    if (status === 401) return 'UNAUTHENTICATED';
    if (status === 403) return 'FORBIDDEN';
    if (status === 404) return 'NOT_FOUND';
    if (status === 409) return 'CONFLICT';
    if (status === 429) return 'RATE_LIMITED';
    if (status === 504) return 'EXTERNAL_PROVIDER_TIMEOUT';
    if (status === 502) return 'EXTERNAL_PROVIDER_ERROR';
    return 'INTERNAL_ERROR';
  }
}
