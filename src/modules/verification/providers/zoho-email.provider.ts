// src/verification/providers/zoho-email.provider.ts
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { IEmailProvider } from '../interfaces/email-provider.interface';

@Injectable()
export class ZohoEmailProvider implements IEmailProvider {
  private readonly logger = new Logger(ZohoEmailProvider.name);
  private readonly apiUrl: string;
  private readonly apiKey: string;
  private readonly fromEmail: string;

  constructor(private configService: ConfigService) {
    this.apiUrl = this.configService.get<string>('ZOHO_API_URL');
    this.apiKey = this.configService.get<string>('ZOHO_API_KEY');
    this.fromEmail = this.configService.get<string>('ZOHO_FROM_EMAIL');
  }

  async sendEmail(
    to: string,
    subject: string,
    body: string,
    html?: string,
  ): Promise<any> {
    try {
      const payload = {
        from: {
          address: this.fromEmail,
          name: 'noreply',
        },
        to: [
          {
            email_address: {
              address: to,
              name: to.split('@')[0],
            },
          },
        ],
        subject,
        ...(html ? { htmlbody: html } : { textbody: body }),
      };

      const response = await axios.post(this.apiUrl, payload, {
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          Authorization: `Zoho-enczapikey ${this.apiKey}`,
        },
      });
      this.logger.log(`Email sent to ${to}`);
      return response.data;
    } catch (error) {
      const err = error as any;

      this.logger.error(
        `Failed to send email to ${to}`,
        JSON.stringify(
          {
            message: err.message,
            code: err.code,
            status: err.response?.status,
            data: err.response?.data,
            headers: err.response?.headers,
          },
          null,
          2,
        ),
      );

      // this.logger.error(
      //   `Failed to send email to ${to}`,
      //   JSON.stringify(error?.response?.data || error, null, 2),
      // );
      throw new Error(`Email sending failed`);
    }
  }

  async sendOtp(to: string, otp: string, templateId?: string): Promise<any> {
    const subject = 'Your Verification Code';
    const html = this.generateOtpEmail(otp);

    return this.sendEmail(to, subject, `Your OTP is: ${otp}`, html);
  }

  async validateEmail(email: string): Promise<boolean> {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  }

  private generateOtpEmail(otp: string): string {
    return `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          .container { max-width: 600px; margin: 0 auto; padding: 20px; font-family: Arial, sans-serif; }
          .header { background-color: #4F46E5; color: white; padding: 20px; text-align: center; }
          .content { padding: 30px; background-color: #f9f9f9; }
          .otp-code { font-size: 32px; font-weight: bold; color: #4F46E5; text-align: center; margin: 20px 0; }
          .footer { text-align: center; padding: 20px; color: #666; font-size: 12px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>Verification Code</h1>
          </div>
          <div class="content">
            <p>Hello,</p>
            <p>Your verification code is:</p>
            <div class="otp-code">${otp}</div>
            <p>This code will expire in 10 minutes.</p>
            <p>If you didn't request this code, please ignore this email.</p>
          </div>
          <div class="footer">
            <p>&copy; ${new Date().getFullYear()} Your Company. All rights reserved.</p>
          </div>
        </div>
      </body>
      </html>
    `;
  }

  async sendOrderConfirmation(
    to: string,
    otp: string,
    templateId?: string,
  ): Promise<any> {
    const subject = 'Your Verification Code';
    const html = this.generateOtpEmail(otp);
     this.logger.log(`Sending order confirmation email to ${to}`);
    return this.sendEmail(to, subject, `Your OTP is: ${otp}`, html);
  }
}
