import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { AppEnv } from "@/config/env";
import { ApiError } from "@/common/api-error";
import { ResilientHttp } from "@/common/resilient-http";

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
  abstract verifyDriverLicense(
    licenseNumber: string,
    dateOfBirth?: string,
  ): Promise<LicenseResult>;
}

// ── Dojah Adapter (NIN & Driver's License) ────────────────
// Docs: https://docs.dojah.io/reference/kyc-nin
@Injectable()
export class DojahAdapter implements OnModuleInit {
  private http!: ResilientHttp;
  private readonly logger = new Logger(DojahAdapter.name);

  constructor(private readonly config: ConfigService<AppEnv, true>) {}

  onModuleInit() {
    this.http = new ResilientHttp({
      name: "dojah",
      baseURL: this.config.get("DOJAH_BASE_URL", { infer: true }),
      timeoutMs: this.config.get("DOJAH_TIMEOUT_MS", { infer: true }),
      headers: {
        AppId: this.config.get("DOJAH_APP_ID", { infer: true }),
        Authorization: this.config.get("DOJAH_PRIVATE_KEY", { infer: true }),
        "Content-Type": "application/json",
      },
    });
  }

  async lookupNin(nin: string): Promise<NinResult> {
    const data = await this.http.request<{ entity?: any; error?: string }>({
      method: "GET",
      url: `/api/v1/kyc/nin?nin=${nin}`,
    });

    if (!data.entity) {
      return { ok: false, provider: "dojah", raw: data };
    }

    const d = data.entity;
    return {
      ok: true,
      fullName: [d.first_name, d.middle_name, d.last_name]
        .filter(Boolean)
        .join(" ")
        .trim(),
      dateOfBirth: d.date_of_birth,
      gender: d.gender,
      photoBase64: d.photo,
      provider: "dojah",
      raw: data,
    };
  }

  async lookupLicense(
    licenseNumber: string,
    dob?: string,
  ): Promise<LicenseResult> {
    const query = new URLSearchParams({ dl_number: licenseNumber });
    if (dob) query.append("dob", dob);

    const data = await this.http.request<{ entity?: any; error?: string }>({
      method: "GET",
      url: `/api/v1/kyc/dl?${query.toString()}`,
    });

    if (!data.entity) {
      return { ok: false, provider: "dojah", raw: data };
    }

    const r = data.entity;
    return {
      ok: true,
      fullName: [r.first_name, r.middle_name, r.last_name]
        .filter(Boolean)
        .join(" ")
        .trim(),
      licenseClass: r.class,
      expiryDate: r.expiry_date,
      issueDate: r.issue_date,
      provider: "dojah",
      raw: data,
    };
  }
}

// ── Facade ────────────────────────────────────────────────
@Injectable()
export class IdentityService extends IdentityProvider {
  private readonly logger = new Logger(IdentityService.name);
  private readonly stub: boolean;

  constructor(
    private readonly config: ConfigService<AppEnv, true>,
    private readonly dojah: DojahAdapter,
  ) {
    super();
    this.stub = this.config.get("FEATURE_STUB_IDENTITY_PROVIDERS", {
      infer: true,
    });
  }

  async verifyNin(nin: string, dob?: string): Promise<NinResult> {
    if (!/^\d{11}$/.test(nin)) {
      throw new ApiError({
        code: "INVALID_INPUT",
        message: "NIN must be exactly 11 digits",
      });
    }

    if (this.stub) {
      this.logger.warn(`STUB NIN verify for ${nin.slice(0, 3)}***`);
      return {
        ok: true,
        fullName: "Stub Verified User",
        dateOfBirth: "1995-01-01",
        gender: "F",
        provider: "stub",
      };
    }
    return this.dojah.lookupNin(nin);
  }

  async verifyDriverLicense(
    licenseNumber: string,
    dob?: string,
  ): Promise<LicenseResult> {
    if (!licenseNumber || licenseNumber.length < 5) {
      throw new ApiError({
        code: "INVALID_INPUT",
        message: "License number is invalid",
      });
    }

    if (this.stub) {
      this.logger.warn(`STUB license verify for ${licenseNumber}`);
      return {
        ok: true,
        fullName: "Stub Verified Driver",
        licenseClass: "D",
        issueDate: "2020-06-15",
        expiryDate: "2028-06-15",
        provider: "stub",
      };
    }
    return this.dojah.lookupLicense(licenseNumber, dob);
  }
}
