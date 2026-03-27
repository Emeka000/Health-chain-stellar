import { Module } from '@nestjs/common';
import { MulterModule } from '@nestjs/platform-express';
import { TypeOrmModule } from '@nestjs/typeorm';

import { UserActivityModule } from '../user-activity/user-activity.module';

import { ProfileActivityEntity } from './entities/profile-activity.entity';
import { TwoFactorAuthEntity } from './entities/two-factor-auth.entity';
import { UserEntity } from './entities/user.entity';
import { ImageValidationService } from './services/image-validation.service';
import { ProfileActivityService } from './services/profile-activity.service';
import { StorageService } from './services/storage.service';
import { UserRepository } from './user.repository';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      UserEntity,
      TwoFactorAuthEntity,
      ProfileActivityEntity,
    ]),
    UserActivityModule,
    MulterModule.register({
      dest: './uploads/temp',
    }),
  ],
  controllers: [UsersController],
  providers: [
    UsersService,
    UserRepository,
    StorageService,
    ImageValidationService,
    ProfileActivityService,
  ],
  exports: [UsersService, UserRepository, TypeOrmModule],
})
export class UsersModule {}
