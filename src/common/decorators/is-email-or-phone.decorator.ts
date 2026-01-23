// src/common/decorators/is-email-or-phone.decorator.ts
import {
  registerDecorator,
  ValidationOptions,
  ValidationArguments,
} from 'class-validator';

export function IsEmailOrPhone(validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: 'isEmailOrPhone',
      target: object.constructor,
      propertyName: propertyName,
      options: validationOptions,
      validator: {
        validate(value: any, args: ValidationArguments) {
          const email = args.object['email'];
          const phone = args.object['phone'];
          return !!(email || phone);
        },
        defaultMessage(args: ValidationArguments) {
          return 'Either email or phone number must be provided';
        },
      },
    });
  };
}
