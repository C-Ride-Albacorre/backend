// src/verification/providers/console.provider.ts
import { Injectable, Logger } from '@nestjs/common';
import { IEmailProvider } from '../interfaces/email-provider.interface';
import { ISmsProvider } from '../interfaces/sms-provider.interface';

@Injectable()
export class ConsoleEmailProvider implements IEmailProvider {
  private readonly logger = new Logger(ConsoleEmailProvider.name);

  async sendEmail(
    to: string,
    subject: string,
    body: string,
    html?: string,
  ): Promise<any> {
    this.logger.log(`[DEV] Email to ${to}:`);
    this.logger.log(`Subject: ${subject}`);
    this.logger.log(`Body: ${body}`);
    if (html) this.logger.log(`HTML: ${html.substring(0, 200)}...`);

    return { success: true, dev: true, to, subject };
  }

  async sendOtp(to: string, otp: string, templateId?: string): Promise<any> {
    return this.sendEmail(to, 'Your OTP Code', `Your OTP is: ${otp}`);
  }

  async validateEmail(email: string): Promise<boolean> {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  }
}

@Injectable()
export class ConsoleSmsProvider implements ISmsProvider {
  private readonly logger = new Logger(ConsoleSmsProvider.name);

  async sendSms(to: string, message: string): Promise<any> {
    this.logger.log(`[DEV] SMS to ${to}: ${message}`);
    return { success: true, dev: true, to, message };
  }

  async sendOtp(to: string, otp: string, templateId?: string): Promise<any> {
    return this.sendSms(to, `Your OTP is: ${otp}`);
  }

  async getBalance(): Promise<number> {
    return 1000; // Mock balance
  }

  async validatePhoneNumber(phoneNumber: string): Promise<boolean> {
    return true;
  }
}
