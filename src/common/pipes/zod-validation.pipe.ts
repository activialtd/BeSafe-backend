import { PipeTransform } from '@nestjs/common';
import { ZodError, ZodTypeAny, z } from 'zod';
import { ApiError } from '../api-error';

export class ZodValidationPipe<T extends ZodTypeAny> implements PipeTransform {
  constructor(private readonly schema: T) {}
  transform(value: unknown): z.infer<T> {
    try {
      return this.schema.parse(value);
    } catch (err) {
      if (err instanceof ZodError) {
        throw new ApiError({
          code: 'VALIDATION_ERROR',
          message: 'Request validation failed',
          details: err.issues.map((i) => ({
            path: i.path.join('.'),
            message: i.message,
          })),
        });
      }
      throw err;
    }
  }
}
