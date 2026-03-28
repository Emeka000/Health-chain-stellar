import { PartialType } from '@nestjs/mapped-types';

import { CreateHospitalDto } from './create-hospital.dto';

export class UpdateHospitalDto extends PartialType(CreateHospitalDto) {}
