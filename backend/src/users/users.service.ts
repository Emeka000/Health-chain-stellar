import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Inject,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { Repository } from 'typeorm';

import { UpdateProfileDto } from './dto/update-profile.dto';
import {
  ProfileActivityEntity,
  ProfileActivityType,
} from './entities/profile-activity.entity';
import { UserEntity } from './entities/user.entity';
import { ImageValidationService } from './services/image-validation.service';
import {
  ProfileActivityService,
  LogActivityParams,
} from './services/profile-activity.service';
import { StorageService } from './services/storage.service';

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(UserEntity)
    private readonly userRepository: Repository<UserEntity>,
    private readonly storageService: StorageService,
    private readonly imageValidationService: ImageValidationService,
    private readonly profileActivityService: ProfileActivityService,
  ) {}

  async findAll() {
    const users = await this.userRepository.find({
      select: [
        'id',
        'email',
        'firstName',
        'lastName',
        'name',
        'role',
        'createdAt',
      ],
    });

    return {
      message: 'Users retrieved successfully',
      data: users,
    };
  }

  async findOne(id: string) {
    const user = await this.userRepository.findOne({
      where: { id },
      select: [
        'id',
        'email',
        'firstName',
        'lastName',
        'name',
        'role',
        'phoneNumber',
        'region',
        'avatarUrl',
        'profile',
        'createdAt',
        'updatedAt',
      ],
    });

    if (!user) {
      throw new NotFoundException(`User with ID ${id} not found`);
    }

    return {
      message: 'User retrieved successfully',
      data: user,
    };
  }

  async update(
    id: string,
    updateProfileDto: UpdateProfileDto,
    context?: {
      actorId?: string;
      ipAddress?: string;
      userAgent?: string;
    },
  ) {
    const user = await this.userRepository.findOne({ where: { id } });

    if (!user) {
      throw new NotFoundException(`User with ID ${id} not found`);
    }

    // Track changed fields for activity log
    const changedFields: string[] = [];
    for (const [key, value] of Object.entries(updateProfileDto)) {
      if (value !== undefined && value !== (user as any)[key]) {
        changedFields.push(key);
      }
    }

    // Update user
    const updatedUser = this.userRepository.merge(user, updateProfileDto);
    const savedUser = await this.userRepository.save(updatedUser);

    // Log activity
    await this.profileActivityService.logActivity({
      userId: context?.actorId ?? id,
      activityType: ProfileActivityType.PROFILE_UPDATED,
      description: `Profile updated for user ${id}`,
      metadata: {
        targetUserId: id,
        changedFields,
      },
      ipAddress: context?.ipAddress,
      userAgent: context?.userAgent,
    });

    return {
      message: 'User updated successfully',
      data: savedUser,
    };
  }

  async remove(id: string) {
    const user = await this.userRepository.findOne({ where: { id } });

    if (!user) {
      throw new NotFoundException(`User with ID ${id} not found`);
    }

    await this.userRepository.softRemove(user);

    return {
      message: 'User deleted successfully',
      data: { id },
    };
  }

  async getProfile(userId: string) {
    const user = await this.userRepository.findOne({
      where: { id: userId },
      select: [
        'id',
        'email',
        'firstName',
        'lastName',
        'name',
        'role',
        'phoneNumber',
        'region',
        'avatarUrl',
        'profile',
        'createdAt',
        'updatedAt',
      ],
    });

    if (!user) {
      throw new NotFoundException(`User with ID ${userId} not found`);
    }

    // Calculate profile completion percentage
    const completionPercentage = this.calculateProfileCompletion(user);

    // Log profile view activity
    await this.profileActivityService.logActivity({
      userId,
      activityType: ProfileActivityType.PROFILE_VIEWED,
      description: `Profile viewed by user ${userId}`,
    });

    return {
      message: 'Profile retrieved successfully',
      data: {
        ...user,
        completionPercentage,
      },
    };
  }

  async uploadAvatar(
    userId: string,
    file: Express.Multer.File,
    context?: {
      ipAddress?: string;
      userAgent?: string;
    },
  ) {
    if (!file) {
      throw new BadRequestException('No file uploaded');
    }

    // Validate image
    await this.imageValidationService.validateImage(
      file.buffer,
      file.mimetype,
      file.size,
    );

    // Resize image to 200x200
    const resizedBuffer = await this.imageValidationService.resizeImage(
      file.buffer,
      200,
      200,
    );

    // Upload to storage
    const uploadResult = await this.storageService.uploadFile(
      resizedBuffer,
      file.originalname,
      file.mimetype,
      'avatars',
    );

    // Update user with avatar URL
    const user = await this.userRepository.findOne({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException(`User with ID ${userId} not found`);
    }

    // Delete old avatar if exists
    if (user.avatarUrl) {
      const oldKey = user.avatarUrl.replace('/uploads/', '');
      await this.storageService.deleteFile(oldKey);
    }

    user.avatarUrl = uploadResult.url;
    await this.userRepository.save(user);

    // Log activity
    await this.profileActivityService.logActivity({
      userId,
      activityType: ProfileActivityType.AVATAR_UPLOADED,
      description: `Avatar uploaded for user ${userId}`,
      metadata: {
        avatarUrl: uploadResult.url,
        fileSize: file.size,
        mimeType: file.mimetype,
      },
      ipAddress: context?.ipAddress,
      userAgent: context?.userAgent,
    });

    return {
      message: 'Avatar uploaded successfully',
      data: {
        avatarUrl: uploadResult.url,
      },
    };
  }

  async deleteAvatar(
    userId: string,
    context?: {
      ipAddress?: string;
      userAgent?: string;
    },
  ) {
    const user = await this.userRepository.findOne({ where: { id: userId } });

    if (!user) {
      throw new NotFoundException(`User with ID ${userId} not found`);
    }

    if (!user.avatarUrl) {
      throw new BadRequestException('No avatar to delete');
    }

    // Delete from storage
    const key = user.avatarUrl.replace('/uploads/', '');
    await this.storageService.deleteFile(key);

    // Update user
    user.avatarUrl = null;
    await this.userRepository.save(user);

    // Log activity
    await this.profileActivityService.logActivity({
      userId,
      activityType: ProfileActivityType.AVATAR_DELETED,
      description: `Avatar deleted for user ${userId}`,
      ipAddress: context?.ipAddress,
      userAgent: context?.userAgent,
    });

    return {
      message: 'Avatar deleted successfully',
    };
  }

  async getProfileActivities(
    userId: string,
    limit: number = 50,
    offset: number = 0,
  ) {
    const result = await this.profileActivityService.getUserActivities(
      userId,
      limit,
      offset,
    );

    return {
      message: 'Profile activities retrieved successfully',
      data: result.data,
      total: result.total,
      limit,
      offset,
    };
  }

  private calculateProfileCompletion(user: UserEntity): number {
    const requiredFields = [
      'firstName',
      'lastName',
      'email',
      'phoneNumber',
      'region',
      'avatarUrl',
    ];

    const completedFields = requiredFields.filter((field) => {
      const value = (user as any)[field];
      return value !== null && value !== undefined && value !== '';
    });

    return Math.round((completedFields.length / requiredFields.length) * 100);
  }
}
