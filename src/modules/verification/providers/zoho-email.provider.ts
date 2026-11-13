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



  async sendVendorApprovalNotification(
  to: string,
  vendorName?: string,
): Promise<any> {
  const subject = 'Your Vendor Account Has Been Approved';

  const html = this.generateVendorApprovalEmail(vendorName);

  this.logger.log(`Sending vendor approval email to ${to}`);

  return this.sendEmail(
    to,
    subject,
    'Your vendor account has been approved. You can now access your vendor dashboard.',
    html,
  );
}

private generateVendorApprovalEmail(vendorName?: string): string {
  return `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="UTF-8" />
        <title>Vendor Account Approved</title>
      </head>

      <body style="font-family: Arial, sans-serif; background-color: #f4f4f4; padding: 20px;">
        <div style="max-width: 600px; margin: 0 auto; background: #ffffff; border-radius: 8px; padding: 30px;">

          <h2 style="color: #333333; text-align: center;">
            Vendor Account Approved 🎉
          </h2>

          <p style="font-size: 16px; color: #555555;">
            Hello ${vendorName || 'Vendor'},
          </p>

          <p style="font-size: 16px; color: #555555;">
            Great news! Your vendor account has been reviewed and approved.
          </p>

          <div style="background: #f0fdf4; padding: 20px; border-radius: 6px; text-align: center; margin: 20px 0;">
            <p style="margin: 0; color: #166534; font-size: 18px; font-weight: bold;">
              Your account is now approved.
            </p>
          </div>

          <p style="font-size: 16px; color: #555555;">
            You can now log in to your vendor dashboard and start managing your store, products, and orders.
          </p>

          <p style="font-size: 16px; color: #555555;">
            Thank you for joining our marketplace. We look forward to having you on board.
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

async sendVendorRejectionNotification(
  to: string,
  vendorName?: string,
  rejectionReason?: string,
): Promise<any> {
  const subject = 'Your Vendor Application Has Been Rejected';
  const html = this.generateVendorRejectionEmail(
    vendorName,
    rejectionReason,
  );

  this.logger.log(`Sending vendor rejection email to ${to}`);

  return this.sendEmail(
    to,
    subject,
    'Your vendor application has been rejected.',
    html,
  );
}

private generateVendorRejectionEmail(
  vendorName?: string,
  rejectionReason?: string,
): string {
  return `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="UTF-8" />
        <title>Vendor Application Rejected</title>
      </head>

      <body style="font-family: Arial, sans-serif; background-color: #f4f4f4; padding: 20px;">
        <div style="max-width: 600px; margin: 0 auto; background: #ffffff; border-radius: 8px; padding: 30px;">

          <h2 style="color: #333333; text-align: center;">
            Vendor Application Update
          </h2>

          <p style="font-size: 16px; color: #555555;">
            Hello ${vendorName || 'Vendor'},
          </p>

          <p style="font-size: 16px; color: #555555;">
            Unfortunately, your vendor application has been rejected after review.
          </p>

          ${
            rejectionReason
              ? `
                <div style="background: #fef2f2; padding: 20px; border-radius: 6px; margin: 20px 0;">
                  <p style="margin: 0 0 8px; color: #991b1b; font-weight: bold;">
                    Reason for rejection:
                  </p>

                  <p style="margin: 0; color: #555555;">
                    ${rejectionReason}
                  </p>
                </div>
              `
              : ''
          }

          <p style="font-size: 16px; color: #555555;">
            Please review the feedback and make the necessary changes before submitting your application again.
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

async sendVendorSuspensionNotification(
  to: string,
  vendorName?: string,
  reason?: string,
): Promise<any> {
  const subject = 'Your Vendor Account Has Been Suspended';
  const html = this.generateVendorSuspensionEmail(vendorName, reason);

  this.logger.log(`Sending vendor suspension email to ${to}`);

  return this.sendEmail(
    to,
    subject,
    'Your vendor account has been suspended.',
    html,
  );
}

private generateVendorSuspensionEmail(
  vendorName?: string,
  reason?: string,
): string {
  return `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="UTF-8" />
        <title>Vendor Account Suspended</title>
      </head>

      <body style="font-family: Arial, sans-serif; background-color: #f4f4f4; padding: 20px;">
        <div style="max-width: 600px; margin: 0 auto; background: #ffffff; border-radius: 8px; padding: 30px;">

          <h2 style="color: #333333; text-align: center;">
            Vendor Account Suspended
          </h2>

          <p style="font-size: 16px; color: #555555;">
            Hello ${vendorName || 'Vendor'},
          </p>

          <p style="font-size: 16px; color: #555555;">
            Your vendor account has been suspended by our administration team.
          </p>

          <div style="background: #fff7ed; padding: 20px; border-radius: 6px; margin: 20px 0;">
            <p style="margin: 0; color: #9a3412; font-weight: bold;">
              Your account is currently suspended.
            </p>

            ${
              reason
                ? `
                  <p style="margin: 12px 0 0; color: #555555;">
                    <strong>Reason:</strong> ${reason}
                  </p>
                `
                : ''
            }
          </div>

          <p style="font-size: 16px; color: #555555;">
            While your account is suspended, you may not be able to access certain vendor features or process orders.
          </p>

          <p style="font-size: 16px; color: #555555;">
            If you believe this suspension was made in error, please contact our support team for assistance.
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


  async sendStoreApprovalNotification(
  to: string,
  storeName?: string,
): Promise<any> {
  const subject = 'Your Store Has Been Approved';
  const html = this.generateStoreApprovalEmail(storeName);

  this.logger.log(`Sending store approval email to ${to}`);

  return this.sendEmail(
    to,
    subject,
    'Your store has been approved and is now active.',
    html,
  );
}

private generateStoreApprovalEmail(storeName?: string): string {
  return `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="UTF-8" />
        <title>Store Approved</title>
      </head>

      <body style="font-family: Arial, sans-serif; background-color: #f4f4f4; padding: 20px;">
        <div style="max-width: 600px; margin: 0 auto; background: #ffffff; border-radius: 8px; padding: 30px;">

          <h2 style="color: #333333; text-align: center;">
            Your Store Has Been Approved 🎉
          </h2>

          <p style="font-size: 16px; color: #555555;">
            Hello,
          </p>

          <p style="font-size: 16px; color: #555555;">
            Great news! Your store
            <strong>${storeName || 'store'}</strong>
            has been reviewed and approved.
          </p>

          <div style="background: #f0fdf4; padding: 20px; border-radius: 6px; text-align: center; margin: 20px 0;">
            <p style="margin: 0; color: #166534; font-size: 18px; font-weight: bold;">
              Your store is now active.
            </p>
          </div>

          <p style="font-size: 16px; color: #555555;">
            You can now access your vendor dashboard and manage your store, products, and orders.
          </p>

          <p style="font-size: 16px; color: #555555;">
            Thank you for being part of our marketplace.
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

async sendStoreRejectionNotification(
  to: string,
  storeName?: string,
  rejectionReason?: string,
): Promise<any> {
  const subject = 'Your Store Has Been Rejected';
  const html = this.generateStoreRejectionEmail(
    storeName,
    rejectionReason,
  );

  this.logger.log(`Sending store rejection email to ${to}`);

  return this.sendEmail(
    to,
    subject,
    'Your store has been rejected.',
    html,
  );
}

private generateStoreRejectionEmail(
  storeName?: string,
  rejectionReason?: string,
): string {
  return `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="UTF-8" />
        <title>Store Rejected</title>
      </head>

      <body style="font-family: Arial, sans-serif; background-color: #f4f4f4; padding: 20px;">
        <div style="max-width: 600px; margin: 0 auto; background: #ffffff; border-radius: 8px; padding: 30px;">

          <h2 style="color: #333333; text-align: center;">
            Store Application Update
          </h2>

          <p style="font-size: 16px; color: #555555;">
            Hello,
          </p>

          <p style="font-size: 16px; color: #555555;">
            Unfortunately, your store
            <strong>${storeName || 'store'}</strong>
            has been rejected after review.
          </p>

          ${
            rejectionReason
              ? `
                <div style="background: #fef2f2; padding: 20px; border-radius: 6px; margin: 20px 0;">
                  <p style="margin: 0 0 8px; color: #991b1b; font-weight: bold;">
                    Reason for rejection:
                  </p>

                  <p style="margin: 0; color: #555555;">
                    ${rejectionReason}
                  </p>
                </div>
              `
              : ''
          }

          <p style="font-size: 16px; color: #555555;">
            Please review the feedback and make the necessary changes before submitting your store again.
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

async sendStoreSuspensionNotification(
  to: string,
  storeName?: string,
  reason?: string,
): Promise<any> {
  const subject = 'Your Store Has Been Suspended';
  const html = this.generateStoreSuspensionEmail(storeName, reason);

  this.logger.log(`Sending store suspension email to ${to}`);

  return this.sendEmail(
    to,
    subject,
    'Your store has been suspended.',
    html,
  );
}

private generateStoreSuspensionEmail(
  storeName?: string,
  reason?: string,
): string {
  return `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="UTF-8" />
        <title>Store Suspended</title>
      </head>

      <body style="font-family: Arial, sans-serif; background-color: #f4f4f4; padding: 20px;">
        <div style="max-width: 600px; margin: 0 auto; background: #ffffff; border-radius: 8px; padding: 30px;">

          <h2 style="color: #333333; text-align: center;">
            Store Suspended
          </h2>

          <p style="font-size: 16px; color: #555555;">
            Hello,
          </p>

          <p style="font-size: 16px; color: #555555;">
            Your store
            <strong>${storeName || 'store'}</strong>
            has been suspended by our administration team.
          </p>

          <div style="background: #fff7ed; padding: 20px; border-radius: 6px; margin: 20px 0;">

            <p style="margin: 0; color: #9a3412; font-weight: bold;">
              Your store is currently suspended.
            </p>

            ${
              reason
                ? `
                  <p style="margin: 12px 0 0; color: #555555;">
                    <strong>Reason:</strong> ${reason}
                  </p>
                `
                : ''
            }

          </div>

          <p style="font-size: 16px; color: #555555;">
            While your store is suspended, it may not be visible to customers and you may not be able to process new orders.
          </p>

          <p style="font-size: 16px; color: #555555;">
            If you believe this suspension was made in error, please contact our support team for assistance.
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


async sendVendorOrderAcceptedNotification(
  to: string,
  orderNumber: string,
  body: string,
): Promise<any> {
  const subject = `Order #${orderNumber} accepted`;
  const html = this.generateVendorOrderAcceptedEmail(orderNumber, body);

  this.logger.log(
    `Sending vendor order accepted notification email to ${to}`,
  );

  return this.sendEmail(
    to,
    subject,
    `Your order #${orderNumber} has been accepted.`,
    html,
  );
}

private generateVendorOrderAcceptedEmail(
  orderNumber: string,
  body: string,
): string {
  return `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="UTF-8" />
        <title>Order Accepted</title>
      </head>
      <body style="font-family: Arial, sans-serif; background-color: #f4f4f4; padding: 20px;">
        <div style="max-width: 600px; margin: 0 auto; background: #ffffff; border-radius: 8px; padding: 30px;">

          <h2 style="color: #333333; text-align: center;">
            Order Accepted 🎉
          </h2>

          <p style="font-size: 16px; color: #555555;">
            ${body}
          </p>

          <div style="background: #f8f9fa; padding: 15px; border-radius: 6px; text-align: center; margin: 20px 0;">
            <p style="margin: 0; color: #666;">Order Number</p>
            <h3 style="margin: 10px 0; color: #000;">
              ${orderNumber}
            </h3>
          </div>

          <p style="font-size: 16px; color: #555555;">
            Please review the order details and proceed accordingly.
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


async sendVendorOrderReadyNotification(
  to: string,
  orderNumber: string,
  storeName: string,
): Promise<any> {
  const subject = `Order #${orderNumber} marked ready`;

  const html = this.generateVendorOrderReadyEmail(
    orderNumber,
    storeName,
  );

  this.logger.log(
    `Sending vendor order ready notification email to ${to}`,
  );

  return this.sendEmail(
    to,
    subject,
    `Order #${orderNumber} for ${storeName} has been marked ready. Driver dispatch has started.`,
    html,
  );
}

private generateVendorOrderReadyEmail(
  orderNumber: string,
  storeName: string,
): string {
  return `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="UTF-8" />
        <title>Order Ready Successfully</title>
      </head>
      <body style="font-family: Arial, sans-serif; background-color: #f4f4f4; padding: 20px;">
        <div style="max-width: 600px; margin: 0 auto; background: #ffffff; border-radius: 8px; padding: 30px;">

          <h2 style="color: #333333; text-align: center;">
            Order Ready Successfully 🎉
          </h2>

          <p style="font-size: 16px; color: #555555;">
            Order #${orderNumber} for ${storeName} has been marked ready.
          </p>

          <div style="background: #f8f9fa; padding: 15px; border-radius: 6px; text-align: center; margin: 20px 0;">
            <p style="margin: 0; color: #666;">Order Number</p>
            <h3 style="margin: 10px 0; color: #000;">
              ${orderNumber}
            </h3>
          </div>

          <p style="font-size: 16px; color: #555555;">
            Driver dispatch has started. Please ensure the order is ready for pickup.
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

async sendCustomerOrderCancelledNotification(
  to: string,
  orderNumber: string,
  reason?: string,
): Promise<any> {
  const subject = `Order #${orderNumber} has been cancelled`;

  const html = this.generateCustomerOrderCancelledEmail(
    orderNumber,
    reason,
  );

  this.logger.log(
    `Sending customer order cancelled notification email to ${to}`,
  );

  return this.sendEmail(
    to,
    subject,
    `Unfortunately, your order #${orderNumber} has been cancelled by the store.${reason ? ` Reason: ${reason}` : ''}`,
    html,
  );
}

private generateCustomerOrderCancelledEmail(
  orderNumber: string,
  reason?: string,
): string {
  return `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="UTF-8" />
        <title>Order Cancelled</title>
      </head>
      <body style="font-family: Arial, sans-serif; background-color: #f4f4f4; padding: 20px;">
        <div style="max-width: 600px; margin: 0 auto; background: #ffffff; border-radius: 8px; padding: 30px;">

          <h2 style="color: #dc3545; text-align: center;">
            Order Cancelled ❌
          </h2>

          <p style="font-size: 16px; color: #555555;">
            Unfortunately, your order has been cancelled by the store.
          </p>

          <div style="background: #f8f9fa; padding: 15px; border-radius: 6px; text-align: center; margin: 20px 0;">
            <p style="margin: 0; color: #666;">Order Number</p>
            <h3 style="margin: 10px 0; color: #000;">
              ${orderNumber}
            </h3>
          </div>

          ${
            reason
              ? `
                <div style="background: #fff3cd; padding: 15px; border-radius: 6px; margin: 20px 0;">
                  <p style="margin: 0; color: #856404;">
                    <strong>Cancellation Reason:</strong> ${reason}
                  </p>
                </div>
              `
              : ''
          }

          <p style="font-size: 16px; color: #555555;">
            We apologize for any inconvenience caused. Thank you for your understanding.
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


async sendCustomerOrderDeliveredNotification(
  to: string,
  orderNumber: string,
): Promise<any> {
  const subject = `Order #${orderNumber} delivered successfully`;

  const html = this.generateCustomerOrderDeliveredEmail(orderNumber);

  this.logger.log(
    `Sending customer order delivered notification email to ${to}`,
  );

  return this.sendEmail(
    to,
    subject,
    `Your order #${orderNumber} has been successfully delivered. Thank you for ordering with us!`,
    html,
  );
}

private generateCustomerOrderDeliveredEmail(
  orderNumber: string,
): string {
  return `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="UTF-8" />
        <title>Order Delivered Successfully</title>
      </head>
      <body style="font-family: Arial, sans-serif; background-color: #f4f4f4; padding: 20px;">
        <div style="max-width: 600px; margin: 0 auto; background: #ffffff; border-radius: 8px; padding: 30px;">

          <h2 style="color: #28a745; text-align: center;">
            Order Delivered Successfully! 🎉
          </h2>

          <p style="font-size: 16px; color: #555555;">
            Your order has been successfully delivered.
          </p>

          <div style="background: #f8f9fa; padding: 15px; border-radius: 6px; text-align: center; margin: 20px 0;">
            <p style="margin: 0; color: #666;">Order Number</p>
            <h3 style="margin: 10px 0; color: #000;">
              ${orderNumber}
            </h3>
          </div>

          <p style="font-size: 16px; color: #555555;">
            We hope you enjoy your order. Thank you for choosing us!
          </p>

          <p style="font-size: 16px; color: #555555;">
            We look forward to serving you again.
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

async sendVendorDriverAssignedNotification(
  to: string,
  orderNumber: string,
  storeName: string,
): Promise<any> {
  const subject = `Driver assigned to order #${orderNumber}`;

  const html = this.generateVendorDriverAssignedEmail(
    orderNumber,
    storeName,
  );

  this.logger.log(
    `Sending vendor driver assigned notification email to ${to}`,
  );

  return this.sendEmail(
    to,
    subject,
    `A driver has accepted order #${orderNumber} and is assigned to pick it up from ${storeName}.`,
    html,
  );
}

private generateVendorDriverAssignedEmail(
  orderNumber: string,
  storeName: string,
): string {
  return `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="UTF-8" />
        <title>Driver Assigned</title>
      </head>
      <body style="font-family: Arial, sans-serif; background-color: #f4f4f4; padding: 20px;">
        <div style="max-width: 600px; margin: 0 auto; background: #ffffff; border-radius: 8px; padding: 30px;">

          <h2 style="color: #333333; text-align: center;">
            Driver Assigned to Your Order 🚗
          </h2>

          <p style="font-size: 16px; color: #555555;">
            A driver has accepted your order and is assigned to pick it up.
          </p>

          <div style="background: #f8f9fa; padding: 15px; border-radius: 6px; text-align: center; margin: 20px 0;">
            <p style="margin: 0; color: #666;">Order Number</p>
            <h3 style="margin: 10px 0; color: #000;">
              ${orderNumber}
            </h3>
            <p style="margin: 0; color: #666;">Store</p>
            <h3 style="margin: 10px 0; color: #000;">
              ${storeName}
            </h3>
          </div>

          <p style="font-size: 16px; color: #555555;">
            Please ensure the order is prepared and ready for pickup when the driver arrives.
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


async sendVendorDriverArrivedNotification(
  to: string,
  orderNumber: string,
  storeName: string,
): Promise<any> {
  const subject = 'Driver Arrived at Your Store 🚗';

  const html = this.generateVendorDriverArrivedEmail(
    orderNumber,
    storeName,
  );

  this.logger.log(
    `Sending vendor driver arrived notification email to ${to}`,
  );

  return this.sendEmail(
    to,
    subject,
    `The driver has arrived at ${storeName} to pick up order #${orderNumber}. Please hand over the order.`,
    html,
  );
}

private generateVendorDriverArrivedEmail(
  orderNumber: string,
  storeName: string,
): string {
  return `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="UTF-8" />
        <title>Driver Arrived at Store</title>
      </head>
      <body style="font-family: Arial, sans-serif; background-color: #f4f4f4; padding: 20px;">
        <div style="max-width: 600px; margin: 0 auto; background: #ffffff; border-radius: 8px; padding: 30px;">

          <h2 style="color: #333333; text-align: center;">
            Driver Arrived at Your Store 🚗
          </h2>

          <p style="font-size: 16px; color: #555555;">
            The driver has arrived at your store to pick up the order.
          </p>

          <div style="background: #f8f9fa; padding: 15px; border-radius: 6px; text-align: center; margin: 20px 0;">
            <p style="margin: 0; color: #666;">Order Number</p>
            <h3 style="margin: 10px 0; color: #000;">
              ${orderNumber}
            </h3>
            <p style="margin: 0; color: #666;">Store</p>
            <h3 style="margin: 10px 0; color: #000;">
              ${storeName}
            </h3>
          </div>

          <p style="font-size: 16px; color: #555555;">
            Please hand over the order to the driver so delivery can proceed.
          </p>

          <p style="font-size: 16px; color: #555555;">
            Thank you for your cooperation.
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


async sendVendorOrderDeliveredNotification(
  to: string,
  orderNumber: string,
  storeName: string,
): Promise<any> {
  const subject = `Order #${orderNumber} delivered successfully`;

  const html = this.generateVendorOrderDeliveredEmail(
    orderNumber,
    storeName,
  );

  this.logger.log(
    `Sending vendor order delivered notification email to ${to}`,
  );

  return this.sendEmail(
    to,
    subject,
    `Order #${orderNumber} from ${storeName} has been successfully delivered to the customer.`,
    html,
  );
}

private generateVendorOrderDeliveredEmail(
  orderNumber: string,
  storeName: string,
): string {
  return `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="UTF-8" />
        <title>Order Delivered Successfully</title>
      </head>
      <body style="font-family: Arial, sans-serif; background-color: #f4f4f4; padding: 20px;">
        <div style="max-width: 600px; margin: 0 auto; background: #ffffff; border-radius: 8px; padding: 30px;">

          <h2 style="color: #28a745; text-align: center;">
            Order Delivered Successfully! 🎉
          </h2>

          <p style="font-size: 16px; color: #555555;">
            Your order has been successfully delivered to the customer.
          </p>

          <div style="background: #f8f9fa; padding: 15px; border-radius: 6px; text-align: center; margin: 20px 0;">
            <p style="margin: 0; color: #666;">Order Number</p>
            <h3 style="margin: 10px 0; color: #000;">
              ${orderNumber}
            </h3>
            <p style="margin: 0; color: #666;">Store</p>
            <h3 style="margin: 10px 0; color: #000;">
              ${storeName}
            </h3>
          </div>

          <p style="font-size: 16px; color: #555555;">
            Thank you for successfully fulfilling this order.
          </p>

          <p style="font-size: 16px; color: #555555;">
            We appreciate your continued partnership!
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

}
