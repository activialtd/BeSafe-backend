import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ResilientHttp } from '@/common/resilient-http';
import type { AppEnv } from '@/config/env';

export interface SmsResult {
  ok: boolean;
  provider: string;
  providerRef?: string;
  error?: string;
}

@Injectable()
export class NotificationsService implements OnModuleInit {
  private readonly logger = new Logger(NotificationsService.name);
  private http?: ResilientHttp;
  private stub!: boolean;
  private from?: string;

  constructor(private readonly config: ConfigService<AppEnv, true>) {}

  onModuleInit() {
    this.stub = this.config.get('FEATURE_STUB_SMS', { infer: true });
    const sid = this.config.get('TWILIO_ACCOUNT_SID', { infer: true });
    const token = this.config.get('TWILIO_AUTH_TOKEN', { infer: true });
    this.from = this.config.get('TWILIO_FROM_NUMBER', { infer: true });
    if (!this.stub && sid && token && this.from) {
      const auth = Buffer.from(`${sid}:${token}`).toString('base64');
      this.http = new ResilientHttp({
        name: 'twilio',
        baseURL: `https://api.twilio.com/2010-04-01/Accounts/${sid}`,
        timeoutMs: this.config.get('TWILIO_TIMEOUT_MS', { infer: true }),
        headers: {
          Authorization: `Basic ${auth}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      });
    } else if (!this.stub) {
      this.logger.warn('Twilio not configured — SMS will silently no-op');
    }
  }

  async sendSms(to: string, body: string): Promise<SmsResult> {
    if (this.stub) {
      this.logger.log(`[STUB SMS] to=${to} body="${body}"`);
      return { ok: true, provider: 'stub' };
    }
    if (!this.http || !this.from) {
      this.logger.warn(`SMS not sent (no provider) to=${to}`);
      return { ok: false, provider: 'none', error: 'not_configured' };
    }
    try {
      const params = new URLSearchParams({ To: to, From: this.from, Body: body });
      const data = await this.http.request<{ sid: string }>({
        method: 'POST',
        url: '/Messages.json',
        data: params.toString(),
      });
      return { ok: true, provider: 'twilio', providerRef: data.sid };
    } catch (err) {
      // ApiError already normalised, but we don't want to throw — SMS failures shouldn't abort SOS
      this.logger.error(`SMS failed to=${to}: ${(err as Error).message}`);
      return { ok: false, provider: 'twilio', error: (err as Error).message };
    }
  }

  async sendManySms(recipients: { to: string; body: string }[]): Promise<SmsResult[]> {
    return Promise.all(recipients.map((r) => this.sendSms(r.to, r.body)));
  }
}
