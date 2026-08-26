import { HttpException, HttpStatus } from '@nestjs/common';

export type ErrorCode =
  | 'VALIDATION_ERROR'
  | 'UNAUTHENTICATED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'RATE_LIMITED'
  | 'EXTERNAL_PROVIDER_ERROR'
  | 'EXTERNAL_PROVIDER_TIMEOUT'
  | 'CIRCUIT_OPEN'
  | 'INVALID_STATE'
  | 'INVALID_INPUT'
  | 'INVALID_CREDENTIALS'
  | 'OTP_EXPIRED'
  | 'OTP_INVALID'
  | 'OTP_TOO_MANY_ATTEMPTS'
  | 'VEHICLE_NOT_VERIFIED'
  | 'VEHICLE_REVOKED'
  | 'RIDE_NOT_ACTIVE'
  | 'SOS_ALREADY_ACTIVE'
  | 'PIN_WRONG'
  | 'PIN_NOT_SET'
  | 'DRIVER_SUSPENDED'
  | 'INTERNAL_ERROR';

interface ApiErrorOptions {
  code: ErrorCode;
  message: string;
  status?: HttpStatus;
  details?: unknown;
  cause?: unknown;
}

/**
 * All controllers throw this — the global filter turns it into a shaped response.
 * Never throw raw errors from business logic; always wrap them.
 */
export class ApiError extends HttpException {
  public readonly code: ErrorCode;
  public readonly details?: unknown;

  constructor(opts: ApiErrorOptions) {
    super(
      { code: opts.code, message: opts.message, details: opts.details },
      opts.status ?? ApiError.statusFor(opts.code),
    );
    this.code = opts.code;
    this.details = opts.details;
    if (opts.cause) (this as any).cause = opts.cause;
  }

  static statusFor(code: ErrorCode): HttpStatus {
    switch (code) {
      case 'VALIDATION_ERROR':
      case 'INVALID_INPUT':
      case 'INVALID_STATE':
      case 'OTP_EXPIRED':
      case 'OTP_INVALID':
      case 'PIN_WRONG':
      case 'PIN_NOT_SET':
        return HttpStatus.BAD_REQUEST;
      case 'UNAUTHENTICATED':
      case 'INVALID_CREDENTIALS':
        return HttpStatus.UNAUTHORIZED;
      case 'FORBIDDEN':
      case 'DRIVER_SUSPENDED':
      case 'VEHICLE_REVOKED':
        return HttpStatus.FORBIDDEN;
      case 'NOT_FOUND':
      case 'VEHICLE_NOT_VERIFIED':
        return HttpStatus.NOT_FOUND;
      case 'CONFLICT':
      case 'SOS_ALREADY_ACTIVE':
      case 'RIDE_NOT_ACTIVE':
        return HttpStatus.CONFLICT;
      case 'RATE_LIMITED':
      case 'OTP_TOO_MANY_ATTEMPTS':
        return HttpStatus.TOO_MANY_REQUESTS;
      case 'EXTERNAL_PROVIDER_TIMEOUT':
        return HttpStatus.GATEWAY_TIMEOUT;
      case 'EXTERNAL_PROVIDER_ERROR':
      case 'CIRCUIT_OPEN':
        return HttpStatus.BAD_GATEWAY;
      case 'INTERNAL_ERROR':
      default:
        return HttpStatus.INTERNAL_SERVER_ERROR;
    }
  }
}
