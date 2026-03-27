import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { Repository } from 'typeorm';

import {
  RiderSearchDto,
  RiderAssignmentDto,
  RiderSearchResult,
  RiderAssignmentResult,
  AssignmentScore,
  RiderSearchResponse,
  RiderAssignmentResponse,
} from '../dto/rider-search.dto';
import { RiderEntity } from '../entities/rider.entity';
import { RiderStatus } from '../enums/rider-status.enum';
import { VehicleType } from '../enums/vehicle-type.enum';

@Injectable()
export class RiderSearchService {
  private readonly logger = new Logger(RiderSearchService.name);

  constructor(
    @InjectRepository(RiderEntity)
    private readonly riderRepository: Repository<RiderEntity>,
  ) {}

  /**
   * Search for riders based on geolocation and filters
   */
  async searchRiders(searchDto: RiderSearchDto): Promise<RiderSearchResponse> {
    const {
      latitude,
      longitude,
      radiusKm,
      vehicleType,
      minRating,
      minCompletionRate,
      availableOnly,
      limit,
      offset,
    } = searchDto;

    // Build query
    const queryBuilder = this.riderRepository.createQueryBuilder('rider');

    // Filter by status
    if (availableOnly) {
      queryBuilder.andWhere('rider.status = :status', {
        status: RiderStatus.AVAILABLE,
      });
      queryBuilder.andWhere('rider.isVerified = :isVerified', {
        isVerified: true,
      });
    }

    // Filter by vehicle type
    if (vehicleType) {
      queryBuilder.andWhere('rider.vehicleType = :vehicleType', {
        vehicleType,
      });
    }

    // Filter by minimum rating
    if (minRating !== undefined) {
      queryBuilder.andWhere('rider.rating >= :minRating', {
        minRating,
      });
    }

    // Get all matching riders
    const riders = await queryBuilder.getMany();

    // Calculate distances and filter by radius
    let filteredRiders = riders.map((rider) => {
      const distanceKm = this.calculateDistance(
        latitude,
        longitude,
        rider.latitude,
        rider.longitude,
      );

      const completionRate = this.calculateCompletionRate(
        rider.completedDeliveries,
        rider.cancelledDeliveries,
        rider.failedDeliveries,
      );

      return {
        ...rider,
        distanceKm,
        completionRate,
      };
    });

    // Filter by radius
    if (radiusKm) {
      filteredRiders = filteredRiders.filter(
        (rider) => rider.distanceKm !== null && rider.distanceKm <= radiusKm,
      );
    }

    // Filter by minimum completion rate
    if (minCompletionRate !== undefined) {
      filteredRiders = filteredRiders.filter(
        (rider) => rider.completionRate >= minCompletionRate,
      );
    }

    // Sort by distance
    filteredRiders.sort((a, b) => {
      if (a.distanceKm === null) return 1;
      if (b.distanceKm === null) return -1;
      return a.distanceKm - b.distanceKm;
    });

    // Apply pagination
    const total = filteredRiders.length;
    const paginatedRiders = filteredRiders.slice(offset, offset + limit);

    // Map to response format
    const results: RiderSearchResult[] = paginatedRiders.map((rider) => ({
      id: rider.id,
      userId: rider.userId,
      vehicleType: rider.vehicleType,
      status: rider.status,
      latitude: rider.latitude,
      longitude: rider.longitude,
      rating: rider.rating,
      completedDeliveries: rider.completedDeliveries,
      cancelledDeliveries: rider.cancelledDeliveries,
      failedDeliveries: rider.failedDeliveries,
      isVerified: rider.isVerified,
      distanceKm: rider.distanceKm,
      completionRate: rider.completionRate,
    }));

    return {
      message: 'Riders retrieved successfully',
      data: results,
      total,
      limit,
      offset,
    };
  }

  /**
   * Find and score riders for assignment
   */
  async findRidersForAssignment(
    assignmentDto: RiderAssignmentDto,
  ): Promise<RiderAssignmentResponse> {
    const { latitude, longitude, vehicleType, maxCandidates } = assignmentDto;

    // Get available riders
    const riders = await this.riderRepository.find({
      where: {
        status: RiderStatus.AVAILABLE,
        isVerified: true,
      },
    });

    // Score each rider
    const scoredRiders = await this.scoreRiders(
      riders,
      latitude,
      longitude,
      vehicleType,
    );

    // Sort by total score (descending)
    scoredRiders.sort((a, b) => b.score.totalScore - a.score.totalScore);

    // Take top candidates
    const candidates = scoredRiders.slice(0, maxCandidates);

    // Select the best rider
    const selectedRider = candidates.length > 0 ? candidates[0] : null;

    return {
      message: 'Rider assignment candidates retrieved successfully',
      data: {
        candidates: candidates.map((c) => ({
          riderId: c.riderId,
          score: c.score,
          distanceKm: c.distanceKm,
          travelTimeSeconds: c.travelTimeSeconds,
        })),
        selectedRider: selectedRider
          ? {
              riderId: selectedRider.riderId,
              score: selectedRider.score,
              distanceKm: selectedRider.distanceKm,
              travelTimeSeconds: selectedRider.travelTimeSeconds,
            }
          : null,
      },
    };
  }

  /**
   * Score riders based on multiple factors
   */
  private async scoreRiders(
    riders: RiderEntity[],
    pickupLatitude: number,
    pickupLongitude: number,
    preferredVehicleType?: VehicleType,
  ): Promise<RiderAssignmentResult[]> {
    const results: RiderAssignmentResult[] = [];

    for (const rider of riders) {
      const distanceKm = this.calculateDistance(
        pickupLatitude,
        pickupLongitude,
        rider.latitude,
        rider.longitude,
      );

      // Skip riders without location data
      if (distanceKm === null) {
        continue;
      }

      const completionRate = this.calculateCompletionRate(
        rider.completedDeliveries,
        rider.cancelledDeliveries,
        rider.failedDeliveries,
      );

      // Estimate travel time (assuming average speed of 30 km/h)
      const travelTimeSeconds = Math.round((distanceKm / 30) * 3600);

      // Calculate individual scores
      const distanceScore = this.calculateDistanceScore(distanceKm);
      const ratingScore = this.calculateRatingScore(rider.rating);
      const completionRateScore =
        this.calculateCompletionRateScore(completionRate);
      const vehicleTypeScore = this.calculateVehicleTypeScore(
        rider.vehicleType,
        preferredVehicleType,
      );

      // Calculate total score (weighted average)
      const totalScore =
        distanceScore * 0.4 +
        ratingScore * 0.25 +
        completionRateScore * 0.25 +
        vehicleTypeScore * 0.1;

      const score: AssignmentScore = {
        riderId: rider.id,
        distanceScore,
        ratingScore,
        completionRateScore,
        vehicleTypeScore,
        totalScore,
        distanceKm,
        travelTimeSeconds,
        rating: rider.rating,
        completionRate,
        vehicleType: rider.vehicleType,
      };

      results.push({
        riderId: rider.id,
        score,
        distanceKm,
        travelTimeSeconds,
      });
    }

    return results;
  }

  /**
   * Calculate distance between two points using Haversine formula
   */
  calculateDistance(
    lat1: number | null,
    lon1: number | null,
    lat2: number | null,
    lon2: number | null,
  ): number | null {
    if (lat1 === null || lon1 === null || lat2 === null || lon2 === null) {
      return null;
    }

    const R = 6371; // Earth's radius in km
    const dLat = this.toRad(lat2 - lat1);
    const dLon = this.toRad(lon2 - lon1);
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(this.toRad(lat1)) *
        Math.cos(this.toRad(lat2)) *
        Math.sin(dLon / 2) *
        Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    const distance = R * c;

    return Math.round(distance * 100) / 100; // Round to 2 decimal places
  }

  /**
   * Convert degrees to radians
   */
  private toRad(deg: number): number {
    return deg * (Math.PI / 180);
  }

  /**
   * Calculate completion rate
   */
  private calculateCompletionRate(
    completed: number,
    cancelled: number,
    failed: number,
  ): number {
    const total = completed + cancelled + failed;
    if (total === 0) return 100; // New rider with no history
    return Math.round((completed / total) * 100);
  }

  /**
   * Calculate distance score (closer is better)
   */
  private calculateDistanceScore(distanceKm: number): number {
    // Exponential decay: score decreases as distance increases
    // Score of 1 at 0km, score of 0.5 at 5km, score of 0.25 at 10km
    return Math.exp(-distanceKm / 5);
  }

  /**
   * Calculate rating score (higher is better)
   */
  private calculateRatingScore(rating: number): number {
    // Normalize rating to 0-1 scale
    return rating / 5;
  }

  /**
   * Calculate completion rate score (higher is better)
   */
  private calculateCompletionRateScore(completionRate: number): number {
    // Normalize completion rate to 0-1 scale
    return completionRate / 100;
  }

  /**
   * Calculate vehicle type score (matching is better)
   */
  private calculateVehicleTypeScore(
    riderVehicleType: VehicleType,
    preferredVehicleType?: VehicleType,
  ): number {
    if (!preferredVehicleType) {
      return 1; // No preference, all vehicles score equally
    }

    // Perfect match
    if (riderVehicleType === preferredVehicleType) {
      return 1;
    }

    // Partial matches based on vehicle compatibility
    const compatibilityMap: Record<VehicleType, VehicleType[]> = {
      [VehicleType.MOTORCYCLE]: [VehicleType.MOTORCYCLE, VehicleType.BICYCLE],
      [VehicleType.CAR]: [VehicleType.CAR, VehicleType.VAN],
      [VehicleType.BICYCLE]: [VehicleType.BICYCLE, VehicleType.MOTORCYCLE],
      [VehicleType.VAN]: [VehicleType.VAN, VehicleType.CAR],
    };

    const compatibleVehicles = compatibilityMap[preferredVehicleType] || [];
    if (compatibleVehicles.includes(riderVehicleType)) {
      return 0.7; // Partial match
    }

    return 0.3; // No match
  }

  /**
   * Get rider statistics
   */
  async getRiderStatistics(riderId: string): Promise<{
    totalDeliveries: number;
    completionRate: number;
    averageRating: number;
    distanceStats: {
      averageDistanceKm: number;
      maxDistanceKm: number;
      minDistanceKm: number;
    };
  }> {
    const rider = await this.riderRepository.findOne({
      where: { id: riderId },
    });

    if (!rider) {
      throw new Error(`Rider ${riderId} not found`);
    }

    const totalDeliveries =
      rider.completedDeliveries +
      rider.cancelledDeliveries +
      rider.failedDeliveries;
    const completionRate = this.calculateCompletionRate(
      rider.completedDeliveries,
      rider.cancelledDeliveries,
      rider.failedDeliveries,
    );

    // For now, return placeholder distance stats
    // In a real implementation, this would query delivery history
    return {
      totalDeliveries,
      completionRate,
      averageRating: rider.rating,
      distanceStats: {
        averageDistanceKm: 0,
        maxDistanceKm: 0,
        minDistanceKm: 0,
      },
    };
  }
}
