import { RegistrationMethod, RegistrationStatus } from '../../../shared/enums';

export class RegisterResponseDto {
  status: RegistrationStatus;
  requiresVerification: boolean;
  registrationMethod: RegistrationMethod;
  verificationIdentifier: string;
}
