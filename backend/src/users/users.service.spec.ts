import { NotFoundException, BadRequestException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { Repository } from 'typeorm';

import { UpdateProfileDto } from './dto/update-profile.dto';
import { ProfileActivityEntity } from './entities/profile-activity.entity';
import { UserEntity } from './entities/user.entity';
import { ImageValidationService } from './services/image-validation.service';
import { ProfileActivityService } from './services/profile-activity.service';
import { StorageService } from './services/storage.service';
import { UsersService } from './users.service';

describe('UsersService', () => {
  let service: UsersService;
  let userRepository: Repository<UserEntity>;
  let storageService: StorageService;
  let imageValidationService: ImageValidationService;
  let profileActivityService: ProfileActivityService;

  const mockUser: UserEntity = {
    id: 'user-1',
    email: 'test@example.com',
    firstName: 'John',
    lastName: 'Doe',
    name: 'John Doe',
    role: 'donor',
    phoneNumber: '+1234567890',
    region: 'Lagos',
    avatarUrl: null,
    profile: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
  } as UserEntity;

  const mockUserRepository = {
    find: jest.fn(),
    findOne: jest.fn(),
    create: jest.fn(),
    save: jest.fn(),
    merge: jest.fn(),
    softRemove: jest.fn(),
  };

  const mockStorageService = {
    uploadFile: jest.fn(),
    deleteFile: jest.fn(),
    getFileUrl: jest.fn(),
  };

  const mockImageValidationService = {
    validateImage: jest.fn(),
    resizeImage: jest.fn(),
    getImageDimensions: jest.fn(),
  };

  const mockProfileActivityService = {
    logActivity: jest.fn(),
    getUserActivities: jest.fn(),
    getActivityById: jest.fn(),
    deleteOldActivities: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        {
          provide: getRepositoryToken(UserEntity),
          useValue: mockUserRepository,
        },
        {
          provide: StorageService,
          useValue: mockStorageService,
        },
        {
          provide: ImageValidationService,
          useValue: mockImageValidationService,
        },
        {
          provide: ProfileActivityService,
          useValue: mockProfileActivityService,
        },
      ],
    }).compile();

    service = module.get<UsersService>(UsersService);
    userRepository = module.get<Repository<UserEntity>>(
      getRepositoryToken(UserEntity),
    );
    storageService = module.get<StorageService>(StorageService);
    imageValidationService = module.get<ImageValidationService>(
      ImageValidationService,
    );
    profileActivityService = module.get<ProfileActivityService>(
      ProfileActivityService,
    );
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('findAll', () => {
    it('should return all users', async () => {
      const users = [mockUser];
      mockUserRepository.find.mockResolvedValue(users);

      const result = await service.findAll();

      expect(result).toEqual({
        message: 'Users retrieved successfully',
        data: users,
      });
      expect(mockUserRepository.find).toHaveBeenCalled();
    });
  });

  describe('findOne', () => {
    it('should return a user by id', async () => {
      mockUserRepository.findOne.mockResolvedValue(mockUser);

      const result = await service.findOne('user-1');

      expect(result).toEqual({
        message: 'User retrieved successfully',
        data: mockUser,
      });
      expect(mockUserRepository.findOne).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        select: expect.any(Array),
      });
    });

    it('should throw NotFoundException if user not found', async () => {
      mockUserRepository.findOne.mockResolvedValue(null);

      await expect(service.findOne('user-1')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('update', () => {
    it('should update user profile', async () => {
      const updateDto: UpdateProfileDto = {
        firstName: 'Jane',
        lastName: 'Smith',
      };

      mockUserRepository.findOne.mockResolvedValue(mockUser);
      mockUserRepository.merge.mockReturnValue({ ...mockUser, ...updateDto });
      mockUserRepository.save.mockResolvedValue({ ...mockUser, ...updateDto });
      mockProfileActivityService.logActivity.mockResolvedValue({});

      const result = await service.update('user-1', updateDto, {
        actorId: 'user-1',
        ipAddress: '127.0.0.1',
        userAgent: 'test-agent',
      });

      expect(result.message).toBe('User updated successfully');
      expect(mockUserRepository.save).toHaveBeenCalled();
      expect(mockProfileActivityService.logActivity).toHaveBeenCalled();
    });

    it('should throw NotFoundException if user not found', async () => {
      mockUserRepository.findOne.mockResolvedValue(null);

      await expect(service.update('user-1', {}, {})).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('remove', () => {
    it('should soft delete a user', async () => {
      mockUserRepository.findOne.mockResolvedValue(mockUser);
      mockUserRepository.softRemove.mockResolvedValue(mockUser);

      const result = await service.remove('user-1');

      expect(result).toEqual({
        message: 'User deleted successfully',
        data: { id: 'user-1' },
      });
      expect(mockUserRepository.softRemove).toHaveBeenCalledWith(mockUser);
    });

    it('should throw NotFoundException if user not found', async () => {
      mockUserRepository.findOne.mockResolvedValue(null);

      await expect(service.remove('user-1')).rejects.toThrow(NotFoundException);
    });
  });

  describe('getProfile', () => {
    it('should return user profile with completion percentage', async () => {
      mockUserRepository.findOne.mockResolvedValue(mockUser);
      mockProfileActivityService.logActivity.mockResolvedValue({});

      const result = await service.getProfile('user-1');

      expect(result.message).toBe('Profile retrieved successfully');
      expect(result.data).toHaveProperty('completionPercentage');
      expect(mockProfileActivityService.logActivity).toHaveBeenCalled();
    });

    it('should throw NotFoundException if user not found', async () => {
      mockUserRepository.findOne.mockResolvedValue(null);

      await expect(service.getProfile('user-1')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('uploadAvatar', () => {
    const mockFile = {
      buffer: Buffer.from('test-image'),
      mimetype: 'image/jpeg',
      size: 1024,
      originalname: 'test.jpg',
    } as Express.Multer.File;

    it('should upload and resize avatar', async () => {
      mockImageValidationService.validateImage.mockResolvedValue({
        isValid: true,
        width: 800,
        height: 600,
        format: 'jpeg',
        size: 1024,
      });
      mockImageValidationService.resizeImage.mockResolvedValue(
        Buffer.from('resized'),
      );
      mockStorageService.uploadFile.mockResolvedValue({
        url: '/uploads/avatars/test.jpg',
        key: 'avatars/test.jpg',
        bucket: 'local',
      });
      mockUserRepository.findOne.mockResolvedValue(mockUser);
      mockUserRepository.save.mockResolvedValue({
        ...mockUser,
        avatarUrl: '/uploads/avatars/test.jpg',
      });
      mockProfileActivityService.logActivity.mockResolvedValue({});

      const result = await service.uploadAvatar('user-1', mockFile, {
        ipAddress: '127.0.0.1',
        userAgent: 'test-agent',
      });

      expect(result.message).toBe('Avatar uploaded successfully');
      expect(result.data).toHaveProperty('avatarUrl');
      expect(mockImageValidationService.validateImage).toHaveBeenCalled();
      expect(mockImageValidationService.resizeImage).toHaveBeenCalled();
      expect(mockStorageService.uploadFile).toHaveBeenCalled();
    });

    it('should throw BadRequestException if no file uploaded', async () => {
      await expect(service.uploadAvatar('user-1', null, {})).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should throw NotFoundException if user not found', async () => {
      mockImageValidationService.validateImage.mockResolvedValue({
        isValid: true,
        width: 800,
        height: 600,
        format: 'jpeg',
        size: 1024,
      });
      mockImageValidationService.resizeImage.mockResolvedValue(
        Buffer.from('resized'),
      );
      mockUserRepository.findOne.mockResolvedValue(null);

      await expect(
        service.uploadAvatar('user-1', mockFile, {}),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('deleteAvatar', () => {
    it('should delete user avatar', async () => {
      const userWithAvatar = {
        ...mockUser,
        avatarUrl: '/uploads/avatars/test.jpg',
      };
      mockUserRepository.findOne.mockResolvedValue(userWithAvatar);
      mockStorageService.deleteFile.mockResolvedValue(undefined);
      mockUserRepository.save.mockResolvedValue({
        ...userWithAvatar,
        avatarUrl: null,
      });
      mockProfileActivityService.logActivity.mockResolvedValue({});

      const result = await service.deleteAvatar('user-1', {
        ipAddress: '127.0.0.1',
        userAgent: 'test-agent',
      });

      expect(result.message).toBe('Avatar deleted successfully');
      expect(mockStorageService.deleteFile).toHaveBeenCalled();
    });

    it('should throw BadRequestException if no avatar to delete', async () => {
      mockUserRepository.findOne.mockResolvedValue(mockUser);

      await expect(service.deleteAvatar('user-1', {})).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should throw NotFoundException if user not found', async () => {
      mockUserRepository.findOne.mockResolvedValue(null);

      await expect(service.deleteAvatar('user-1', {})).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('getProfileActivities', () => {
    it('should return user profile activities', async () => {
      const activities = [
        {
          id: 'activity-1',
          userId: 'user-1',
          activityType: 'profile_updated',
          description: 'Profile updated',
          createdAt: new Date(),
        },
      ];
      mockProfileActivityService.getUserActivities.mockResolvedValue({
        data: activities,
        total: 1,
      });

      const result = await service.getProfileActivities('user-1', 50, 0);

      expect(result.message).toBe('Profile activities retrieved successfully');
      expect(result.data).toEqual(activities);
      expect(result.total).toBe(1);
    });
  });

  describe('calculateProfileCompletion', () => {
    it('should calculate profile completion percentage correctly', async () => {
      const completeUser = {
        ...mockUser,
        firstName: 'John',
        lastName: 'Doe',
        email: 'john@example.com',
        phoneNumber: '+1234567890',
        region: 'Lagos',
        avatarUrl: '/uploads/avatars/test.jpg',
      };

      mockUserRepository.findOne.mockResolvedValue(completeUser);
      mockProfileActivityService.logActivity.mockResolvedValue({});

      const result = await service.getProfile('user-1');

      expect(result.data.completionPercentage).toBe(100);
    });

    it('should calculate partial profile completion', async () => {
      const partialUser = {
        ...mockUser,
        firstName: 'John',
        lastName: 'Doe',
        email: 'john@example.com',
        phoneNumber: null,
        region: null,
        avatarUrl: null,
      };

      mockUserRepository.findOne.mockResolvedValue(partialUser);
      mockProfileActivityService.logActivity.mockResolvedValue({});

      const result = await service.getProfile('user-1');

      expect(result.data.completionPercentage).toBe(50);
    });
  });
});
