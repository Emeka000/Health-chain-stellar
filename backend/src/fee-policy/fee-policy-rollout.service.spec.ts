import { Test, TestingModule } from '@nestjs/testing';
import { FeePolicyRolloutService } from '../fee-policy-rollout.service';
import { FeePolicyEntity } from '../entities/fee-policy.entity';

describe('FeePolicyRolloutService', () => {
  let service: FeePolicyRolloutService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [FeePolicyRolloutService],
    }).compile();

    service = module.get<FeePolicyRolloutService>(FeePolicyRolloutService);
  });

  describe('shouldUseCanaryPolicy', () => {
    it('should return true for users within rollout percentage', () => {
      const userId = 'user-123';
      const rolloutPercentage = 50;

      // Mock consistent hash to return value within percentage
      jest.spyOn(service as any, 'getUserHash').mockReturnValue(25);

      const result = service.shouldUseCanaryPolicy(userId, rolloutPercentage);
      expect(result).toBe(true);
    });

    it('should return false for users outside rollout percentage', () => {
      const userId = 'user-456';
      const rolloutPercentage = 30;

      // Mock consistent hash to return value outside percentage
      jest.spyOn(service as any, 'getUserHash').mockReturnValue(75);

      const result = service.shouldUseCanaryPolicy(userId, rolloutPercentage);
      expect(result).toBe(false);
    });
  });

  describe('startCanaryDeployment', () => {
    it('should initialize deployment with correct parameters', () => {
      const policy: FeePolicyEntity = {
        id: 'policy-1',
        name: 'Test Policy',
      } as FeePolicyEntity;

      const rolloutPercentage = 25;

      const deployment = service.startCanaryDeployment(policy, rolloutPercentage);

      expect(deployment.policyId).toBe('policy-1');
      expect(deployment.rolloutPercentage).toBe(25);
      expect(deployment.status).toBe('active');
      expect(deployment.metrics).toBeDefined();
    });
  });

  describe('getDeploymentMetrics', () => {
    it('should return current deployment metrics', () => {
      const deploymentId = 'deploy-1';

      // Mock active deployments
      (service as any).activeDeployments.set(deploymentId, {
        policyId: 'policy-1',
        rolloutPercentage: 50,
        metrics: {
          totalRequests: 100,
          canaryRequests: 45,
          errors: 2,
          avgResponseTime: 150,
        },
      });

      const metrics = service.getDeploymentMetrics(deploymentId);

      expect(metrics.totalRequests).toBe(100);
      expect(metrics.canaryRequests).toBe(45);
      expect(metrics.errorRate).toBe(0.02);
    });
  });

  describe('stopCanaryDeployment', () => {
    it('should mark deployment as completed', () => {
      const deploymentId = 'deploy-1';

      // Mock active deployment
      (service as any).activeDeployments.set(deploymentId, {
        policyId: 'policy-1',
        status: 'active',
      });

      service.stopCanaryDeployment(deploymentId);

      const deployment = (service as any).activeDeployments.get(deploymentId);
      expect(deployment.status).toBe('completed');
    });
  });
});