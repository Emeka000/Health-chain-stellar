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

/**
 * Default reservation window (in minutes) applied to units reserved by the
 * matching flow. Units are released automatically once `reservedUntil`
 * elapses so a match can never lock inventory indefinitely.
 */
export const DEFAULT_RESERVATION_TTL_MINUTES = 30;

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

    // Tie the request to a real blood request in the caller's tenant before
    // reserving anything, so a viewer-level account cannot reserve units for
    // an arbitrary / non-existent request.
    await this.assertRequestBelongsToTenant(
      request.requestId,
      request.hospitalId,
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
   * Ensures the supplied requestId refers to a real blood request that belongs
   * to the caller's tenant (hospitalId). Rejects unknown or cross-tenant
   * requests so a caller cannot reserve inventory against someone else's
   * request.
   */
  private async assertRequestBelongsToTenant(
    requestId: string,
    hospitalId: string,
  ): Promise<void> {
    const bloodRequest = await this.bloodRequestRepository.findOne({
      where: { id: requestId },
    });

    if (!bloodRequest) {
      throw new ConflictException(
        `Blood request ${requestId} does not exist`,
      );
    }

    const requestHospitalId =
      (bloodRequest as any).hospitalId ??
      (bloodRequest as any).hospital?.id ??
      (bloodRequest as any).tenantId;

    if (requestHospitalId && requestHospitalId !== hospitalId) {
      throw new ConflictException(
        `Blood request ${requestId} does not belong to hospital ${hospitalId}`,
      );
    }
  }

  /**
   * Loads candidate units inside the transaction, scores them, selects the
   * best subset that fulfils the request, and reserves the selected units.
   */
  private async findAndReserveMatchingUnits(
    queryRunner: QueryRunner,
    compatibleTypes: string[],
    request: MatchingRequest,
  ): Promise<MatchResult[]> {
    const now = new Date();

    const candidates = await queryRunner.manager.find(BloodUnit, {
      where: {
        bloodType: In(compatibleTypes) as any,
        status: BloodStatus.AVAILABLE,
        expirationDate: MoreThanOrEqual(now),
      },
      order: { expirationDate: 'ASC' },
    });

    if (candidates.length === 0) {
      return [];
    }

    const scored = this.scoreMatches(candidates, request);
    const selected = this.selectBestMatches(scored, request.quantityMl);

    if (selected.length === 0) {
      return [];
    }

    const reservedUntil = new Date(
      now.getTime() + DEFAULT_RESERVATION_TTL_MINUTES * 60 * 1000,
    );

    const selectedIds = selected.map((match) => match.bloodUnitId);
    await queryRunner.manager.update(
      BloodUnit,
      { id: In(selectedIds) as any },
      {
        status: BloodStatus.RESERVED,
        reservedUntil,
      } as any,
    );

    return selected;
  }

  /**
   * Scores every candidate unit against the request and returns them sorted
   * from best to worst match.
   */
  scoreMatches(
    units: BloodUnit[],
    request: MatchingRequest,
  ): MatchResult[] {
    const results: MatchResult[] = units.map((unit) => {
      const matchScore = this.calculateMatchScore(unit, request);
      const matchType = this.determineMatchType(unit, request);
      const distance = this.calculateDistance(
        request.latitude,
        request.longitude,
        (unit as any).bank?.latitude,
        (unit as any).bank?.longitude,
      );

      return {
        bloodUnitId: unit.id,
        bloodType: unit.bloodType,
        bankId: (unit as any).bankId ?? (unit as any).bank?.id,
        quantityMl: unit.quantityMl,
        expirationDate: unit.expirationDate,
        matchScore,
        matchType,
        explanation: this.buildExplanation(unit, request, matchType),
        distance,
      };
    });

    return results.sort((a, b) => b.matchScore - a.matchScore);
  }

  /**
   * Greedily selects the highest-scoring units until the requested quantity is
   * met (or candidates are exhausted).
   */
  selectBestMatches(
    matches: MatchResult[],
    requestedQuantityMl: number,
  ): MatchResult[] {
    const selected: MatchResult[] = [];
    let remaining = requestedQuantityMl;

    for (const match of matches) {
      if (remaining <= 0) break;
      selected.push(match);
      remaining -= match.quantityMl;
    }

    return selected;
  }

  /**
   * Computes a 0-100 score for a candidate unit. Higher is better. Combines
   * blood-type compatibility, expiration proximity, urgency and distance.
   */
  calculateMatchScore(
    unit: BloodUnit,
    request: MatchingRequest,
  ): number {
    return this.calculateMatchingScore(unit, request);
  }

  calculateMatchingScore(
    unit: BloodUnit,
    request: MatchingRequest,
  ): number {
    let score = 0;

    // Blood type compatibility (max 40)
    if (unit.bloodType === request.bloodType) {
      score += 40;
    } else if (this.isBloodTypeCompatible(unit.bloodType, request.bloodType)) {
      score += 25;
    }

    // Expiration proximity (max 30): fresher units score higher
    const daysUntilExpiration = this.getDaysUntilExpiration(unit.expirationDate);
    if (daysUntilExpiration >= 30) {
      score += 30;
    } else if (daysUntilExpiration > 0) {
      score += Math.round((daysUntilExpiration / 30) * 30);
    }

    // Urgency weight (max 20)
    const urgencyWeight = this.urgencyWeights[request.urgency] ?? 1;
    score += Math.round((urgencyWeight / 4) * 20);

    // Distance bonus (max 10): closer banks score higher
    const distance = this.calculateDistance(
      request.latitude,
      request.longitude,
      (unit as any).bank?.latitude,
      (unit as any).bank?.longitude,
    );
    if (distance !== undefined) {
      score += Math.max(0, 10 - Math.min(distance, 100) / 10);
    }

    return Math.round(score);
  }

  determineMatchType(
    unit: BloodUnit,
    request: MatchingRequest,
  ): 'exact' | 'compatible' | 'emergency' | 'partial' {
    if (unit.bloodType === request.bloodType) {
      return 'exact';
    }
    if (request.urgency === 'critical') {
      return 'emergency';
    }
    if (this.isBloodTypeCompatible(unit.bloodType, request.bloodType)) {
      return 'compatible';
    }
    return 'partial';
  }

  getCompatibilityMatrix(): BloodTypeCompatibility {
    return this.compatibilityMatrix;
  }

  getDaysUntilExpiration(expirationDate: Date): number {
    const now = new Date();
    const diffMs = new Date(expirationDate).getTime() - now.getTime();
    return Math.floor(diffMs / (1000 * 60 * 60 * 24));
  }

  isBloodTypeCompatible(donorType: string, recipientType: string): boolean {
    const compatibility = this.compatibilityMatrix[donorType];
    if (!compatibility) {
      return false;
    }
    return compatibility.canDonateTo.includes(recipientType);
  }

  /**
   * Haversine distance in kilometres between two coordinate pairs. Returns
   * undefined when any coordinate is missing.
   */
  calculateDistance(
    lat1?: number,
    lon1?: number,
    lat2?: number,
    lon2?: number,
  ): number | undefined {
    if (
      lat1 === undefined ||
      lon1 === undefined ||
      lat2 === undefined ||
      lon2 === undefined
    ) {
      return undefined;
    }

    const toRad = (deg: number) => (deg * Math.PI) / 180;
    const earthRadiusKm = 6371;
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(toRad(lat1)) *
        Math.cos(toRad(lat2)) *
        Math.sin(dLon / 2) *
        Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return earthRadiusKm * c;
  }

  private buildExplanation(
    unit: BloodUnit,
    request: MatchingRequest,
    matchType: 'exact' | 'compatible' | 'emergency' | 'partial',
  ): string {
    switch (matchType) {
      case 'exact':
        return `Exact blood type match (${unit.bloodType})`;
      case 'emergency':
        return `Emergency release: ${unit.bloodType} compatible with ${request.bloodType}`;
      case 'compatible':
        return `${unit.bloodType} is compatible with recipient ${request.bloodType}`;
      default:
        return `Partial compatibility for ${request.bloodType}`;
    }
  }
}
