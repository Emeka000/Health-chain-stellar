import { Test, TestingModule } from '@nestjs/testing';
import { UnauthorizedException } from '@nestjs/common';
import { FileDownloadController } from './file-download.controller';
import { FileDownloadService } from './file-download.service';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { Reflector } from '@nestjs/core';

describe('FileDownloadController', () => {
  let controller: FileDownloadController;
  let fileDownloadService: jest.Mocked<FileDownloadService>;

  const mockFileDownloadService = {
    generateSignedLink: jest.fn(),
    verifySignedToken: jest.fn(),
    downloadWithJwt: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [FileDownloadController],
      providers: [
        { provide: FileDownloadService, useValue: mockFileDownloadService },
        Reflector,
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<FileDownloadController>(FileDownloadController);
    fileDownloadService = module.get(FileDownloadService);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('download (signed link, public)', () => {
    it('serves the file for a valid signed token without a session', async () => {
      const payload = { key: 'files/a.txt', exp: Date.now() + 60_000, sig: 'abc' };
      const expected = { url: 'https://cdn.example.com/files/a.txt' };
      mockFileDownloadService.verifySignedToken.mockReturnValue(true);
      mockFileDownloadService.downloadWithJwt.mockResolvedValue(expected as any);

      const result = await controller.download(payload.key, payload.exp, payload.sig);

      expect(mockFileDownloadService.verifySignedToken).toHaveBeenCalledWith(
        payload.key,
        payload.exp,
        payload.sig,
      );
      expect(result).toEqual(expected);
    });

    it('returns 401 for an expired or tampered link', async () => {
      mockFileDownloadService.verifySignedToken.mockReturnValue(false);

      await expect(
        controller.download('files/a.txt', Date.now() - 1, 'bad'),
      ).rejects.toBeInstanceOf(UnauthorizedException);
      expect(mockFileDownloadService.downloadWithJwt).not.toHaveBeenCalled();
    });
  });

  describe('downloadWithJwt (authenticated)', () => {
    it('delegates to the service for authenticated requests', async () => {
      const expected = { url: 'https://cdn.example.com/files/a.txt' };
      mockFileDownloadService.downloadWithJwt.mockResolvedValue(expected as any);

      const result = await controller.downloadWithJwt('files/a.txt', { user: { id: 'u1' } } as any);

      expect(mockFileDownloadService.downloadWithJwt).toHaveBeenCalledWith(
        'files/a.txt',
        expect.objectContaining({ user: { id: 'u1' } }),
      );
      expect(result).toEqual(expected);
    });
  });
});
