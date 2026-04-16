import { PipeTransform, BadRequestException } from '@nestjs/common';
import { parsePhoneNumberFromString, CountryCode } from 'libphonenumber-js';

export class ParsePhonePipe implements PipeTransform {
  constructor(private defaultCountry: CountryCode = 'NG') {}

  transform(value: string) {
    if (!value) {
      throw new BadRequestException('Phone number is required');
    }

    const phone = parsePhoneNumberFromString(value, this.defaultCountry);

    if (!phone || !phone.isValid()) {
      throw new BadRequestException('Invalid phone number');
    }

    return phone.format('E.164');
  }
}