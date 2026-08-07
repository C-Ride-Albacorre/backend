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


  async sendVendorOrderNotification(
  to: string,
  orderNumber: string,
): Promise<any> {
  const subject = `New Order Received #${orderNumber}`;
  const html = this.generateVendorOrderNotificationEmail(orderNumber);

  this.logger.log(`Sending vendor order notification email to ${to}`);

  return this.sendEmail(
    to,
    subject,
    `A new order (${orderNumber}) has been placed and requires your attention.`,
    html,
  );
}

  

async sendOrderConfirmation(
  to: string,
  orderNumber: string,
): Promise<any> {
  const subject = `Order Confirmation #${orderNumber}`;
  const html = this.generateOrderConfirmationEmail(orderNumber);

  this.logger.log(`Sending order confirmation email to ${to}`);

  return this.sendEmail(
    to,
    subject,
    `Your order ${orderNumber} has been successfully confirmed.`,
    html,
  );
}



 async sendPickupConfirmation(
  to: string,
  orderNumber: string,
  driverName?: string,
): Promise<any> {
  const subject = `Your Order #${orderNumber} Has Been Picked Up 🚚`;
  const html = this.generatePickupConfirmationEmail(orderNumber, driverName);

  this.logger.log(`Sending pickup confirmation email to ${to}`);

  return this.sendEmail(
    to,
    subject,
    `Your order ${orderNumber} has been picked up and is on its way.`,
    html,
  );
}

private generatePickupConfirmationEmail(
  orderNumber: string,
  driverName?: string,
): string {
  const trackingUrl = `https://yourdomain.com/track-order?orderId=${orderNumber}`;

  return `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="UTF-8" />
        <title>Order Picked Up</title>
      </head>
      <body style="font-family: Arial, sans-serif; background-color: #f4f4f4; padding: 20px;">
        <div style="max-width: 600px; margin: 0 auto; background: #ffffff; border-radius: 8px; padding: 30px;">

          <h2 style="color: #333333; text-align: center;">
            Your Order Has Been Picked Up 🚚
          </h2>

          <p style="font-size: 16px; color: #555555;">
            Great news! Your order has been picked up and is now on its way to you.
          </p>

          <div style="background: #f8f9fa; padding: 15px; border-radius: 6px; text-align: center; margin: 20px 0;">
            <p style="margin: 0; color: #666;">Order Number</p>
            <h3 style="margin: 10px 0; color: #000;">
              ${orderNumber}
            </h3>
          </div>

          ${
            driverName
              ? `
          <p style="font-size: 16px; color: #555555;">
            <strong>Driver:</strong> ${driverName}
          </p>
          `
              : ''
          }

          <p style="font-size: 16px; color: #555555;">
            You can use your <strong>Order Number (${orderNumber})</strong> to track the status of your delivery at any time.
          </p>

          <div style="text-align: center; margin: 30px 0;">
            <a
              href="${trackingUrl}"
              style="
                display: inline-block;
                padding: 12px 24px;
                background-color: #007bff;
                color: #ffffff;
                text-decoration: none;
                border-radius: 6px;
                font-size: 16px;
                font-weight: bold;
              "
            >
              Track Your Order
            </a>
          </div>

          <p style="font-size: 14px; color: #777777; word-break: break-all;">
            If the button above doesn't work, copy and paste this link into your browser:
            <br />
            <a href="${trackingUrl}">${trackingUrl}</a>
          </p>

          <hr style="border: none; border-top: 1px solid #eeeeee; margin: 30px 0;" />

          <p style="font-size: 14px; color: #999999; text-align: center;">
            Thank you for shopping with us. Your order will be with you soon!
          </p>

        </div>
      </body>
    </html>
  `;
} 


private generateVendorOrderNotificationEmail(
  orderNumber: string,
): string {
  return `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="UTF-8" />
        <title>New Order Received</title>
      </head>
      <body style="font-family: Arial, sans-serif; background-color: #f4f4f4; padding: 20px;">
        <div style="max-width: 600px; margin: 0 auto; background: #ffffff; border-radius: 8px; padding: 30px;">

          <h2 style="color: #333333; text-align: center;">
            New Order Received 📦
          </h2>

          <p style="font-size: 16px; color: #555555;">
            A new customer order has been placed and is awaiting processing.
          </p>

          <div style="background: #f8f9fa; padding: 15px; border-radius: 6px; text-align: center; margin: 20px 0;">
            <p style="margin: 0; color: #666;">Order Number</p>
            <h3 style="margin: 10px 0; color: #000;">
              ${orderNumber}
            </h3>
          </div>

          <p style="font-size: 16px; color: #555555;">
            Please review the order details and begin fulfillment as soon as possible.
          </p>

          <p style="font-size: 16px; color: #555555;">
            Log in to your vendor dashboard to view the complete order information.
          </p>

          <hr style="border: none; border-top: 1px solid #eeeeee; margin: 30px 0;" />

          <p style="font-size: 14px; color: #999999; text-align: center;">
            This is an automated notification from the marketplace platform.
          </p>

        </div>
      </body>
    </html>
  `;
}

private generateOrderConfirmationEmail(orderNumber: string): string {
  return `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="UTF-8" />
        <title>Order Confirmation</title>
      </head>
      <body style="font-family: Arial, sans-serif; background-color: #f4f4f4; padding: 20px;">
        <div style="max-width: 600px; margin: 0 auto; background: #ffffff; border-radius: 8px; padding: 30px;">
          
          <h2 style="color: #333333; text-align: center;">
            Order Confirmed 🎉
          </h2>

          <p style="font-size: 16px; color: #555555;">
            Thank you for your order.
          </p>

          <p style="font-size: 16px; color: #555555;">
            Your order has been successfully confirmed and is now being processed.
          </p>

          <div style="background: #f8f9fa; padding: 15px; border-radius: 6px; text-align: center; margin: 20px 0;">
            <p style="margin: 0; color: #666;">Order Number</p>
            <h3 style="margin: 10px 0; color: #000;">
              ${orderNumber}
            </h3>
          </div>

          <p style="font-size: 16px; color: #555555;">
            We'll notify you once your order has been shipped.
          </p>

          <hr style="border: none; border-top: 1px solid #eeeeee; margin: 30px 0;" />

          <p style="font-size: 14px; color: #999999; text-align: center;">
            Thank you for shopping with us.
          </p>

        </div>
      </body>
    </html>
  `;
}
}
