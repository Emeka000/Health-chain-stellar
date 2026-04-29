import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { RouteDeviationIncidentEntity } from './entities/route-deviation-incident.entity';
import { PlannedRouteEntity } from './entities/planned-route.entity';

export interface SeverityFeatures {
    // Distance features
    deviationDistanceM: number;
    deviationDistanceRatio: number; // deviation / corridor radius

    // Duration features
    deviationDurationS: number;
    deviationDurationMinutes: number;

    // Urgency context
    orderPriority: 'CRITICAL' | 'URGENT' | 'STANDARD';
    orderUrgencyScore: number; // 0-100

    // Temperature impact (cold chain)
    hasColdChainRequirement: boolean;
    temperatureRiskScore: number; // 0-100

    // Traffic conditions
    trafficCondition: 'CLEAR' | 'MODERATE' | 'HEAVY' | 'UNKNOWN';
    trafficDelayMinutes: number;

    // Time of day
    isRushHour: boolean;
    timeOfDay: 'MORNING' | 'AFTERNOON' | 'EVENING' | 'NIGHT';

    // Historical context
    riderDeviationHistory: number; // count of past deviations
    riderReliabilityScore: number; // 0-100

    // Metadata
    metadata: Record<string, unknown>;
}

@Injectable()
export class SeverityFeatureExtractorService {
    constructor(
        @InjectRepository(RouteDeviationIncidentEntity)
        private readonly deviationRepo: Repository<RouteDeviationIncidentEntity>,
        @InjectRepository(PlannedRouteEntity)
        private readonly routeRepo: Repository<PlannedRouteEntity>,
    ) { }

    /**
     * Extract severity features from a deviation incident
     */
    async extractFeatures(
        incident: RouteDeviationIncidentEntity,
        context: {
            orderPriority?: 'CRITICAL' | 'URGENT' | 'STANDARD';
            hasColdChainRequirement?: boolean;
            currentTemperature?: number;
            temperatureThreshold?: number;
            trafficCondition?: 'CLEAR' | 'MODERATE' | 'HEAVY' | 'UNKNOWN';
            trafficDelayMinutes?: number;
            riderReliabilityScore?: number;
        } = {},
    ): Promise<SeverityFeatures> {
        // Get planned route for context
        const route = await this.routeRepo.findOne({
            where: { id: incident.plannedRouteId },
        });

        // Distance features
        const corridorRadius = route?.corridorRadiusM ?? 300;
        const deviationDistanceRatio = incident.deviationDistanceM / corridorRadius;

        // Duration features
        const deviationDurationMinutes = Math.floor(incident.deviationDurationS / 60);

        // Urgency context
        const orderPriority = context.orderPriority ?? 'STANDARD';
        const orderUrgencyScore = this.calculateUrgencyScore(orderPriority);

        // Temperature impact
        const hasColdChainRequirement = context.hasColdChainRequirement ?? false;
        const temperatureRiskScore = this.calculateTemperatureRiskScore(
            hasColdChainRequirement,
            context.currentTemperature,
            context.temperatureThreshold,
        );

        // Traffic conditions
        const trafficCondition = context.trafficCondition ?? 'UNKNOWN';
        const trafficDelayMinutes = context.trafficDelayMinutes ?? 0;

        // Time of day
        const now = new Date();
        const hour = now.getHours();
        const isRushHour = this.isRushHourTime(hour);
        const timeOfDay = this.getTimeOfDay(hour);

        // Historical context
        const riderDeviationHistory = await this.getRiderDeviationCount(
            incident.riderId,
        );
        const riderReliabilityScore = context.riderReliabilityScore ?? 75;

        return {
            deviationDistanceM: incident.deviationDistanceM,
            deviationDistanceRatio,
            deviationDurationS: incident.deviationDurationS,
            deviationDurationMinutes,
            orderPriority,
            orderUrgencyScore,
            hasColdChainRequirement,
            temperatureRiskScore,
            trafficCondition,
            trafficDelayMinutes,
            isRushHour,
            timeOfDay,
            riderDeviationHistory,
            riderReliabilityScore,
            metadata: {
                corridorRadius,
                incidentId: incident.id,
                orderId: incident.orderId,
                riderId: incident.riderId,
            },
        };
    }

    /**
     * Calculate urgency score from priority
     */
    private calculateUrgencyScore(
        priority: 'CRITICAL' | 'URGENT' | 'STANDARD',
    ): number {
        switch (priority) {
            case 'CRITICAL':
                return 100;
            case 'URGENT':
                return 70;
            case 'STANDARD':
                return 30;
            default:
                return 30;
        }
    }

    /**
     * Calculate temperature risk score
     */
    private calculateTemperatureRiskScore(
        hasColdChainRequirement: boolean,
        currentTemperature?: number,
        temperatureThreshold?: number,
    ): number {
        if (!hasColdChainRequirement) {
            return 0;
        }

        if (
            currentTemperature === undefined ||
            temperatureThreshold === undefined
        ) {
            return 50; // Unknown risk
        }

        // Calculate how far above threshold
        const exceedance = currentTemperature - temperatureThreshold;

        if (exceedance <= 0) {
            return 0; // Within safe range
        }

        // Risk increases with temperature exceedance
        // 0-2°C = 25, 2-4°C = 50, 4-6°C = 75, >6°C = 100
        if (exceedance <= 2) return 25;
        if (exceedance <= 4) return 50;
        if (exceedance <= 6) return 75;
        return 100;
    }

    /**
     * Check if current time is rush hour
     */
    private isRushHourTime(hour: number): boolean {
        // Morning rush: 7-9 AM, Evening rush: 5-7 PM
        return (hour >= 7 && hour <= 9) || (hour >= 17 && hour <= 19);
    }

    /**
     * Get time of day category
     */
    private getTimeOfDay(
        hour: number,
    ): 'MORNING' | 'AFTERNOON' | 'EVENING' | 'NIGHT' {
        if (hour >= 6 && hour < 12) return 'MORNING';
        if (hour >= 12 && hour < 17) return 'AFTERNOON';
        if (hour >= 17 && hour < 21) return 'EVENING';
        return 'NIGHT';
    }

    /**
     * Get rider's historical deviation count
     */
    private async getRiderDeviationCount(riderId: string): Promise<number> {
        return this.deviationRepo.count({
            where: { riderId },
        });
    }
}
