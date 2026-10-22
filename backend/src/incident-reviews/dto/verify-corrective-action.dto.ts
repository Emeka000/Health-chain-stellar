import { IsNotEmpty, IsString } from 'class-validator';

export class VerifyCorrectiveActionDto {
    @IsString()
    @IsNotEmpty()
    verificationNotes: string;
}
