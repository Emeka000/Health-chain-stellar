import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { TemplatesService } from './templates.service';
import { RecordTemplateEntity } from './entities/record-template.entity';
import { MedicalRecordEntity } from './entities/medical-record.entity';

const mockTemplateRepo = () => ({
  create: jest.fn(),
  save: jest.fn(),
  findOne: jest.fn(),
  createQueryBuilder: jest.fn(),
});

const mockRecordRepo = () => ({
  create: jest.fn(),
  save: jest.fn(),
});

const PROVIDER_ID = 'provider-uuid-1';
const OTHER_PROVIDER_ID = 'provider-uuid-2';

describe('TemplatesService', () => {
  let service: TemplatesService;
  let templateRepo: ReturnType<typeof mockTemplateRepo>;
  let recordRepo: ReturnType<typeof mockRecordRepo>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TemplatesService,
        { provide: getRepositoryToken(RecordTemplateEntity), useFactory: mockTemplateRepo },
        { provide: getRepositoryToken(MedicalRecordEntity), useFactory: mockRecordRepo },
      ],
    }).compile();

    service = module.get(TemplatesService);
    templateRepo = module.get(getRepositoryToken(RecordTemplateEntity));
    recordRepo = module.get(getRepositoryToken(MedicalRecordEntity));
  });

  describe('createTemplate', () => {
    it('creates and saves a template with valid schemaJson', async () => {
      const dto = { name: 'Lab Result', recordType: 'lab', schemaJson: { field: 'value' }, isPublic: true };
      const entity = { id: 'tpl-1', providerId: PROVIDER_ID, ...dto };
      templateRepo.create.mockReturnValue(entity);
      templateRepo.save.mockResolvedValue(entity);

      const result = await service.createTemplate(PROVIDER_ID, dto);

      expect(templateRepo.create).toHaveBeenCalledWith({
        providerId: PROVIDER_ID,
        name: dto.name,
        recordType: dto.recordType,
        schemaJson: dto.schemaJson,
        isPublic: true,
      });
      expect(templateRepo.save).toHaveBeenCalledWith(entity);
      expect(result).toEqual(entity);
    });

    it('defaults isPublic to false when not provided', async () => {
      const dto = { name: 'Prescription', recordType: 'prescription', schemaJson: { drug: '' } };
      const entity = { id: 'tpl-2', providerId: PROVIDER_ID, ...dto, isPublic: false };
      templateRepo.create.mockReturnValue(entity);
      templateRepo.save.mockResolvedValue(entity);

      await service.createTemplate(PROVIDER_ID, dto);

      expect(templateRepo.create).toHaveBeenCalledWith(expect.objectContaining({ isPublic: false }));
    });

    it('throws BadRequestException when schemaJson is an array', async () => {
      const dto = { name: 'Bad', recordType: 'lab', schemaJson: [] as unknown as Record<string, unknown> };
      await expect(service.createTemplate(PROVIDER_ID, dto)).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when schemaJson is null', async () => {
      const dto = { name: 'Bad', recordType: 'lab', schemaJson: null as unknown as Record<string, unknown> };
      await expect(service.createTemplate(PROVIDER_ID, dto)).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when schemaJson is a string', async () => {
      const dto = { name: 'Bad', recordType: 'lab', schemaJson: 'not-an-object' as unknown as Record<string, unknown> };
      await expect(service.createTemplate(PROVIDER_ID, dto)).rejects.toThrow(BadRequestException);
    });
  });

  describe('listTemplates', () => {
    it('returns public templates and own templates', async () => {
      const templates = [
        { id: 'tpl-1', providerId: PROVIDER_ID, isPublic: false },
        { id: 'tpl-2', providerId: OTHER_PROVIDER_ID, isPublic: true },
      ];
      const qb = {
        where: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue(templates),
      };
      templateRepo.createQueryBuilder.mockReturnValue(qb);

      const result = await service.listTemplates(PROVIDER_ID);

      expect(templateRepo.createQueryBuilder).toHaveBeenCalledWith('t');
      expect(qb.where).toHaveBeenCalledWith(
        't.isPublic = :pub OR t.providerId = :pid',
        { pub: true, pid: PROVIDER_ID },
      );
      expect(result).toEqual(templates);
    });
  });

  describe('createRecordFromTemplate', () => {
    const template: Partial<RecordTemplateEntity> = {
      id: 'tpl-1',
      providerId: PROVIDER_ID,
      recordType: 'lab',
      schemaJson: { testName: '', result: '' },
      isPublic: false,
    };

    it('creates a record pre-filled with template recordType and schemaJson', async () => {
      templateRepo.findOne.mockResolvedValue(template);
      const record = { id: 'rec-1', providerId: PROVIDER_ID, templateId: 'tpl-1', recordType: 'lab', data: { testName: '', result: '', extra: 'x' } };
      recordRepo.create.mockReturnValue(record);
      recordRepo.save.mockResolvedValue(record);

      const result = await service.createRecordFromTemplate(PROVIDER_ID, 'tpl-1', { data: { extra: 'x' } });

      expect(recordRepo.create).toHaveBeenCalledWith({
        providerId: PROVIDER_ID,
        templateId: 'tpl-1',
        recordType: 'lab',
        data: { testName: '', result: '', extra: 'x' },
      });
      expect(result).toEqual(record);
    });

    it('allows any provider to use a public template', async () => {
      const publicTemplate = { ...template, isPublic: true, providerId: OTHER_PROVIDER_ID };
      templateRepo.findOne.mockResolvedValue(publicTemplate);
      const record = { id: 'rec-2' };
      recordRepo.create.mockReturnValue(record);
      recordRepo.save.mockResolvedValue(record);

      await expect(
        service.createRecordFromTemplate(PROVIDER_ID, 'tpl-1', {}),
      ).resolves.toEqual(record);
    });

    it('throws NotFoundException when template does not exist', async () => {
      templateRepo.findOne.mockResolvedValue(null);
      await expect(
        service.createRecordFromTemplate(PROVIDER_ID, 'nonexistent', {}),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws ForbiddenException when accessing a private template owned by another provider', async () => {
      const privateTemplate = { ...template, providerId: OTHER_PROVIDER_ID, isPublic: false };
      templateRepo.findOne.mockResolvedValue(privateTemplate);
      await expect(
        service.createRecordFromTemplate(PROVIDER_ID, 'tpl-1', {}),
      ).rejects.toThrow(ForbiddenException);
    });

    it('merges extra data on top of template schemaJson', async () => {
      templateRepo.findOne.mockResolvedValue(template);
      const record = { id: 'rec-3' };
      recordRepo.create.mockReturnValue(record);
      recordRepo.save.mockResolvedValue(record);

      await service.createRecordFromTemplate(PROVIDER_ID, 'tpl-1', { data: { testName: 'CBC' } });

      expect(recordRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: { testName: 'CBC', result: '' } }),
      );
    });
  });
});
