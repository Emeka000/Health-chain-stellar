import {
  IsString,
  IsNumber,
  IsNotEmpty,
  IsOptional,
  IsIn,
  Min,
  Max,
} from 'class-validator';

export class RegisterBloodUnitDto {
  @IsString()
  @IsNotEmpty()
  unitId: string;

  @IsString()
  @IsNotEmpty()
  @IsIn(['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'])
  bloodType: string;

  @IsString()
  @IsNotEmpty()
  donorId: string;

  @IsString()
  @IsNotEmpty()
  bankId: string;
}

export class TransferCustodyDto {
  @IsNumber()
  @IsNotEmpty()
  unitId: number;

  @IsString()
  @IsNotEmpty()
  fromAccount: string;

  @IsString()
  @IsNotEmpty()
  toAccount: string;

  @IsString()
  @IsNotEmpty()
  condition: string;
}

export class LogTemperatureDto {
  @IsNumber()
  @IsNotEmpty()
  unitId: number;

  @IsNumber()
  @Min(-50)
  @Max(50)
  temperature: number;

  @IsNumber()
  @IsOptional()
  timestamp?: number;
}
