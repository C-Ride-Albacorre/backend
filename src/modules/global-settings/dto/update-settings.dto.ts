import { PartialType } from '@nestjs/swagger';
import { CreateGlobalSettingsDto } from './create-settings.dto';

export class UpdateGlobalSettingsDto extends PartialType(CreateGlobalSettingsDto) {}