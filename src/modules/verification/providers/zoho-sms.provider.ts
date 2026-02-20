import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';

@Injectable()
export class ZohoSmsProvider {
  private readonly logger = new Logger(ZohoSmsProvider.name);
  private readonly apiKey: string;
  private readonly senderId: string;
  private readonly templateId: string;
  private readonly apiUrl: string;

  constructor(private configService: ConfigService) {
    this.apiKey = this.configService.get<string>('ZOHO_SMS_API_KEY');
    this.senderId = this.configService.get<string>('ZOHO_SMS_SENDER_ID');
    this.templateId = this.configService.get<string>('ZOHO_SMS_TEMPLATE_ID');
    this.apiUrl = this.configService.get<string>('ZOHO_SMS_API_URL');
  }

  async sendSms(to: string, message: string): Promise<any> {
    try {
      const payload = {
        sender: this.senderId,
        recipient: to,
        message,
        template_id: this.templateId, // Required if using DLT template (India)
      };

      const response = await axios.post(this.apiUrl, payload, {
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Zoho-oauthtoken ${this.apiKey}`,
        },
      });

      this.logger.log(`SMS sent successfully to ${to}`);
      return response.data;
    } catch (error) {
      const err = error as any;

      this.logger.error(
        `Failed to send SMS to ${to}`,
        JSON.stringify(
          {
            message: err.message,
            status: err.response?.status,
            data: err.response?.data,
          },
          null,
          2,
        ),
      );

      throw new Error('SMS sending failed');
    }
  }
}