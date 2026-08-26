import axios, { AxiosInstance, AxiosRequestConfig } from 'axios';
import axiosRetry from 'axios-retry';
import CircuitBreaker from 'opossum';
import { Logger } from '@nestjs/common';
import { ApiError } from '@/common/api-error';

interface Options {
  name: string;
  baseURL: string;
  timeoutMs: number;
  headers?: Record<string, string>;
  circuitOptions?: CircuitBreaker.Options;
}

/**
 * Wrap an external HTTP call in retry + circuit breaker + timeout.
 * If the breaker is open we fail fast with CIRCUIT_OPEN so callers can
 * degrade instead of piling up requests against a dead upstream.
 */
export class ResilientHttp {
  private readonly logger: Logger;
  private readonly axios: AxiosInstance;
  private readonly breaker: CircuitBreaker;

  constructor(opts: Options) {
    this.logger = new Logger(`ResilientHttp:${opts.name}`);
    this.axios = axios.create({
      baseURL: opts.baseURL,
      timeout: opts.timeoutMs,
      headers: opts.headers,
    });
    axiosRetry(this.axios, {
      retries: 2,
      retryDelay: axiosRetry.exponentialDelay,
      retryCondition: (err) =>
        axiosRetry.isNetworkOrIdempotentRequestError(err) ||
        (!!err.response && err.response.status >= 500),
    });

    this.breaker = new CircuitBreaker(
      (config: AxiosRequestConfig) => this.axios.request(config),
      {
        timeout: opts.timeoutMs + 2000, // slack over axios timeout
        errorThresholdPercentage: 50,
        resetTimeout: 20000,
        rollingCountTimeout: 30000,
        rollingCountBuckets: 10,
        name: opts.name,
        ...opts.circuitOptions,
      },
    );
    this.breaker.on('open', () => this.logger.warn('Circuit breaker OPEN'));
    this.breaker.on('halfOpen', () => this.logger.log('Circuit breaker HALF-OPEN'));
    this.breaker.on('close', () => this.logger.log('Circuit breaker CLOSED'));
  }

  async request<T>(config: AxiosRequestConfig): Promise<T> {
    try {
      const res = (await this.breaker.fire(config)) as { data: T };
      return res.data;
    } catch (err) {
      const anyErr = err as any;
      if (anyErr?.code === 'EOPENBREAKER') {
        throw new ApiError({
          code: 'CIRCUIT_OPEN',
          message: 'Upstream provider is temporarily unavailable',
        });
      }
      if (anyErr?.code === 'ETIMEDOUT' || anyErr?.code === 'ECONNABORTED') {
        throw new ApiError({
          code: 'EXTERNAL_PROVIDER_TIMEOUT',
          message: 'Upstream provider timed out',
          cause: err,
        });
      }
      const status: number | undefined = anyErr?.response?.status;
      const body = anyErr?.response?.data;
      throw new ApiError({
        code: 'EXTERNAL_PROVIDER_ERROR',
        message: `Upstream provider failed (${status ?? 'no response'})`,
        details: body,
        cause: err,
      });
    }
  }
}
