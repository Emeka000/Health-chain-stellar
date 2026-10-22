import { Injectable, Logger } from '@nestjs/common';
import { SeverityFeatures } from './severity-feature-extractor.service';
import { DeviationSeverity } from './entities/route-deviation-incident.entity';

export interface SeverityClassificationResult {
    severity: DeviationSeverity;
    confidence: number; // 0-100
    explanation: string;
    contributingFactors: Array<{
        factor: string;
        weight: number;
        description: string;
    }>;
    riskScore: number; // 0-100
}

export interface SeverityPolicyThresholds {
    // Distance thresholds (in meters)
    minorDistanceM: number;
    moderateDistanceM: number;
    severeDistanceM: number;

    // Duration thresholds (in seconds)
    minorDurationS: number;
    moderateDurationS: number;
    severeDurationS: number;

    // Risk score thresholds
    minorRiskScore: number;
    moderateRiskScore: number;
    severeRiskScore: number;

    // Urgency multipliers
    criticalOrderMultiplier: number;
    urgentOrderMultiplier: number;

    // Cold chain multipliers
    coldChainMultiplier: number;
    temperatureRiskMultiplier: number;
}

@Injectable()
export class SeverityClassifierService {
    private readonly logger = new Logger(SeverityClassifierService.name);

    // Default policy thresholds
    private readonly defaultThresholds: SeverityPolicyThresholds = {
        minorDistanceM: 500,
        moderateDistanceM: 1000,
        severeDistanceM: 2000,
        minorDurationS: 120,
        moderateDurationS: 300,
        severeDurationS: 600,
        minorRiskScore: 30,
        moderateRiskScore: 60,
        severeRiskScore: 85,
        criticalOrderMultiplier: 1.5,
        urgentOrderMultiplier: 1.2,
        coldChainMultiplier: 1.3,
        temperatureRiskMultiplier: 0.01,
    };

    /**
     * Classify deviation severity using rule-based approach
     */
    classify(
        features: SeverityFeatures,
        thresholds: Partial<SeverityPolicyThresholds> = {},
    ): SeverityClassificationResult {
        const policy = { ...this.defaultThresholds, ...thresholds };

        // Calculate base risk score
        const baseRiskScore = this.calculateBaseRiskScore(features, policy);

        // Apply contextual multipliers
        const contextualRiskScore = this.applyContextualMultipliers(
            baseRiskScore,
            features,
            policy,
        );

        // Determine severity from risk score
        const severity = this.determineSeverity(contextualRiskScore, policy);

        // Calculate confidence
        const confidence = this.calculateConfidence(features, contextualRiskScore);

        // Generate explanation
        const { explanation, contributingFactors } = this.generateExplanation(
            features,
            severity,
            contextualRiskScore,
            policy,
        );

        return {
            severity,
            confidence,
            explanation,
            contributingFactors,
            riskScore: Math.round(contextualRiskScore),
        };
    }

    /**
     * Calculate base risk score from distance and duration
     */
    private calculateBaseRiskScore(
        features: SeverityFeatures,
        policy: SeverityPolicyThresholds,
    ): number {
        // Distance component (0-50 points)
        const distanceScore = Math.min(
            50,
            (features.deviationDistanceM / policy.severeDistanceM) * 50,
        );

        // Duration component (0-50 points)
        const durationScore = Math.min(
            50,
            (features.deviationDurationS / policy.severeDurationS) * 50,
        );

        return distanceScore + durationScore;
    }

    /**
     * Apply contextual multipliers to base risk score
     */
    private applyContextualMultipliers(
        baseScore: number,
        features: SeverityFeatures,
        policy: SeverityPolicyThresholds,
    ): number {
        let score = baseScore;

        // Urgency multiplier
        if (features.orderPriority === 'CRITICAL') {
            score *= policy.criticalOrderMultiplier;
        } else if (features.orderPriority === 'URGENT') {
            score *= policy.urgentOrderMultiplier;
        }

        // Cold chain multiplier
        if (features.hasColdChainRequirement) {
            score *= policy.coldChainMultiplier;

            // Additional temperature risk
            score += features.temperatureRiskScore * policy.temperatureRiskMultiplier;
        }

        // Traffic condition adjustment
        if (features.trafficCondition === 'HEAVY') {
            score *= 0.8; // Reduce severity if traffic is heavy (legitimate delay)
        } else if (features.trafficCondition === 'CLEAR') {
            score *= 1.1; // Increase severity if traffic is clear (no excuse)
        }

        // Rider reliability adjustment
        if (features.riderReliabilityScore < 50) {
            score *= 1.2; // Increase severity for unreliable riders
        } else if (features.riderReliabilityScore > 90) {
            score *= 0.9; // Reduce severity for highly reliable riders
        }

        // Historical deviation adjustment
        if (features.riderDeviationHistory > 5) {
            score *= 1.15; // Pattern of deviations
        }

        return Math.min(100, score);
    }

    /**
     * Determine severity category from risk score
     */
    private determineSeverity(
        riskScore: number,
        policy: SeverityPolicyThresholds,
    ): DeviationSeverity {
        if (riskScore >= policy.severeRiskScore) {
            return DeviationSeverity.SEVERE;
        }
        if (riskScore >= policy.moderateRiskScore) {
            return DeviationSeverity.MODERATE;
        }
        return DeviationSeverity.MINOR;
    }

    /**
     * Calculate confidence in classification
     */
    private calculateConfidence(
        features: SeverityFeatures,
        riskScore: number,
    ): number {
        let confidence = 70; // Base confidence

        // Increase confidence if we have complete context
        if (features.orderPriority !== 'STANDARD') confidence += 5;
        if (features.hasColdChainRequirement) confidence += 5;
        if (features.trafficCondition !== 'UNKNOWN') confidence += 10;
        if (features.riderReliabilityScore > 0) confidence += 5;
        if (features.riderDeviationHistory > 0) confidence += 5;

        // Reduce confidence for edge cases
        if (riskScore > 55 && riskScore < 65) confidence -= 10; // Near threshold
        if (riskScore > 80 && riskScore < 90) confidence -= 10; // Near threshold

        return Math.min(100, Math.max(50, confidence));
    }

    /**
     * Generate human-readable explanation
     */
    private generateExplanation(
        features: SeverityFeatures,
        severity: DeviationSeverity,
        riskScore: number,
        policy: SeverityPolicyThresholds,
    ): {
        explanation: string;
        contributingFactors: Array<{
            factor: string;
            weight: number;
            description: string;
        }>;
    } {
        const factors: Array<{
            factor: string;
            weight: number;
            description: string;
        }> = [];

        // Distance factor
        if (features.deviationDistanceM > policy.moderateDistanceM) {
            factors.push({
                factor: 'Distance',
                weight: 30,
                description: `${Math.round(features.deviationDistanceM)}m deviation (${features.deviationDistanceRatio.toFixed(1)}x corridor radius)`,
            });
        }

        // Duration factor
        if (features.deviationDurationS > policy.moderateDurationS) {
            factors.push({
                factor: 'Duration',
                weight: 25,
                description: `${features.deviationDurationMinutes} minutes off-route`,
            });
        }

        // Urgency factor
        if (features.orderPriority !== 'STANDARD') {
            factors.push({
                factor: 'Order Priority',
                weight: 20,
                description: `${features.orderPriority} priority order`,
            });
        }

        // Cold chain factor
        if (features.hasColdChainRequirement) {
            factors.push({
                factor: 'Cold Chain',
                weight: 15,
                description: `Temperature-sensitive cargo (risk score: ${features.temperatureRiskScore})`,
            });
        }

        // Traffic factor
        if (features.trafficCondition === 'HEAVY') {
            factors.push({
                factor: 'Traffic',
                weight: -10,
                description: `Heavy traffic conditions (mitigating factor)`,
            });
        }

        // Rider history factor
        if (features.riderDeviationHistory > 3) {
            factors.push({
                factor: 'Rider History',
                weight: 10,
                description: `${features.riderDeviationHistory} previous deviations`,
            });
        }

        // Generate explanation text
        const explanation = this.buildExplanationText(
            severity,
            riskScore,
            factors,
        );

        return { explanation, contributingFactors: factors };
    }

    /**
     * Build explanation text
     */
    private buildExplanationText(
        severity: DeviationSeverity,
        riskScore: number,
        factors: Array<{ factor: string; weight: number; description: string }>,
    ): string {
        const severityText = severity.toUpperCase();
        const topFactors = factors
            .sort((a, b) => Math.abs(b.weight) - Math.abs(a.weight))
            .slice(0, 3)
            .map((f) => f.description)
            .join('; ');

        return `Classified as ${severityText} (risk score: ${Math.round(riskScore)}/100). Key factors: ${topFactors || 'Standard deviation metrics'}.`;
    }

    /**
     * Validate classification against historical data
     */
    async validateClassification(
        predicted: DeviationSeverity,
        actual: DeviationSeverity,
        features: SeverityFeatures,
    ): Promise<{
        correct: boolean;
        error: number;
        feedback: string;
    }> {
        const severityMap = {
            [DeviationSeverity.MINOR]: 1,
            [DeviationSeverity.MODERATE]: 2,
            [DeviationSeverity.SEVERE]: 3,
        };

        const predictedScore = severityMap[predicted];
        const actualScore = severityMap[actual];
        const error = Math.abs(predictedScore - actualScore);

        const correct = predicted === actual;

        let feedback = '';
        if (!correct) {
            if (predictedScore < actualScore) {
                feedback = `Under-classified: Predicted ${predicted} but actual was ${actual}. Consider adjusting thresholds or weights.`;
            } else {
                feedback = `Over-classified: Predicted ${predicted} but actual was ${actual}. May be too sensitive to certain factors.`;
            }
        } else {
            feedback = 'Classification matches operator assessment.';
        }

        this.logger.log(
            `Validation: predicted=${predicted}, actual=${actual}, correct=${correct}, error=${error}`,
        );

        return { correct, error, feedback };
    }
}
