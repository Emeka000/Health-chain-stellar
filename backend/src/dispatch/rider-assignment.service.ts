import { Injectable, Logger, Inject } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2, OnEvent } from '@nestjs/event-emitter';
import Redis from 'ioredis';

import { OrderConfirmedEvent, OrderRiderAssignedEvent } from '../events';
import { MapsService } from '../maps/maps.service';
import { PolicyCenterService } from '../policy-center/policy-center.service';
import { RiderRecord, RidersService } from '../riders/riders.service';
import { REDIS_CLIENT } from '../redis/redis.constants';

const DEDUP_TTL_SECONDS = 3600;
const DEDUP_KEY_PREFIX = 'rider-assignment:dedup:';

@Injectable()
export class RiderAssignmentService {
  private readonly logger = new Logger(RiderAssignmentService.name);
  private readonly assignmentLogs: AssignmentLog[] = [];
  private readonly activeAssignments = new Map<string, ActiveAssignmentState>();
  private readonly defaultAcceptanceTimeoutMs: number;
  private readonly defaultWeights: AssignmentWeights;

  constructor(
    private readonly ridersService: RidersService,
    private readonly mapsService: MapsService,
    private readonly eventEmitter: EventEmitter2,
    private readonly configService: ConfigService,
    private readonly policyCenterService: PolicyCenterService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {
    this.defaultAcceptanceTimeoutMs = this.configService.get<number>(
      'ASSIGNMENT_ACCEPTANCE_TIMEOUT_MS',
      180000,
    );
    this.defaultWeights = this.resolveWeights();
  }

  @OnEvent('order.confirmed')
  async handleOrderConfirmed(event: OrderConfirmedEvent) {
    const key = `${DEDUP_KEY_PREFIX}order.confirmed:${event.orderId}:${event.timestamp.getTime()}`;
    if (!(await this.acquireDedup(key))) {
      this.logger.warn(`Duplicate event skipped: ${key}`);
      return;
    }

    this.logger.log(`Handling order confirmed for rider assignment: ${event.orderId}`);
    await this.startAutomatedAssignment(event);

    return { message: 'Rider assignment initiated', data: { orderId: event.orderId } };
  }

  /**
   * Reassign a delivery/order to a new backup rider after a cold-chain breach.
   */
  async reassign(orderId: string): Promise<void> {
    this.logger.log(`Reassigning rider for order/delivery ${orderId} after cold-chain breach`);
    const availableResponse = await this.ridersService.getAvailableRiders();
    const riders = availableResponse.data ?? [];

    if (riders.length === 0) {
      this.logger.warn(`No available riders for reassignment of ${orderId}`);
      this.appendAssignmentLog({
        orderId,
        selectedRiderId: null,
        status: 'exhausted',
        attemptNumber: 0,
        candidates: [],
        weights: this.defaultWeights,
        reason: 'no_available_riders',
      });
      return;
    }

    const policyConfig = await this.getRuntimeAssignmentConfig();
    const scored = await this.scoreRiders(riders, orderId, policyConfig.weights);
    const ranked = scored.sort((a, b) => b.score.totalScore - a.score.totalScore);
    const best = ranked[0];

    this.appendAssignmentLog({
      orderId,
      selectedRiderId: best.rider.id,
      status: 'pending',
      attemptNumber: 1,
      candidates: ranked.map((r) => r.score),
      weights: policyConfig.weights,
      reason: 'initial_assignment',
    });

    this.eventEmitter.emit('order.rider.assigned', new OrderRiderAssignedEvent(orderId, best.rider.id));
    this.logger.log(`Backup rider ${best.rider.id} assigned to ${orderId}`);
  }

  async getAssignmentLogs(orderId?: string) {    const data = orderId
      ? this.assignmentLogs.filter((log) => log.orderId === orderId)
      : this.assignmentLogs;

    return {
      message: 'Assignment logs retrieved successfully',
      data,
    };
  }

  async respondToAssignment(
    orderId: string,
    riderId: string,
    accepted: boolean,
  ) {
    const assignment = this.activeAssignments.get(orderId);
    if (!assignment) {
      return {
        message: 'No active assignment found for order',
        data: { orderId, riderId, accepted },
      };
    }

    const currentCandidate = assignment.candidates[assignment.currentIndex];
    if (!currentCandidate || currentCandidate.rider.id !== riderId) {
      return {
        message: 'Response does not match current rider candidate',
        data: {
          orderId,
          riderId,
          expectedRiderId: currentCandidate?.rider.id ?? null,
        },
      };
    }

    this.clearAssignmentTimer(assignment);

    if (accepted) {
      this.appendAssignmentLog({
        orderId,
        selectedRiderId: riderId,
        status: 'accepted',
        attemptNumber: assignment.currentIndex + 1,
        candidates: assignment.candidates.map((item) => item.score),
        weights: assignment.weights,
        reason: 'rider_accepted',
      });
      this.activeAssignments.delete(orderId);
      this.eventEmitter.emit(
        'order.rider.assigned',
        new OrderRiderAssignedEvent(orderId, riderId),
      );

      return {
        message: 'Rider accepted assignment',
        data: { orderId, riderId, accepted: true },
      };
    }

    this.appendAssignmentLog({
      orderId,
      selectedRiderId: riderId,
      status: 'rejected',
      attemptNumber: assignment.currentIndex + 1,
      candidates: assignment.candidates.map((item) => item.score),
      weights: assignment.weights,
      reason: 'rider_rejected',
    });

    await this.escalateAssignment(orderId, 'rider_rejected');

    return {
      message: 'Rider rejected assignment and escalation started',
      data: { orderId, riderId, accepted: false },
    };
  }

  getDispatchStats() {
    const pending = this.assignmentLogs.filter(
      (log) => log.status === 'pending',
    ).length;
    const accepted = this.assignmentLogs.filter(
      (log) => log.status === 'accepted',
    ).length;
    const escalated = this.assignmentLogs.filter(
      (log) => log.status === 'escalated',
    ).length;
    const timeout = this.assignmentLogs.filter(
      (log) => log.status === 'timeout',
    ).length;
    const rejected = this.assignmentLogs.filter(
      (log) => log.status === 'rejected',
    ).length;

    return {
      message: 'Dispatch statistics retrieved successfully',
      data: {
        total: this.assignmentLogs.length,
        pending,
        accepted,
        escalated,
        timeout,
        rejected,
      },
    };
  }

  private resolveWeights(): AssignmentWeights {
    const distance = this.configService.get<number>(
      'ASSIGNMENT_DISTANCE_WEIGHT',
      0.5,
    );
    const workload = this.configService.get<number>(
      'ASSIGNMENT_WORKLOAD_WEIGHT',
      0.3,
    );
    const rating = this.configService.get<number>(
      'ASSIGNMENT_RATING_WEIGHT',
      0.2,
    );
    const total = distance + workload + rating;
    if (total <= 0) {
      return { distance: 0.5, workload: 0.3, rating: 0.2 };
    }
    return {
      distance: distance / total,
      workload: workload / total,
      rating: rating / total,
    };
  }

  private async acquireDedup(key: string): Promise<boolean> {
    try {
      const result = await this.redis.set(key, '1', 'EX', DEDUP_TTL_SECONDS, 'NX');
      return result === 'OK';
    } catch (err) {
      this.logger.error(`Dedup store error for key ${key}: ${(err as Error).message}`);
      return true; // allow processing on Redis failure
    }
  }

  private async startAutomatedAssignment(
    event: OrderConfirmedEvent,
  ): Promise<void> {
    const availableResponse = await this.ridersService.getAvailableRiders();
    const riders = availableResponse.data ?? [];

    if (riders.length === 0) {
      this.appendAssignmentLog({
        orderId: event.orderId,
        selectedRiderId: null,
        status: 'exhausted',
        attemptNumber: 0,
        candidates: [],
        weights: this.defaultWeights,
        reason: 'no_available_riders',
      });
      return;
    }

    const pickupPoint = event.deliveryAddress;
    const policyConfig = await this.getRuntimeAssignmentConfig();
    const scored = await this.scoreRiders(riders, pickupPoint, policyConfig.weights);
    const ranked = scored.sort(
      (a, b) => b.score.totalScore - a.score.totalScore,
    );

    const state: ActiveAssignmentState = {
      orderId: event.orderId,
      candidates: ranked,
      currentIndex: 0,
      timeoutMs: policyConfig.acceptanceTimeoutMs,
      weights: policyConfig.weights,
      timer: null,
    };
    this.activeAssignments.set(event.orderId, state);

    this.proposeCurrentCandidate(state, 'initial_assignment');
  }

  private async scoreRiders(
    riders: RiderRecord[],
    pickupPoint: string,
    weights: AssignmentWeights,
  ): Promise<Array<{ rider: RiderRecord; score: AssignmentCandidateScore }>> {
    const raw = await Promise.all(
      riders.map(async (rider) => {
        const origin =
          rider.latitude !== null && rider.longitude !== null
            ? `${rider.latitude},${rider.longitude}`
            : rider.name;
        const travelTimeSeconds = await this.mapsService.getTravelTimeSeconds(
          origin,
          pickupPoint,
        );
        return {
          rider,
          travelTimeSeconds,
          activeDeliveries: rider.activeDeliveries,
          averageRating: rider.averageRating,
        };
      }),
    );

    const durations = raw.map((item) => item.travelTimeSeconds);
    const workloads = raw.map((item) => item.activeDeliveries);
    const ratings = raw.map((item) => item.averageRating);

    const durationMin = Math.min(...durations);
    const durationMax = Math.max(...durations);
    const workloadMin = Math.min(...workloads);
    const workloadMax = Math.max(...workloads);
    const ratingMin = Math.min(...ratings);
    const ratingMax = Math.max(...ratings);

    return raw.map((item) => {
      const distanceScore = this.normalizeLowerIsBetter(
        item.travelTimeSeconds,
        durationMin,
        durationMax,
      );
      const workloadScore = this.normalizeLowerIsBetter(
        item.activeDeliveries,
        workloadMin,
        workloadMax,
      );
      const ratingScore = this.normalizeHigherIsBetter(
        item.averageRating,
        ratingMin,
        ratingMax,
      );

      const totalScore =
        distanceScore * weights.distance +
        workloadScore * weights.workload +
        ratingScore * weights.rating;

      return {
        rider: item.rider,
        score: {
          riderId: item.rider.id,
          travelTimeSeconds: item.travelTimeSeconds,
          activeDeliveries: item.activeDeliveries,
          averageRating: item.averageRating,
          distanceScore,
          workloadScore,
          ratingScore,
          totalScore,
        },
      };
    });
  }

  private normalizeLowerIsBetter(
    value: number,
    min: number,
    max: number,
  ): number {
    if (max === min) {
      return 1;
    }
    return 1 - (value - min) / (max - min);
  }

  private normalizeHigherIsBetter(
    value: number,
    min: number,
    max: number,
  ): number {
    if (max === min) {
      return 1;
    }
    return (value - min) / (max - min);
  }

  private proposeCurrentCandidate(
    assignment: ActiveAssignmentState,
    reason: AssignmentLogReason,
  ): void {
    const current = assignment.candidates[assignment.currentIndex];
    if (!current) {
      this.appendAssignmentLog({
        orderId: assignment.orderId,
        selectedRiderId: null,
        status: 'exhausted',
        attemptNumber: assignment.currentIndex,
        candidates: assignment.candidates.map((item) => item.score),
        weights: assignment.weights,
        reason: 'all_candidates_exhausted',
      });
      this.activeAssignments.delete(assignment.orderId);
      return;
    }

    this.appendAssignmentLog({
      orderId: assignment.orderId,
      selectedRiderId: current.rider.id,
      status: 'pending',
      attemptNumber: assignment.currentIndex + 1,
      candidates: assignment.candidates.map((item) => item.score),
      weights: assignment.weights,
      reason,
    });

    assignment.timer = setTimeout(() => {
      void this.escalateAssignment(assignment.orderId, 'timeout');
    }, assignment.timeoutMs);
    assignment.timer.unref?.();
  }

  private async escalateAssignment(
    orderId: string,
    reason: AssignmentLogReason,
  ): Promise<void> {
    const assignment = this.activeAssignments.get(orderId);
    if (!assignment) {
      return;
    }

    const current = assignment.candidates[assignment.currentIndex];
    if (!current) {
      this.activeAssignments.delete(orderId);
      return;
    }

    this.clearAssignmentTimer(assignment);
    this.appendAssignmentLog({
      orderId,
      selectedRiderId: current.rider.id,
      status: reason === 'timeout' ? 'timeout' : 'escalated',
      attemptNumber: assignment.currentIndex + 1,
      candidates: assignment.candidates.map((item) => item.score),
      weights: assignment.weights,
      reason,
    });

    assignment.currentIndex += 1;
    if (assignment.currentIndex >= assignment.candidates.length) {
      this.appendAssignmentLog({
        orderId,
        selectedRiderId: null,
        status: 'exhausted',
        attemptNumber: assignment.currentIndex,
        candidates: assignment.candidates.map((item) => item.score),
        weights: assignment.weights,
        reason: 'all_candidates_exhausted',
      });
      this.activeAssignments.delete(orderId);
      return;
    }

    this.proposeCurrentCandidate(assignment, 'escalated_next_candidate');
  }

  private clearAssignmentTimer(assignment: ActiveAssignmentState): void {
    if (assignment.timer) {
      clearTimeout(assignment.timer);
      assignment.timer = null;
    }
  }

  private appendAssignmentLog(
    log: Omit<AssignmentLog, 'id' | 'createdAt'>,
  ): void {
    this.assignmentLogs.push({
      id: `assignment-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      createdAt: new Date(),
      ...log,
    });
  }

  private async getRuntimeAssignmentConfig(): Promise<{
    acceptanceTimeoutMs: number;
    weights: AssignmentWeights;
  }> {
    try {
      const policy = await this.policyCenterService.getActivePolicySnapshot();
      const totalWeight =
        policy.rules.dispatch.distanceWeight +
        policy.rules.dispatch.workloadWeight +
        policy.rules.dispatch.ratingWeight;

      if (totalWeight <= 0) {
        return {
          acceptanceTimeoutMs: this.defaultAcceptanceTimeoutMs,
          weights: this.defaultWeights,
        };
      }

      return {
        acceptanceTimeoutMs: policy.rules.dispatch.acceptanceTimeoutMs,
        weights: {
          distance: policy.rules.dispatch.distanceWeight / totalWeight,
          workload: policy.rules.dispatch.workloadWeight / totalWeight,
          rating: policy.rules.dispatch.ratingWeight / totalWeight,
        },
      };
    } catch {
      return {
        acceptanceTimeoutMs: this.defaultAcceptanceTimeoutMs,
        weights: this.defaultWeights,
      };
    }
  }
}

interface AssignmentWeights {
  distance: number;
  workload: number;
  rating: number;
}

interface AssignmentCandidateScore {
  riderId: string;
  travelTimeSeconds: number;
  activeDeliveries: number;
  averageRating: number;
  distanceScore: number;
  workloadScore: number;
  ratingScore: number;
  totalScore: number;
}

type AssignmentLogStatus =
  | 'pending'
  | 'accepted'
  | 'rejected'
  | 'timeout'
  | 'escalated'
  | 'exhausted';

type AssignmentLogReason =
  | 'initial_assignment'
  | 'timeout'
  | 'rider_rejected'
  | 'rider_accepted'
  | 'escalated_next_candidate'
  | 'all_candidates_exhausted'
  | 'no_available_riders';

interface AssignmentLog {
  id: string;
  orderId: string;
  selectedRiderId: string | null;
  status: AssignmentLogStatus;
  reason: AssignmentLogReason;
  attemptNumber: number;
  candidates: AssignmentCandidateScore[];
  weights: AssignmentWeights;
  createdAt: Date;
}

interface ActiveAssignmentState {
  orderId: string;
  candidates: Array<{ rider: RiderRecord; score: AssignmentCandidateScore }>;
  currentIndex: number;
  timeoutMs: number;
  weights: AssignmentWeights;
  timer: NodeJS.Timeout | null;
}
