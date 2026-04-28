import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Repository } from 'typeorm';

import { IncidentReviewsService } from './incident-reviews.service';
import { IncidentReviewEntity } from './entities/incident-review.entity';
import {
    CorrectiveActionEntity,
    CorrectiveActionStatus,
} from './entities/corrective-action.entity';
import { IncidentEvidenceLinkEntity } from './entities/incident-evidence-link.entity';
import { IncidentReviewStatus } from './enums/incident-review-status.enum';
import { IncidentRootCause } from './enums/incident-root-cause.enum';
import { IncidentSeverity } from './enums/incident-severity.enum';
import { SecurityEventLoggerService } from '../user-activity/security-event-logger.service';

describe('IncidentReviewsService - Workflow Automation', () => {
    let service: IncidentReviewsService;
    let reviewRepo: Repository<IncidentReviewEntity>;
    let actionRepo: Repository<CorrectiveActionEntity>;
    let evidenceRepo: Repository<IncidentEvidenceLinkEntity>;
    let eventEmitter: EventEmitter2;

    const mockReviewRepo = {
        create: jest.fn(),
        save: jest.fn(),
        findOne: jest.fn(),
        find: jest.fn(),
        update: jest.fn(),
        createQueryBuilder: jest.fn(),
    };

    const mockActionRepo = {
        create: jest.fn(),
        save: jest.fn(),
        findOne: jest.fn(),
        find: jest.fn(),
        update: jest.fn(),
        count: jest.fn(),
        createQueryBuilder: jest.fn(),
    };

    const mockEvidenceRepo = {
        save: jest.fn(),
        find: jest.fn(),
    };

    const mockEventEmitter = {
        emit: jest.fn(),
    };

    const mockSecurityLogger = {
        logEvent: jest.fn().mockResolvedValue(undefined),
    };

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            providers: [
                IncidentReviewsService,
                {
                    provide: getRepositoryToken(IncidentReviewEntity),
                    useValue: mockReviewRepo,
                },
                {
                    provide: getRepositoryToken(CorrectiveActionEntity),
                    useValue: mockActionRepo,
                },
                {
                    provide: getRepositoryToken(IncidentEvidenceLinkEntity),
                    useValue: mockEvidenceRepo,
                },
                {
                    provide: EventEmitter2,
                    useValue: mockEventEmitter,
                },
                {
                    provide: SecurityEventLoggerService,
                    useValue: mockSecurityLogger,
                },
            ],
        }).compile();

        service = module.get<IncidentReviewsService>(IncidentReviewsService);
        reviewRepo = module.get(getRepositoryToken(IncidentReviewEntity));
        actionRepo = module.get(getRepositoryToken(CorrectiveActionEntity));
        evidenceRepo = module.get(getRepositoryToken(IncidentEvidenceLinkEntity));
        eventEmitter = module.get(EventEmitter2);

        jest.clearAllMocks();
    });

    describe('autoCreateFromAnomaly', () => {
        it('should auto-create incident review from anomaly', async () => {
            const params = {
                anomalyId: 'anomaly-123',
                orderId: 'order-456',
                riderId: 'rider-789',
                hospitalId: 'hospital-001',
                bloodBankId: null,
                rootCause: IncidentRootCause.ANOMALY_DETECTED,
                severity: IncidentSeverity.HIGH,
                description: 'Auto-created from anomaly',
                dueDate: new Date('2026-05-01'),
                metadata: { anomalyType: 'ROUTE_DEVIATION' },
            };

            const mockReview = {
                id: 'review-123',
                ...params,
                status: IncidentReviewStatus.OPEN,
                reportedByUserId: 'system',
                linkedAnomalyId: params.anomalyId,
            };

            mockReviewRepo.create.mockReturnValue(mockReview);
            mockReviewRepo.save.mockResolvedValue(mockReview);
            mockEvidenceRepo.save.mockResolvedValue({});

            const result = await service.autoCreateFromAnomaly(params);

            expect(result).toEqual(mockReview);
            expect(mockReviewRepo.create).toHaveBeenCalledWith(
                expect.objectContaining({
                    linkedAnomalyId: 'anomaly-123',
                    reportedByUserId: 'system',
                    status: IncidentReviewStatus.OPEN,
                }),
            );
            expect(mockEvidenceRepo.save).toHaveBeenCalledWith(
                expect.objectContaining({
                    reviewId: 'review-123',
                    evidenceType: 'anomaly',
                    evidenceId: 'anomaly-123',
                }),
            );
        });
    });

    describe('autoCreateFromSlaBreac', () => {
        it('should auto-create incident review from SLA breach', async () => {
            const params = {
                slaBreachId: 'sla-123',
                orderId: 'order-456',
                riderId: null,
                hospitalId: 'hospital-001',
                bloodBankId: null,
                rootCause: IncidentRootCause.SLA_BREACH,
                severity: IncidentSeverity.CRITICAL,
                description: 'Auto-created from SLA breach',
                dueDate: new Date('2026-04-29'),
                metadata: { breachMinutes: 90 },
            };

            const mockReview = {
                id: 'review-456',
                ...params,
                status: IncidentReviewStatus.OPEN,
                reportedByUserId: 'system',
                linkedSlaBreachId: params.slaBreachId,
            };

            mockReviewRepo.create.mockReturnValue(mockReview);
            mockReviewRepo.save.mockResolvedValue(mockReview);
            mockEvidenceRepo.save.mockResolvedValue({});

            const result = await service.autoCreateFromSlaBreac(params);

            expect(result).toEqual(mockReview);
            expect(mockReviewRepo.create).toHaveBeenCalledWith(
                expect.objectContaining({
                    linkedSlaBreachId: 'sla-123',
                    reportedByUserId: 'system',
                }),
            );
        });
    });

    describe('addCorrectiveAction', () => {
        it('should add corrective action to review', async () => {
            const reviewId = 'review-123';
            const dto = {
                description: 'Retrain rider on cold chain protocols',
                assignedTo: 'user-456',
                dueDate: '2026-05-05',
            };

            const mockReview = {
                id: reviewId,
                status: IncidentReviewStatus.OPEN,
                hospitalId: 'hospital-001',
                bloodBankId: null,
            };

            const mockAction = {
                id: 'action-123',
                reviewId,
                description: dto.description,
                assignedTo: dto.assignedTo,
                dueDate: new Date(dto.dueDate),
                status: CorrectiveActionStatus.PENDING,
            };

            mockReviewRepo.findOne.mockResolvedValue(mockReview);
            mockActionRepo.create.mockReturnValue(mockAction);
            mockActionRepo.save.mockResolvedValue(mockAction);
            mockReviewRepo.update.mockResolvedValue({});

            const result = await service.addCorrectiveAction(reviewId, dto, {
                userId: 'user-123',
                role: 'admin',
                organizationId: null,
            });

            expect(result).toEqual(mockAction);
            expect(mockActionRepo.create).toHaveBeenCalledWith(
                expect.objectContaining({
                    reviewId,
                    description: dto.description,
                    status: CorrectiveActionStatus.PENDING,
                }),
            );
            expect(mockReviewRepo.update).toHaveBeenCalledWith(reviewId, {
                status: IncidentReviewStatus.PENDING_ACTION,
            });
        });

        it('should reject adding action to closed review', async () => {
            const reviewId = 'review-123';
            const dto = {
                description: 'Action',
                dueDate: '2026-05-05',
            };

            const mockReview = {
                id: reviewId,
                status: IncidentReviewStatus.CLOSED,
                hospitalId: 'hospital-001',
                bloodBankId: null,
            };

            mockReviewRepo.findOne.mockResolvedValue(mockReview);

            await expect(
                service.addCorrectiveAction(reviewId, dto, {
                    userId: 'user-123',
                    role: 'admin',
                    organizationId: null,
                }),
            ).rejects.toThrow('Cannot add actions to closed review');
        });
    });

    describe('completeCorrectiveAction', () => {
        it('should complete corrective action', async () => {
            const actionId = 'action-123';
            const dto = {
                completionNotes: 'Rider retrained successfully',
                completionEvidence: { certificateId: 'cert-456' },
            };

            const mockAction = {
                id: actionId,
                status: CorrectiveActionStatus.PENDING,
                reviewId: 'review-123',
            };

            const mockUpdated = {
                ...mockAction,
                status: CorrectiveActionStatus.COMPLETED,
                completionNotes: dto.completionNotes,
                completedAt: expect.any(Date),
            };

            mockActionRepo.findOne.mockResolvedValueOnce(mockAction);
            mockActionRepo.update.mockResolvedValue({});
            mockActionRepo.findOne.mockResolvedValueOnce(mockUpdated);

            const result = await service.completeCorrectiveAction(
                actionId,
                dto,
                'user-456',
            );

            expect(result).toEqual(mockUpdated);
            expect(mockActionRepo.update).toHaveBeenCalledWith(
                actionId,
                expect.objectContaining({
                    status: CorrectiveActionStatus.COMPLETED,
                    completionNotes: dto.completionNotes,
                }),
            );
        });

        it('should reject completing already completed action', async () => {
            const actionId = 'action-123';
            const dto = {
                completionNotes: 'Done',
            };

            const mockAction = {
                id: actionId,
                status: CorrectiveActionStatus.COMPLETED,
            };

            mockActionRepo.findOne.mockResolvedValue(mockAction);

            await expect(
                service.completeCorrectiveAction(actionId, dto, 'user-456'),
            ).rejects.toThrow('Action already completed');
        });
    });

    describe('verifyCorrectiveAction', () => {
        it('should verify completed action', async () => {
            const actionId = 'action-123';
            const dto = {
                verificationNotes: 'Verified training completion',
            };

            const mockAction = {
                id: actionId,
                status: CorrectiveActionStatus.COMPLETED,
                reviewId: 'review-123',
            };

            const mockUpdated = {
                ...mockAction,
                status: CorrectiveActionStatus.VERIFIED,
                verifiedBy: 'user-789',
                verificationNotes: dto.verificationNotes,
                verifiedAt: expect.any(Date),
            };

            mockActionRepo.findOne.mockResolvedValueOnce(mockAction);
            mockActionRepo.update.mockResolvedValue({});
            mockActionRepo.find.mockResolvedValue([mockUpdated]);
            mockActionRepo.findOne.mockResolvedValueOnce(mockUpdated);
            mockReviewRepo.update.mockResolvedValue({});

            const result = await service.verifyCorrectiveAction(
                actionId,
                dto,
                'user-789',
            );

            expect(result).toEqual(mockUpdated);
            expect(mockActionRepo.update).toHaveBeenCalledWith(
                actionId,
                expect.objectContaining({
                    status: CorrectiveActionStatus.VERIFIED,
                    verifiedBy: 'user-789',
                }),
            );
            expect(mockReviewRepo.update).toHaveBeenCalledWith('review-123', {
                status: IncidentReviewStatus.PENDING_CLOSURE,
            });
        });

        it('should reject verifying non-completed action', async () => {
            const actionId = 'action-123';
            const dto = {
                verificationNotes: 'Verified',
            };

            const mockAction = {
                id: actionId,
                status: CorrectiveActionStatus.PENDING,
            };

            mockActionRepo.findOne.mockResolvedValue(mockAction);

            await expect(
                service.verifyCorrectiveAction(actionId, dto, 'user-789'),
            ).rejects.toThrow('Action must be completed before verification');
        });
    });

    describe('validateClosure', () => {
        it('should validate closure when all actions verified', async () => {
            const reviewId = 'review-123';
            const mockReview = {
                id: reviewId,
                status: IncidentReviewStatus.PENDING_CLOSURE,
                hospitalId: 'hospital-001',
                bloodBankId: null,
                orderId: 'order-456',
                riderId: null,
                rootCause: IncidentRootCause.COLD_CHAIN_FAILURE,
                severity: IncidentSeverity.HIGH,
                affectsScoring: true,
            };

            const mockActions = [
                { id: 'action-1', status: CorrectiveActionStatus.VERIFIED },
                { id: 'action-2', status: CorrectiveActionStatus.VERIFIED },
            ];

            const mockUpdated = {
                ...mockReview,
                status: IncidentReviewStatus.CLOSED,
                closedAt: expect.any(Date),
                closureValidatedBy: 'user-admin',
                closureValidatedAt: expect.any(Date),
            };

            mockReviewRepo.findOne.mockResolvedValueOnce(mockReview);
            mockActionRepo.find.mockResolvedValue(mockActions);
            mockReviewRepo.update.mockResolvedValue({});
            mockReviewRepo.findOne.mockResolvedValueOnce(mockUpdated);

            const result = await service.validateClosure(reviewId, 'user-admin', {
                userId: 'user-admin',
                role: 'admin',
                organizationId: null,
            });

            expect(result).toEqual(mockUpdated);
            expect(mockReviewRepo.update).toHaveBeenCalledWith(
                reviewId,
                expect.objectContaining({
                    status: IncidentReviewStatus.CLOSED,
                    closureValidatedBy: 'user-admin',
                }),
            );
            expect(mockEventEmitter.emit).toHaveBeenCalledWith(
                'incident.review.closed',
                expect.any(Object),
            );
        });

        it('should reject closure if not in PENDING_CLOSURE status', async () => {
            const reviewId = 'review-123';
            const mockReview = {
                id: reviewId,
                status: IncidentReviewStatus.OPEN,
                hospitalId: 'hospital-001',
                bloodBankId: null,
            };

            mockReviewRepo.findOne.mockResolvedValue(mockReview);

            await expect(
                service.validateClosure(reviewId, 'user-admin', {
                    userId: 'user-admin',
                    role: 'admin',
                    organizationId: null,
                }),
            ).rejects.toThrow('Review must be in PENDING_CLOSURE status');
        });

        it('should reject closure if actions not all verified', async () => {
            const reviewId = 'review-123';
            const mockReview = {
                id: reviewId,
                status: IncidentReviewStatus.PENDING_CLOSURE,
                hospitalId: 'hospital-001',
                bloodBankId: null,
            };

            const mockActions = [
                { id: 'action-1', status: CorrectiveActionStatus.VERIFIED },
                { id: 'action-2', status: CorrectiveActionStatus.COMPLETED },
            ];

            mockReviewRepo.findOne.mockResolvedValue(mockReview);
            mockActionRepo.find.mockResolvedValue(mockActions);

            await expect(
                service.validateClosure(reviewId, 'user-admin', {
                    userId: 'user-admin',
                    role: 'admin',
                    organizationId: null,
                }),
            ).rejects.toThrow('All corrective actions must be verified before closure');
        });
    });

    describe('checkOverdueActions', () => {
        it('should escalate reviews with overdue actions', async () => {
            const now = new Date();
            const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);

            const overdueActions = [
                {
                    id: 'action-1',
                    reviewId: 'review-123',
                    status: CorrectiveActionStatus.PENDING,
                    dueDate: yesterday,
                },
                {
                    id: 'action-2',
                    reviewId: 'review-456',
                    status: CorrectiveActionStatus.IN_PROGRESS,
                    dueDate: yesterday,
                },
            ];

            const mockReview1 = {
                id: 'review-123',
                status: IncidentReviewStatus.PENDING_ACTION,
                escalationLevel: 0,
            };

            const mockReview2 = {
                id: 'review-456',
                status: IncidentReviewStatus.PENDING_ACTION,
                escalationLevel: 1,
            };

            mockActionRepo.find.mockResolvedValue(overdueActions);
            mockReviewRepo.findOne
                .mockResolvedValueOnce(mockReview1)
                .mockResolvedValueOnce(mockReview2);
            mockReviewRepo.update.mockResolvedValue({});

            await service.checkOverdueActions();

            expect(mockReviewRepo.update).toHaveBeenCalledTimes(2);
            expect(mockReviewRepo.update).toHaveBeenCalledWith(
                'review-123',
                expect.objectContaining({
                    status: IncidentReviewStatus.ESCALATED,
                    escalationLevel: 1,
                }),
            );
            expect(mockReviewRepo.update).toHaveBeenCalledWith(
                'review-456',
                expect.objectContaining({
                    status: IncidentReviewStatus.ESCALATED,
                    escalationLevel: 2,
                }),
            );
        });
    });

    describe('getOpenRiskDashboard', () => {
        it('should return open risk dashboard data', async () => {
            const mockReviews = [
                {
                    id: 'review-1',
                    status: IncidentReviewStatus.OPEN,
                    severity: IncidentSeverity.CRITICAL,
                    rootCause: IncidentRootCause.COLD_CHAIN_FAILURE,
                    dueDate: new Date('2026-04-27'),
                },
                {
                    id: 'review-2',
                    status: IncidentReviewStatus.ESCALATED,
                    severity: IncidentSeverity.HIGH,
                    rootCause: IncidentRootCause.SLA_BREACH,
                    dueDate: new Date('2026-05-01'),
                },
                {
                    id: 'review-3',
                    status: IncidentReviewStatus.PENDING_ACTION,
                    severity: IncidentSeverity.MEDIUM,
                    rootCause: IncidentRootCause.COLD_CHAIN_FAILURE,
                    dueDate: new Date('2026-05-05'),
                },
            ];

            const mockQb = {
                where: jest.fn().mockReturnThis(),
                andWhere: jest.fn().mockReturnThis(),
                getMany: jest.fn().mockResolvedValue(mockReviews),
            };

            mockReviewRepo.createQueryBuilder.mockReturnValue(mockQb);
            mockActionRepo.count.mockResolvedValue(5);

            const result = await service.getOpenRiskDashboard({
                userId: 'user-123',
                role: 'admin',
                organizationId: null,
            });

            expect(result.totalOpen).toBe(3);
            expect(result.criticalOpen).toBe(1);
            expect(result.escalatedReviews).toBe(1);
            expect(result.overdueReviews).toBe(1);
            expect(result.overdueActions).toBe(5);
            expect(result.byRootCause).toEqual({
                cold_chain_failure: 2,
                sla_breach: 1,
            });
        });
    });

    describe('getActionCompletionRates', () => {
        it('should calculate action completion rates', async () => {
            const mockActions = [
                {
                    id: 'action-1',
                    status: CorrectiveActionStatus.VERIFIED,
                    createdAt: new Date('2026-04-20'),
                    completedAt: new Date('2026-04-22'),
                    dueDate: new Date('2026-04-25'),
                },
                {
                    id: 'action-2',
                    status: CorrectiveActionStatus.COMPLETED,
                    createdAt: new Date('2026-04-21'),
                    completedAt: new Date('2026-04-24'),
                    dueDate: new Date('2026-04-26'),
                },
                {
                    id: 'action-3',
                    status: CorrectiveActionStatus.PENDING,
                    createdAt: new Date('2026-04-25'),
                    completedAt: null,
                    dueDate: new Date('2026-04-27'),
                },
                {
                    id: 'action-4',
                    status: CorrectiveActionStatus.PENDING,
                    createdAt: new Date('2026-04-26'),
                    completedAt: null,
                    dueDate: new Date('2026-05-01'),
                },
            ];

            const mockQb = {
                andWhere: jest.fn().mockReturnThis(),
                getMany: jest.fn().mockResolvedValue(mockActions),
            };

            mockActionRepo.createQueryBuilder.mockReturnValue(mockQb);

            const result = await service.getActionCompletionRates({
                actor: {
                    userId: 'user-123',
                    role: 'admin',
                    organizationId: null,
                },
            });

            expect(result.totalActions).toBe(4);
            expect(result.completed).toBe(2);
            expect(result.verified).toBe(1);
            expect(result.pending).toBe(2);
            expect(result.completionRate).toBe(50);
            expect(result.verificationRate).toBe(50);
            expect(result.avgCompletionDays).toBeGreaterThan(0);
        });
    });
});
