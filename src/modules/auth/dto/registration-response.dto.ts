import { User } from 'src/modules/user/entities/user.entity';
import { RegistrationMethod, RegistrationStatus, UserRole } from '../../../shared/enums';

// export class RegisterResponseDto {
//   user?: string;
//   accessToken?: string;
//   status: RegistrationStatus;
//   requiresVerification: boolean;
//   registrationMethod: RegistrationMethod;
//   verificationIdentifier: string;
// }

export class PendingVerificationDto {
  status:
    | RegistrationStatus.PENDING_VERIFICATION
    | RegistrationStatus.NEW
    | RegistrationStatus.ALREADY_VERIFIED;
  requiresVerification: boolean;
  registrationMethod: RegistrationMethod;
  verificationIdentifier: string;
  user?: User; // optional, internal use only
  isNewUser?: boolean
}

export class RegisterResponseDto {
  accessToken: string; // only included after token generation
  verificationToken: string;
  status: RegistrationStatus;
  requiresVerification: boolean;
  registrationMethod: RegistrationMethod;
  verificationIdentifier: string;
  role: boolean;
}
