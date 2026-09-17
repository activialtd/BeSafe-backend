import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { AppEnv } from "@/config/env";
import { ResilientHttp } from "@/common/resilient-http";

export interface SmsPayload {
  to: string;
  body: string;
}

export interface SmsResult {
  ok: boolean;
  providerRef?: string;
  error?: unknown;
}

@Injectable()
export class NotificationsService implements OnModuleInit {
  private http!: ResilientHttp;
  private apiKey!: string;
  private senderId!: string;
  private readonly logger = new Logger(NotificationsService.name);

  constructor(private readonly config: ConfigService<AppEnv, true>) {}

  onModuleInit() {
    this.apiKey = this.config.get("TERMII_API_KEY", { infer: true });
    this.senderId = this.config.get("TERMII_SENDER_ID", { infer: true });

    this.http = new ResilientHttp({
      name: "termii",
      baseURL: this.config.get("TERMII_BASE_URL", { infer: true }),
      timeoutMs: this.config.get("TERMII_TIMEOUT_MS", { infer: true }),
      headers: {
        "Content-Type": "application/json",
      },
    });
  }

  async sendManySms(messages: SmsPayload[]): Promise<SmsResult[]> {
    // Termii allows batching, but for SOS, mapping over individual concurrent requests is often safer
    // to isolate failures per recipient.
    return Promise.all(messages.map((msg) => this.sendSms(msg.to, msg.body)));
  }

  private async sendSms(to: string, body: string): Promise<SmsResult> {
    try {
      // Clean phone number (ensure international format without '+' for Termii if required)
      const formattedNumber = to.replace("+", "");

      const response = await this.http.request<{
        message_id?: string;
        message?: string;
      }>({
        method: "POST",
        url: "/api/sms/send",
        data: {
          to: formattedNumber,
          from: this.senderId,
          sms: body,
          type: "plain",
          channel: "generic", // 'dnd' is recommended for OTPs, 'generic' for transactional updates
          api_key: this.apiKey,
        },
      });

      return {
        ok: !!response.message_id,
        providerRef: response.message_id,
      };
    } catch (error) {
      this.logger.error(`Termii SMS failed to ${to}: ${error}`);
      return { ok: false, error };
    }
  }
}
