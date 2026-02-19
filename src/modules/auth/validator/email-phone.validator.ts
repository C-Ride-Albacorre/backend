import { ValidatorConstraint, ValidatorConstraintInterface, ValidationArguments, Validate } from 'class-validator';
import { CustomerLoginDto } from '../dto/login.dto';

@ValidatorConstraint({ name: 'EmailOrPhone', async: false })
export class EmailOrPhoneConstraint implements ValidatorConstraintInterface {
  validate(_: any, args: ValidationArguments) {
    const dto = args.object as CustomerLoginDto;
    // At least one of email or phoneNumber must exist
    return !!(dto.email || dto.phoneNumber);
  }

  defaultMessage(_: ValidationArguments) {
    return 'Either email or phoneNumber must be provided';
  }
}
