// src/vacancy/dto/update-vacancy.dto.ts
import { PartialType } from '@nestjs/swagger';
import { CreateVacancyDto } from './create-vacancy.dto';

export class UpdateVacancyDto extends PartialType(CreateVacancyDto) {}