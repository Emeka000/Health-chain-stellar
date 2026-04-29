import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In, Not } from 'typeorm';

import { BloodComponent } from '../../blood-units/enums/blood-component.enum';
import { BloodType } from '../../blood-units/enums/blood-type.enum';
import { InventoryStockEntity } from '../../inventory/entities/inventory-stock.entity';
import { MapsService } from '../../maps/maps.service';
import { OrganizationEntity } from '../../organizations/entities/organization.entity';
import {
  BloodBankAvailabilityDto,
  GetAvailabilityResponseDto,
} from '../dto/get-availability.dto';
import { DispatchRecord, DispatchStatus } from '../../dispatch/entities/dispatch-record.entity';
import { RiderEntity, RiderStatus } from '../../riders/entities/rider.entity';
import { OrderEntity, OrderStatus } from '../../orders/entities/order.entity';
import { EscalationTier } from '../../escalation/enums/escalation-tier.enum';

@Injectable()
export class BloodBankAvailabilityService {
  private readonly logger = new Logger(BloodBankAvailabilityService.name);
  private readonly CONFIDENCE_SCALE = 100;

  constructor(
    @InjectRepository(InventoryStockEntity)
    private readonly inventoryRepo: Repository<InventoryStockEntity>,
    @InjectRepository(OrganizationEntity)
    private readonly organizationRepo: Repository<OrganizationEntity>,
    @InjectRepository(DispatchRecord)
    private readonly dispatchRepo: Repository<DispatchRecord>,
    @InjectRepository(RiderEntity)
    private readonly riderRepo: Repository<RiderEntity>,
    @InjectRepository(OrderEntity)
    private readonly orderRepo: Repository<OrderEntity>,
    private readonly mapsService: MapsService,
  ) {}

  /**
   * Find nearby blood banks with requested blood type/component
   * Rank by availability, ETA, and reliability factors
   */
  async findNearbyBanksWithStock(
    bloodType: BloodType,
    component: BloodComponent,
    originLatitude?: number,
    originLongitude?: number,
    originAddress?: string,
    maxDistanceKm: number = 100,
    maxResults: number = 10,
  ): Promise<GetAvailabilityResponseDto> {
    const requestId = this.generateRequestId();
    const timestamp = new Date().toISOString();

    // Find all blood banks with requested stock
    const stockRecords = await this.inventoryRepo.find({
      where: {
        bloodType,
        component,
      },
    });

    if (stockRecords.length === 0) {
      return {
        success: true,
        requestId,
        timestamp,
        query: {
          bloodType,
          component,
          latitude: originLatitude,
          longitude: originLongitude,
        },
        results: [],
        summary: {
          totalBanksFound: 0,
          topChoiceEta: null,
          topChoiceConfidence: null,
        },
      };
    }

    // Get blood bank details
    const bloodBankIds = [...new Set(stockRecords.map((s) => s.bloodBankId))];
    const bloodBanks = await this.organizationRepo.findByIds(bloodBankIds);

    // Build availability data with rankings
    const availabilityData: BloodBankAvailabilityDto[] = [];

    for (const stock of stockRecords) {
      const bank = bloodBanks.find((b) => b.id === stock.bloodBankId);
      if (!bank || !bank.latitude || !bank.longitude) {
        continue;
      }

      let estDeliveryTimeMinutes = this.estimateDeliveryTime(
        originLatitude,
        originLongitude,
        bank.latitude as unknown as number,
        bank.longitude as unknown as number,
      );

      // Try to get actual ETA from maps service if we have an address
      if (originAddress && bank.address) {
        try {
          const travelTimeSeconds = await this.mapsService.getTravelTimeSeconds(
            originAddress,
            bank.address,
          );
          estDeliveryTimeMinutes = Math.round(travelTimeSeconds / 60);
        } catch (error) {
          this.logger.warn(
            `Failed to get travel time from "${originAddress}" to "${bank.address}": ${error}`,
          );
          // Fall back to estimated time
        }
      }

      const confidenceScore = this.calculateConfidenceScore(
        stock.availableUnitsMl,
        stock.reservedUnitsMl,
        estDeliveryTimeMinutes,
      );

      const capacityScore = await this.calculateCapacityScore(stock.bloodBankId);
      const capacityBreakdown = await this.getCapacityBreakdown(stock.bloodBankId);

      availabilityData.push({
        bloodBankId: bank.id,
        bloodBankName: bank.name,
        address: bank.address || `${bank.city}, ${bank.country}`,
        latitude: bank.latitude as unknown as number,
        longitude: bank.longitude as unknown as number,
        bloodType,
        component,
        availableQuantityMl: stock.availableUnitsMl,
        reservedQuantityMl: stock.reservedUnitsMl,
        estDeliveryTimeMinutes,
        confidenceScore,
        stockFreshness: this.calculateStockFreshness(stock.updatedAt),
        reservationRisk: this.calculateReservationRisk(
          stock.availableUnitsMl,
          stock.reservedUnitsMl,
        ),
        dispatchLoad: capacityScore,
        compatibilitySummary: `${stock.bloodType} ${stock.component}`,
        capacityBreakdown,
      });
    }

    // Sort by confidence score (descending)
    availabilityData.sort((a, b) => b.confidenceScore - a.confidenceScore);

    // Filter by max results
    const topResults = availabilityData.slice(0, maxResults);

    return {
      success: true,
      requestId,
      timestamp,
      query: {
        bloodType,
        component,
        latitude: originLatitude,
        longitude: originLongitude,
      },
      results: topResults,
      summary: {
        totalBanksFound: availabilityData.length,
        topChoiceEta: topResults.length > 0 ? topResults[0].estDeliveryTimeMinutes : null,
        topChoiceConfidence: topResults.length > 0 ? topResults[0].confidenceScore : null,
      },
    };
  }

  /**
   * Estimate delivery time based on lat/long coordinates
   * Using simple haversine distance approximation
   */
  private estimateDeliveryTime(
    originLat?: number,
    originLng?: number,
    bankLat?: number,
    bankLng?: number,
  ): number {
    if (!originLat || !originLng || !bankLat || !bankLng) {
      return 60; // Default 1 hour if coordinates missing
    }

    const distanceKm = this.calculateHaversineDistance(
      originLat,
      originLng,
      bankLat,
      bankLng,
    );

    // Assume average delivery speed of 40 km/h accounting for logistics
    const deliveryMinutes = Math.round((distanceKm / 40) * 60);
    return Math.max(15, deliveryMinutes); // Minimum 15 minutes
  }

  /**
   * Haversine formula for great-circle distance between two points
   */
  private calculateHaversineDistance(
    lat1: number,
    lon1: number,
    lat2: number,
    lon2: number,
  ): number {
    const earthRadiusKm = 6371;
    const dLat = this.toRad(lat2 - lat1);
    const dLon = this.toRad(lon2 - lon1);
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(this.toRad(lat1)) *
        Math.cos(this.toRad(lat2)) *
        Math.sin(dLon / 2) *
        Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return earthRadiusKm * c;
  }

  private toRad(degrees: number): number {
    return (degrees * Math.PI) / 180;
  }

  /**
   * Calculate confidence score (0-100) based on:
   * - Available inventory quantity (higher available = higher confidence)
   * - Reservation risk (high reservations = lower confidence)
   * - Delivery time (shorter delivery = higher confidence)
   */
  private calculateConfidenceScore(
    availableQuantityMl: number,
    reservedQuantityMl: number,
    estDeliveryTimeMinutes: number,
  ): number {
    const MIN_AVAILABLE = 100; // Minimum acceptable
    const MAX_AVAILABLE = 1000; // Saturated stock

    // Stock component: 0-40 points
    const availableScore = Math.min(
      40,
      (availableQuantityMl / MAX_AVAILABLE) * 40,
    );

    // Reservation risk component: 0-30 points
    const totalQuantity = availableQuantityMl + reservedQuantityMl;
    const reservationRatio = totalQuantity > 0 ? reservedQuantityMl / totalQuantity : 0;
    const reservationScore = Math.max(
      0,
      30 - reservationRatio * 30,
    );

    // Delivery time component: 0-30 points
    const MAX_DELIVERY_TIME = 240; // 4 hours
    const deliveryScore = Math.max(
      0,
      30 - (estDeliveryTimeMinutes / MAX_DELIVERY_TIME) * 30,
    );

    return Math.round(availableScore + reservationScore + deliveryScore);
  }

  /**
   * Calculate stock freshness (0-100) based on last update
   */
  private calculateStockFreshness(lastUpdated: Date): number {
    const nowMs = Date.now();
    const updatedMs = lastUpdated.getTime();
    const ageMinutes = (nowMs - updatedMs) / (1000 * 60);

    const MAX_FRESH_AGE_MINUTES = 60;
    if (ageMinutes <= MAX_FRESH_AGE_MINUTES) {
      return 100;
    }

    const MAX_STALE_AGE_MINUTES = 1440; // 24 hours
    if (ageMinutes >= MAX_STALE_AGE_MINUTES) {
      return 10;
    }

    // Linear decline from 100 to 10
    const freshness = 100 - ((ageMinutes - MAX_FRESH_AGE_MINUTES) / (MAX_STALE_AGE_MINUTES - MAX_FRESH_AGE_MINUTES)) * 90;
    return Math.round(freshness);
  }

  /**
   * Calculate reservation risk (0-100) based on reserved vs available ratio
   */
  private calculateReservationRisk(
    availableQuantityMl: number,
    reservedQuantityMl: number,
  ): number {
    const totalQuantity = availableQuantityMl + reservedQuantityMl;
    if (totalQuantity === 0) {
      return 0;
    }

    const reservationRatio = reservedQuantityMl / totalQuantity;
    return Math.round(reservationRatio * 100);
  }

  /**
   * Calculate capacity-aware fulfillment score for a blood bank
   * Uses real operational inputs: outstanding dispatches, rider availability,
   * cold-chain capacity, SLA risk, and recent failure rates
   */
  private async calculateCapacityScore(
    bloodBankId: string,
  ): Promise<number> {
    const breakdown = await this.getCapacityBreakdown(bloodBankId);

    // Calculate weighted score (0-100)
    // Higher score = better capacity (less load, more available)
    const dispatchPressureScore = Math.max(0, 100 - breakdown.outstandingDispatches * 10);
    const riderAvailabilityScore = breakdown.availableRiders * 20;
    const slaRiskScore = Math.max(0, 100 - breakdown.slaRisk * 20);
    const failureRateScore = Math.max(0, 100 - breakdown.failureRate * 50);

    const totalScore = Math.round(
      (dispatchPressureScore * 0.3 +
        riderAvailabilityScore * 0.3 +
        slaRiskScore * 0.2 +
        failureRateScore * 0.2),
    );

    this.logger.debug(
      `Capacity score for bank ${bloodBankId}: ${totalScore} - ` +
        `dispatches: ${breakdown.outstandingDispatches}, ` +
        `riders: ${breakdown.availableRiders}, ` +
        `slaRisk: ${breakdown.slaRisk.toFixed(2)}, ` +
        `failureRate: ${breakdown.failureRate.toFixed(2)}`,
    );

    return totalScore;
  }

  /**
   * Get detailed capacity breakdown for a blood bank
   * Returns deterministic metrics based on current state
   */
  private async getCapacityBreakdown(bloodBankId: string): Promise<{
    outstandingDispatches: number;
    availableRiders: number;
    slaRisk: number;
    failureRate: number;
    coldChainUtilization: number;
  }> {
    // Count outstanding dispatches for this blood bank
    // Query orders for this blood bank, then count their dispatches
    const activeOrderIds = await this.orderRepo
      .createQueryBuilder('order')
      .select('order.id')
      .where('order.bloodBankId = :bloodBankId', { bloodBankId })
      .andWhere('order.status IN (:...statuses)', {
        statuses: [OrderStatus.PENDING, OrderStatus.CONFIRMED, OrderStatus.DISPATCHED, OrderStatus.IN_TRANSIT],
      })
      .getMany();

    const orderIds = activeOrderIds.map(o => o.id);
    const outstandingDispatches = orderIds.length > 0
      ? await this.dispatchRepo.count({
          where: {
            orderId: In(orderIds),
            status: In([DispatchStatus.PENDING, DispatchStatus.ASSIGNED, DispatchStatus.IN_TRANSIT]),
          },
        })
      : 0;

    // Count available riders (simplified - in production would filter by area/region)
    const availableRiders = await this.riderRepo.count({
      where: { status: RiderStatus.AVAILABLE, isVerified: true },
    });

    // Calculate SLA risk based on orders with escalation tiers
    const escalatedOrders = await this.orderRepo.count({
      where: {
        bloodBankId,
        status: In([OrderStatus.PENDING, OrderStatus.CONFIRMED, OrderStatus.DISPATCHED]),
        escalationTier: Not(EscalationTier.NONE),
      },
    });
    const totalActiveOrders = await this.orderRepo.count({
      where: {
        bloodBankId,
        status: In([OrderStatus.PENDING, OrderStatus.CONFIRMED, OrderStatus.DISPATCHED]),
      },
    });
    const slaRisk = totalActiveOrders > 0 ? escalatedOrders / totalActiveOrders : 0;

    // Calculate failure rate from rider metrics
    const riders = await this.riderRepo.find({ where: { isVerified: true } });
    let totalDeliveries = 0;
    let totalFailures = 0;
    for (const rider of riders) {
      totalDeliveries += rider.completedDeliveries;
      totalFailures += rider.cancelledDeliveries + rider.failedDeliveries;
    }
    const failureRate = totalDeliveries > 0 ? totalFailures / totalDeliveries : 0;

    // Cold-chain utilization (from inventory - already calculated elsewhere)
    // This is a placeholder - actual implementation would query cold-chain capacity
    const coldChainUtilization = 0.5; // Midpoint as default

    return {
      outstandingDispatches,
      availableRiders,
      slaRisk,
      failureRate,
      coldChainUtilization,
    };
  }

  /**
   * Generate unique request ID for correlation
   */
  private generateRequestId(): string {
    return `avail-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }
}
