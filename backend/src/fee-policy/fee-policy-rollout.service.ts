import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { FeePolicyEntity } from './entities/fee-policy.entity';

export interface CanaryDeployment {
  policyId: string;
  percentage: number; // 0-100
  targetUserIds?: string[];
  targetRegions?: string[];
  startTime: Date;
  endTime?: Date;
  isActive: boolean;
}

export interface RolloutMetrics {
  policyId: string;
  totalOrders: number;
  canaryOrders: number;
  successRate: number;
  averageFeeDifference: number;
  errorCount: number;
  lastUpdated: Date;
}

@Injectable()
export class FeePolicyRolloutService {
  private readonly logger = new Logger(FeePolicyRolloutService.name);
  private activeCanaries = new Map<string, CanaryDeployment>();

  constructor(
    @InjectRepository(FeePolicyEntity)
    private readonly policyRepository: Repository<FeePolicyEntity>,
  ) {}

  /**
   * Starts a canary deployment for a fee policy.
   * Only a percentage of orders will use the new policy for testing.
   */
  async startCanaryDeployment(
    policyId: string,
    percentage: number,
    durationHours: number = 24,
  ): Promise<CanaryDeployment> {
    const policy = await this.policyRepository.findOne({ where: { id: policyId } });
    if (!policy) {
      throw new Error(`Fee policy ${policyId} not found`);
    }

    const deployment: CanaryDeployment = {
      policyId,
      percentage: Math.min(100, Math.max(0, percentage)),
      startTime: new Date(),
      endTime: new Date(Date.now() + durationHours * 60 * 60 * 1000),
      isActive: true,
    };

    this.activeCanaries.set(policyId, deployment);
    this.logger.log(`Started canary deployment for policy ${policyId} at ${percentage}%`);

    return deployment;
  }

  /**
   * Determines if an order should use the canary policy or the stable policy.
   */
  shouldUseCanaryPolicy(orderId: string, canaryPolicyId: string): boolean {
    const deployment = this.activeCanaries.get(canaryPolicyId);
    if (!deployment || !deployment.isActive) {
      return false;
    }

    // Check if deployment has expired
    if (deployment.endTime && new Date() > deployment.endTime) {
      deployment.isActive = false;
      this.activeCanaries.delete(canaryPolicyId);
      return false;
    }

    // Simple percentage-based rollout using order ID hash
    const hash = this.simpleHash(orderId);
    const normalizedHash = (hash % 100 + 100) % 100; // 0-99

    return normalizedHash < deployment.percentage;
  }

  /**
   * Gets metrics for an active canary deployment.
   */
  getCanaryMetrics(policyId: string): RolloutMetrics | null {
    const deployment = this.activeCanaries.get(policyId);
    if (!deployment) {
      return null;
    }

    // In a real implementation, this would query actual order data
    // For now, return placeholder metrics
    return {
      policyId,
      totalOrders: 100,
      canaryOrders: Math.floor(100 * (deployment.percentage / 100)),
      successRate: 0.95,
      averageFeeDifference: 2.50,
      errorCount: 1,
      lastUpdated: new Date(),
    };
  }

  /**
   * Promotes a canary deployment to full production.
   */
  async promoteCanary(policyId: string): Promise<void> {
    const deployment = this.activeCanaries.get(policyId);
    if (!deployment) {
      throw new Error(`No active canary deployment found for policy ${policyId}`);
    }

    // Mark as inactive and log promotion
    deployment.isActive = false;
    this.activeCanaries.delete(policyId);

    this.logger.log(`Promoted canary deployment for policy ${policyId} to production`);
  }

  /**
   * Rolls back a canary deployment.
   */
  async rollbackCanary(policyId: string): Promise<void> {
    const deployment = this.activeCanaries.get(policyId);
    if (!deployment) {
      return; // Already rolled back or never existed
    }

    deployment.isActive = false;
    this.activeCanaries.delete(policyId);

    this.logger.log(`Rolled back canary deployment for policy ${policyId}`);
  }

  /**
   * Gets all active canary deployments.
   */
  getActiveCanaries(): CanaryDeployment[] {
    return Array.from(this.activeCanaries.values()).filter(c => c.isActive);
  }

  private simpleHash(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return hash;
  }
}