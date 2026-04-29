import { IsNotEmpty, IsObject, IsOptional, IsString } from 'class-validator';

export class CompleteCorrectiveActionDto {
    @IsString()
    @IsNotEmpty()
    completionNotes: string;

    @IsObject()
    @IsOptional()
    completionEvidence?: Record<string, unknown>;
}
