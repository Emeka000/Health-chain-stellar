import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class ResolveMismatchDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  note: string;
}
