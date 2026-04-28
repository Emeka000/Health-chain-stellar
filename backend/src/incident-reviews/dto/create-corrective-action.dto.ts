import { IsDateString, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class CreateCorrectiveActionDto {
    @IsString()
    @IsNotEmpty()
    description: string;

    @IsString()
    @IsOptional()
    assignedTo?: string;

    @IsDateString()
    @IsNotEmpty()
    dueDate: string;
}
