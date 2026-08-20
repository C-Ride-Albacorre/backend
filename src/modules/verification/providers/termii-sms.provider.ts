// src/verification/providers/termii-sms.provider.ts
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { ISmsProvider } from '../interfaces/sms-provider.interface';

@Injectable()
export class TermiiSmsProvider implements ISmsProvider {
  private readonly logger = new Logger(TermiiSmsProvider.name);
  private readonly apiUrl: string;
  private readonly apiKey: string;
  private readonly senderId: string;
  private readonly channel: string;

  constructor(private configService: ConfigService) {
    this.apiUrl = this.configService.get<string>(
      'TERMII_API_URL',
      'https://api.ng.termii.com',
    );
    this.apiKey = this.configService.get<string>('TERMII_API_KEY');
    this.senderId = this.configService.get<string>('TERMII_SENDER_ID');
    this.channel = this.configService.get<string>('TERMII_CHANNEL', 'dnd');
  }

  async sendSms(to: string, message: string): Promise<any> {
    try {
      const response = await axios.post(`${this.apiUrl}/api/sms/send`, {
        to,
        from: this.senderId,
        sms: message,
        type: 'plain',
        channel: this.channel,
        api_key: this.apiKey,
      });

      this.logger.log(`SMS sent to ${to}: ${response.data.message}: `);
      return response.data;
    } catch (error) {
      this.logger.error(`Failed to send SMS to ${to}: ${error.message}`);
      throw new Error(`SMS sending failed: ${error.message}`);
    }
  }

  async sendOtp(to: string, otp: string, templateId?: string): Promise<any> {
    const message = `Your verification code is: ${otp}. Valid for 10 minutes.`;

    return this.sendSms(to, message);
  }

  async getBalance(): Promise<number> {
    try {
      const response = await axios.get(`${this.apiUrl}/api/get-balance`, {
        params: { api_key: this.apiKey },
      });

      return response.data.balance;
    } catch (error) {
      this.logger.error(`Failed to get balance: ${error.message}`);
      return 0;
    }
  }

  async validatePhoneNumber(phoneNumber: string): Promise<boolean> {
    // Simple validation - extend with proper library
    const phoneRegex = /^\+?[1-9]\d{1,14}$/;
    return phoneRegex.test(phoneNumber);
  }
}
