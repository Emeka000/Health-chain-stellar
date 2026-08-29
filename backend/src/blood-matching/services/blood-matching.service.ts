import { ConflictException, Injectable, Logger } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';

import { DataSource, MoreThanOrEqual, QueryRunner, Repository } from 'typeorm';

import { BloodRequestItemEntity } from '../../blood-requests/entities/blood-request-item.entity';
import { BloodRequestEntity } from '../../blood-requests/entities/blood-request.entity';
import { BloodUnit } from '../../blood-units/entities/blood-unit.entity';
import { BloodStatus } from '../../blood-units/enums/blood-status.enum';
import { BloodComponent } from '../../blood-units/enums/blood-component.enum';
import { InventoryStockEntity } from '../../inventory/entities/inventory-stock.entity';
import { BloodCompatibilityEngine } from '../compatibility/blood-compatibility.engine';
import type { BloodTypeStr } from '../compatibility/compatibility.types';

export interface BloodTypeCompatibility {
  [key: string]: {
    canDonateTo: string[];
    canReceiveFrom: string[];
  };
}

export interface MatchResult {
  bloodUnitId: string;
  bloodType: string;
  bankId: string;
  quantityMl: number;
  expirationDate: Date;
  matchScore: number;
  matchType: 'exact' | 'compatible' | 'emergency' | 'partial';
  /** Human-readable explanation of why this unit is compatible */
  explanation: string;
  distance?: number;
}

export interface MatchingRequest {
  requestId: string;
  hospitalId: string;
  bloodType: string;
  quantityMl: number;
  urgency: 'low' | 'medium' | 'high' | 'critical';
  requiredBy: Date;
  latitude?: number;
  longitude?: number;
}

export interface MatchingResponse {
  requestId: string;
  matches: MatchResult[];
  totalMatched: number;
  partialFulfillment: boolean;
  remainingQuantity: number;
}

@Injectable()
export class BloodMatchingService {
  private readonly logger = new Logger(BloodMatchingService.name);

  // ABO/Rh compatibility matrix
  private readonly compatibilityMatrix: BloodTypeCompatibility = {
    'O-': {
      canDonateTo: ['O-', 'O+', 'A-', 'A+', 'B-', 'B+', 'AB-', 'AB+'],
      canReceiveFrom: ['O-'],
    },
    'O+': {
      canDonateTo: ['O+', 'A+', 'B+', 'AB+'],
      canReceiveFrom: ['O-', 'O+'],
    },
    'A-': {
      canDonateTo: ['A-', 'A+', 'AB-', 'AB+'],
      canReceiveFrom: ['O-', 'A-'],
    },
    'A+': {
      canDonateTo: ['A+', 'AB+'],
      canReceiveFrom: ['O-', 'O+', 'A-', 'A+'],
    },
    'B-': {
      canDonateTo: ['B-', 'B+', 'AB-', 'AB+'],
      canReceiveFrom: ['O-', 'B-'],
    },
    'B+': {
      canDonateTo: ['B+', 'AB+'],
      canReceiveFrom: ['O-', 'O+', 'B-', 'B+'],
    },
    'AB-': {
      canDonateTo: ['AB-', 'AB+'],
      canReceiveFrom: ['O-', 'A-', 'B-', 'AB-'],
    },
    'AB+': {
      canDonateTo: ['AB+'],
      canReceiveFrom: ['O-', 'O+', 'A-', 'A+', 'B-', 'B+', 'AB-', 'AB+'],
    },
  };

  // Urgency weights for scoring
  private readonly urgencyWeights = {
    low: 1,
    medium: 2,
    high: 3,
    critical: 4,
  };

  constructor(
    @InjectRepository(BloodUnit)
    private readonly bloodUnitRepository: Repository<BloodUnit>,
    @InjectRepository(BloodRequestEntity)
    private readonly bloodRequestRepository: Repository<BloodRequestEntity>,
    @InjectRepository(BloodRequestItemEntity)
    private readonly bloodRequestItemRepository: Repository<BloodRequestItemEntity>,
    @InjectRepository(InventoryStockEntity)
    private readonly inventoryRepository: Repository<InventoryStockEntity>,
    private readonly compatibilityEngine: BloodCompatibilityEngine,
    @InjectDataSource()
    private readonly dataSource: DataSource,
  ) {}

  async findMatches(request: MatchingRequest): Promise<MatchingResponse> {
    this.logger.log(
      `Finding matches for request ${request.requestId}: ${request.quantityMl}ml of ${request.bloodType}`,
    );

    // Get compatible blood types
    const compatibleTypes = this.getCompatibleBloodTypes(request.bloodType);

    // Find, score and reserve matching units atomically so two concurrent
    // requests can never both be handed the same physical unit.
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    let selectedMatches: MatchResult[];
    try {
      selectedMatches = await this.findAndReserveMatchingUnits(
        queryRunner,
        compatibleTypes,
        request,
      );
      await queryRunner.commitTransaction();
    } catch (error) {
      await queryRunner.rollbackTransaction();
      throw error;
    } finally {
      await queryRunner.release();
    }

    // Calculate totals
    const totalMatched = selectedMatches.reduce(
      (sum, match) => sum + match.quantityMl,
      0,
    );
    const remainingQuantity = Math.max(0, request.quantityMl - totalMatched);
    const partialFulfillment = totalMatched > 0 && remainingQuantity > 0;

    return {
      requestId: request.requestId,
      matches: selectedMatches,
      totalMatched,
      partialFulfillment,
      remainingQuantity,
    };
  }

  async findMatchesForMultipleRequests(
    requests: MatchingRequest[],
  ): Promise<MatchingResponse[]> {
    this.logger.log(`Finding matches for ${requests.length} requests`);

    const responses: MatchingResponse[] = [];

    // Sort requests by urgency (critical first)
    const sortedRequests = [...requests].sort((a, b) => {
      const urgencyDiff =
        this.urgencyWeights[b.urgency] - this.urgencyWeights[a.urgency];
      if (urgencyDiff !== 0) return urgencyDiff;

      // If same urgency, sort by requiredBy date
      return a.requiredBy.getTime() - b.requiredBy.getTime();
    });

    // Process each request. findMatches() already reserves matched units
    // atomically, so units taken by an earlier (higher-urgency) request in
    // this batch are unavailable to later ones.
    for (const request of sortedRequests) {
      const response = await this.findMatches(request);
      responses.push(response);
    }

    return responses;
  }

  getCompatibleBloodTypes(bloodType: string): string[] {
    const compatibility = this.compatibilityMatrix[bloodType];
    if (!compatibility) {
      throw new Error(`Invalid blood type: ${bloodType}`);
    }
    return compatibility.canReceiveFrom;
  }

  getDonatableBloodTypes(bloodType: string): string[] {
    const compatibility = this.compatibilityMatrix[bloodType];
    if (!compatibility) {
      throw new Error(`Invalid blood type: ${bloodType}`);
    }
    return compatibility.canDonateTo;
  }

  /**
   * Finds candidate units under a pessimistic write lock, scores them, picks
   * the best matches, and reserves them — all inside the caller's
   * transaction — so concurrent callers can never both walk away thinking
   * they secured the same unit.
   */
  private async findAndReserveMatchingUnits(
    queryRunner: QueryRunner,
    bloodTypes: string[],
    request: MatchingRequest,
  ): Promise<MatchResult[]> {
    const now = new Date();

    const candidateUnits = await queryRunner.manager.find(BloodUnit, {
      where: {
        bloodType: bloodTypes as any,
        status: BloodStatus.AVAILABLE,
        expiresAt: MoreThanOrEqual(now),
      },
      order: {
        expiresAt: 'ASC', // FIFO - oldest expiration first
      },
      lock: { mode: 'pessimistic_write' },
    });

    const scoredMatches = await this.scoreMatches(candidateUnits, request);
    scoredMatches.sort((a, b) => b.matchScore - a.matchScore);
    const selectedMatches = this.selectBestMatches(
      scoredMatches,
      request.quantityMl,
    );

    for (const match of selectedMatches) {
      const result = await queryRunner.manager.update(
        BloodUnit,
        { id: match.bloodUnitId, status: BloodStatus.AVAILABLE },
        { status: BloodStatus.RESERVED },
      );
      if (!result.affected) {
        throw new ConflictException(
          `Blood unit ${match.bloodUnitId} is no longer available`,
        );
      }
    }

    return selectedMatches;
  }

  private async scoreMatches(
    units: BloodUnit[],
    request: MatchingRequest,
  ): Promise<MatchResult[]> {
    const scoredMatches: MatchResult[] = [];
    const isEmergency = request.urgency === 'critical';

    for (const unit of units) {
      const compatResult = this.compatibilityEngine.check(
        unit.bloodType as BloodTypeStr,
        request.bloodType as BloodTypeStr,
        BloodComponent.RED_CELLS,
        isEmergency,
      );

      if (!compatResult.compatible) continue;

      const matchScore = await this.calculateMatchScore(unit, request);

      scoredMatches.push({
        bloodUnitId: unit.id,
        bloodType: unit.bloodType,
        bankId: unit.organizationId,
        quantityMl: unit.volumeMl,
        expirationDate: unit.expiresAt,
        matchScore,
        matchType: compatResult.matchType === 'incompatible' ? 'partial' : compatResult.matchType,
        explanation: compatResult.explanation,
      });
    }

    return scoredMatches;
  }

  private async calculateMatchScore(
    unit: BloodUnit,
    request: MatchingRequest,
  ): Promise<number> {
    let score = 0;

    // 1. Exact match bonus (40 points)
    if (unit.bloodType === request.bloodType) {
      score += 40;
    }

    // 2. Compatibility score (20 points)
    const isCompatible = this.isBloodTypeCompatible(
      unit.bloodType,
      request.bloodType,
    );
    if (isCompatible) {
      score += 20;
    }

    // 3. Expiration score (20 points) - FIFO
    const daysUntilExpiration = this.getDaysUntilExpiration(unit.expiresAt);
    if (daysUntilExpiration <= 7) {
      score += 20; // Urgent - about to expire
    } else if (daysUntilExpiration <= 14) {
      score += 15;
    } else if (daysUntilExpiration <= 30) {
      score += 10;
    } else {
      score += 5;
    }

    // 4. Urgency score (10 points)
    score += this.urgencyWeights[request.urgency] * 2.5;

    // 5. Proximity score (10 points) - if location provided
    if (request.latitude && request.longitude) {
      const distance = await this.calculateDistance(
        unit.organizationId,
        request.latitude,
        request.longitude,
      );
      if (distance !== null) {
        const proximityScore = Math.max(0, 10 - distance / 10);
        score += proximityScore;
      }
    }

    return Math.round(score * 100) / 100;
  }

  private determineMatchType(
    unitBloodType: string,
    requestBloodType: string,
  ): 'exact' | 'compatible' | 'partial' {
    if (unitBloodType === requestBloodType) {
      return 'exact';
    }

    const isCompatible = this.isBloodTypeCompatible(
      unitBloodType,
      requestBloodType,
    );
    if (isCompatible) {
      return 'compatible';
    }

    return 'partial';
  }

  private isBloodTypeCompatible(
    donorType: string,
    recipientType: string,
  ): boolean {
    const compatibility = this.compatibilityMatrix[recipientType];
    if (!compatibility) {
      return false;
    }
    return compatibility.canReceiveFrom.includes(donorType);
  }

  private getDaysUntilExpiration(expirationDate: Date): number {
    const now = new Date();
    const diffTime = expirationDate.getTime() - now.getTime();
    return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  }

  private async calculateDistance(
    bankId: string,
    latitude: number,
    longitude: number,
  ): Promise<number | null> {
    // This would calculate distance between blood bank and hospital
    // For now, return null (no distance calculation)
    return null;
  }

  private selectBestMatches(
    matches: MatchResult[],
    requiredQuantityMl: number,
  ): MatchResult[] {
    const selectedMatches: MatchResult[] = [];
    let remainingQuantity = requiredQuantityMl;

    for (const match of matches) {
      if (remainingQuantity <= 0) break;

      const quantityToTake = Math.min(match.quantityMl, remainingQuantity);

      selectedMatches.push({
        ...match,
        quantityMl: quantityToTake,
      });

      remainingQuantity -= quantityToTake;
    }

    return selectedMatches;
  }

  async calculateMatchingScore(
    bloodType: string,
    urgency: 'low' | 'medium' | 'high' | 'critical',
    daysUntilExpiration: number,
    distance?: number,
  ): Promise<number> {
    let score = 0;

    // Exact match bonus
    score += 40;

    // Expiration score
    if (daysUntilExpiration <= 7) {
      score += 20;
    } else if (daysUntilExpiration <= 14) {
      score += 15;
    } else if (daysUntilExpiration <= 30) {
      score += 10;
    } else {
      score += 5;
    }

    // Urgency score
    score += this.urgencyWeights[urgency] * 2.5;

    // Proximity score
    if (distance !== undefined) {
      const proximityScore = Math.max(0, 10 - distance / 10);
      score += proximityScore;
    }

    return Math.round(score * 100) / 100;
  }

  getCompatibilityMatrix(): BloodTypeCompatibility {
    return this.compatibilityMatrix;
  }
}
