// src/verification/interfaces/email-provider.interface.ts
export interface IEmailProvider {
  sendEmail(
    to: string,
    subject: string,
    body: string,
    html?: string,
  ): Promise<any>;
  sendOtp(to: string, otp: string, templateId?: string): Promise<any>;
  validateEmail(email: string): Promise<boolean>;
}
