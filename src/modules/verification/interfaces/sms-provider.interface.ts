// src/verification/interfaces/sms-provider.interface.ts
export interface ISmsProvider {
  sendSms(to: string, message: string): Promise<any>;
  sendOtp(to: string, otp: string, templateId?: string): Promise<any>;
  getBalance(): Promise<number>;
  validatePhoneNumber(phoneNumber: string): Promise<boolean>;
}
