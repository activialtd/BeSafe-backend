import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AppEnv } from '@/config/env';
import { ApiError } from '@/common/api-error';
import { ResilientHttp } from '@/common/resilient-http';

// ── Ports ─────────────────────────────────────────────────
export interface NinResult {
  ok: boolean;
  fullName?: string;
  dateOfBirth?: string;
  gender?: string;
  photoBase64?: string;
  provider: string;
  providerRef?: string;
  raw?: unknown;
}
export interface LicenseResult {
  ok: boolean;
  fullName?: string;
  licenseClass?: string;
  expiryDate?: string;
  issueDate?: string;
  provider: string;
  providerRef?: string;
  raw?: unknown;
}

export abstract class IdentityProvider {
  abstract verifyNin(nin: string, dateOfBirth?: string): Promise<NinResult>;
  abstract verifyDriverLicense(licenseNumber: string, dateOfBirth?: string): Promise<LicenseResult>;
}

// ── Mono adapter (NIN) ────────────────────────────────────
// Docs: https://docs.mono.co/reference/nin-lookup
@Injectable()
export class MonoAdapter implements OnModuleInit {
  private http!: ResilientHttp;
  private readonly logger = new Logger(MonoAdapter.name);

  constructor(private readonly config: ConfigService<AppEnv, true>) {}

  onModuleInit() {
    this.http = new ResilientHttp({
      name: 'mono',
      baseURL: this.config.get('MONO_BASE_URL', { infer: true }),
      timeoutMs: this.config.get('MONO_TIMEOUT_MS', { infer: true }),
      headers: {
        'mono-sec-key': this.config.get('MONO_SECRET_KEY', { infer: true }),
        'Content-Type': 'application/json',
      },
    });
  }

  async lookupNin(nin: string, dob?: string): Promise<NinResult> {
    const body: Record<string, unknown> = { nin };
    if (dob) body.date_of_birth = dob;
    // Mono NIN lookup endpoint — /v2/lookup/nin
    const data = await this.http.request<{ status?: string; data?: any; message?: string }>({
      method: 'POST',
      url: '/v2/lookup/nin',
      data: body,
    });
    if (data.status && data.status !== 'successful') {
      return { ok: false, provider: 'mono', raw: data };
    }
    const d = data.data ?? {};
    return {
      ok: true,
      fullName: [d.first_name, d.middle_name, d.last_name].filter(Boolean).join(' ').trim() ||
        d.full_name,
      dateOfBirth: d.date_of_birth,
      gender: d.gender,
      photoBase64: d.photo,
      provider: 'mono',
      providerRef: d.session_id ?? d.reference,
      raw: data,
    };
  }
}

// ── VerifyMe adapter (Driver License) ─────────────────────
// Docs: https://docs.verifyme.ng/#drivers-license-verification
@Injectable()
export class VerifyMeAdapter implements OnModuleInit {
  private http!: ResilientHttp;
  private readonly logger = new Logger(VerifyMeAdapter.name);

  constructor(private readonly config: ConfigService<AppEnv, true>) {}

  onModuleInit() {
    this.http = new ResilientHttp({
      name: 'verifyme',
      baseURL: this.config.get('VERIFYME_BASE_URL', { infer: true }),
      timeoutMs: this.config.get('VERIFYME_TIMEOUT_MS', { infer: true }),
      headers: {
        userid: this.config.get('VERIFYME_USER_ID', { infer: true }),
        apiKey: this.config.get('VERIFYME_API_KEY', { infer: true }),
        'Content-Type': 'application/json',
      },
    });
  }

  async lookupLicense(licenseNumber: string, dob?: string): Promise<LicenseResult> {
    const body: Record<string, unknown> = {
      searchParameter: licenseNumber,
      verificationType: 'DRIVERS-LICENSE-FULL-DETAILS-VERIFICATION',
    };
    if (dob) body.dob = dob;
    const data = await this.http.request<{ response?: any; requestSuccessful?: boolean }>({
      method: 'POST',
      url: '/v2/biobject/drivers-license/full',
      data: body,
    });
    if (!data.requestSuccessful || !data.response) {
      return { ok: false, provider: 'verifyme', raw: data };
    }
    const r = data.response;
    return {
      ok: true,
      fullName: [r.firstName, r.middleName, r.lastName].filter(Boolean).join(' ').trim(),
      licenseClass: r.licenseClass ?? r.class,
      expiryDate: r.expiryDate,
      issueDate: r.issueDate,
      provider: 'verifyme',
      providerRef: r.reference,
      raw: data,
    };
  }
}

// ── Facade (also our IdentityProvider implementation) ────
@Injectable()
export class IdentityService extends IdentityProvider {
  private readonly logger = new Logger(IdentityService.name);
  private readonly stub: boolean;

  constructor(
    private readonly config: ConfigService<AppEnv, true>,
    private readonly mono: MonoAdapter,
    private readonly verifyme: VerifyMeAdapter,
  ) {
    super();
    this.stub = this.config.get('FEATURE_STUB_IDENTITY_PROVIDERS', { infer: true });
  }

  async verifyNin(nin: string, dob?: string): Promise<NinResult> {
    if (!/^\d{11}$/.test(nin)) {
      throw new ApiError({ code: 'INVALID_INPUT', message: 'NIN must be exactly 11 digits' });
    }
    if (this.stub) {
      this.logger.warn(`STUB NIN verify for ${nin.slice(0, 3)}***`);
      return {
        ok: true,
        fullName: 'Stub Verified User',
        dateOfBirth: '1995-01-01',
        gender: 'F',
        provider: 'stub',
        providerRef: `stub_${Date.now()}`,
      };
    }
    return this.mono.lookupNin(nin, dob);
  }

  async verifyDriverLicense(licenseNumber: string, dob?: string): Promise<LicenseResult> {
    if (!licenseNumber || licenseNumber.length < 5) {
      throw new ApiError({ code: 'INVALID_INPUT', message: 'License number is invalid' });
    }
    if (this.stub) {
      this.logger.warn(`STUB license verify for ${licenseNumber}`);
      return {
        ok: true,
        fullName: 'Stub Verified Driver',
        licenseClass: 'D',
        issueDate: '2020-06-15',
        expiryDate: '2028-06-15',
        provider: 'stub',
        providerRef: `stub_${Date.now()}`,
      };
    }
    return this.verifyme.lookupLicense(licenseNumber, dob);
  }
}
