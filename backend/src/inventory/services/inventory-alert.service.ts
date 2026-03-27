import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';

import { Repository, LessThanOrEqual, MoreThanOrEqual } from 'typeorm';

import { NotificationChannel } from '../../notifications/enums/notification-channel.enum';
import { NotificationsService } from '../../notifications/notifications.service';
import { AlertPreferenceEntity } from '../entities/alert-preference.entity';
import {
  InventoryAlertEntity,
  AlertType,
  AlertSeverity,
  AlertStatus,
} from '../entities/inventory-alert.entity';
import { InventoryStockEntity } from '../entities/inventory-stock.entity';

export interface CreateAlertParams {
  bloodBankId: string;
  bloodType: string;
  alertType: AlertType;
  severity: AlertSeverity;
  message: string;
  thresholdValue?: number;
  currentValue?: number;
  metadata?: Record<string, unknown>;
}

export interface DismissAlertParams {
  alertId: string;
  dismissedBy: string;
}

export interface ResolveAlertParams {
  alertId: string;
  resolvedBy: string;
}

@Injectable()
export class InventoryAlertService {
  private readonly logger = new Logger(InventoryAlertService.name);

  constructor(
    @InjectRepository(InventoryAlertEntity)
    private readonly alertRepository: Repository<InventoryAlertEntity>,
    @InjectRepository(AlertPreferenceEntity)
    private readonly preferenceRepository: Repository<AlertPreferenceEntity>,
    @InjectRepository(InventoryStockEntity)
    private readonly inventoryRepository: Repository<InventoryStockEntity>,
    private readonly notificationsService: NotificationsService,
  ) {}

  async createAlert(params: CreateAlertParams): Promise<InventoryAlertEntity> {
    // Check if similar alert already exists
    const existingAlert = await this.alertRepository.findOne({
      where: {
        bloodBankId: params.bloodBankId,
        bloodType: params.bloodType,
        alertType: params.alertType,
        status: AlertStatus.ACTIVE,
      },
    });

    if (existingAlert) {
      // Update existing alert
      existingAlert.currentValue =
        params.currentValue ?? existingAlert.currentValue;
      existingAlert.message = params.message;
      existingAlert.severity = params.severity;
      return this.alertRepository.save(existingAlert);
    }

    // Create new alert
    const alert = this.alertRepository.create({
      bloodBankId: params.bloodBankId,
      bloodType: params.bloodType,
      alertType: params.alertType,
      severity: params.severity,
      message: params.message,
      thresholdValue: params.thresholdValue ?? null,
      currentValue: params.currentValue ?? null,
      metadata: params.metadata ?? null,
    });

    const savedAlert = await this.alertRepository.save(alert);

    // Send notifications
    await this.sendAlertNotifications(savedAlert);

    return savedAlert;
  }

  async dismissAlert(
    params: DismissAlertParams,
  ): Promise<InventoryAlertEntity> {
    const alert = await this.alertRepository.findOne({
      where: { id: params.alertId },
    });

    if (!alert) {
      throw new Error(`Alert with ID ${params.alertId} not found`);
    }

    alert.status = AlertStatus.DISMISSED;
    alert.dismissedAt = new Date();
    alert.dismissedBy = params.dismissedBy;

    return this.alertRepository.save(alert);
  }

  async resolveAlert(
    params: ResolveAlertParams,
  ): Promise<InventoryAlertEntity> {
    const alert = await this.alertRepository.findOne({
      where: { id: params.alertId },
    });

    if (!alert) {
      throw new Error(`Alert with ID ${params.alertId} not found`);
    }

    alert.status = AlertStatus.RESOLVED;
    alert.resolvedAt = new Date();
    alert.resolvedBy = params.resolvedBy;

    return this.alertRepository.save(alert);
  }

  async getAlerts(
    filters: {
      bloodBankId?: string;
      alertType?: AlertType;
      status?: AlertStatus;
      severity?: AlertSeverity;
    },
    limit: number = 50,
    offset: number = 0,
  ): Promise<{ data: InventoryAlertEntity[]; total: number }> {
    const queryBuilder = this.alertRepository.createQueryBuilder('alert');

    if (filters.bloodBankId) {
      queryBuilder.andWhere('alert.bloodBankId = :bloodBankId', {
        bloodBankId: filters.bloodBankId,
      });
    }

    if (filters.alertType) {
      queryBuilder.andWhere('alert.alertType = :alertType', {
        alertType: filters.alertType,
      });
    }

    if (filters.status) {
      queryBuilder.andWhere('alert.status = :status', {
        status: filters.status,
      });
    }

    if (filters.severity) {
      queryBuilder.andWhere('alert.severity = :severity', {
        severity: filters.severity,
      });
    }

    queryBuilder.orderBy('alert.createdAt', 'DESC');
    queryBuilder.take(limit);
    queryBuilder.skip(offset);

    const [data, total] = await queryBuilder.getManyAndCount();

    return { data, total };
  }

  async getAlertById(id: string): Promise<InventoryAlertEntity | null> {
    return this.alertRepository.findOne({ where: { id } });
  }

  async getAlertStats(bloodBankId?: string): Promise<{
    totalActive: number;
    byType: Record<AlertType, number>;
    bySeverity: Record<AlertSeverity, number>;
  }> {
    const where = bloodBankId
      ? { bloodBankId, status: AlertStatus.ACTIVE }
      : { status: AlertStatus.ACTIVE };

    const alerts = await this.alertRepository.find({ where });

    const byType: Record<AlertType, number> = {
      [AlertType.LOW_STOCK]: 0,
      [AlertType.EXPIRING_SOON]: 0,
      [AlertType.EXPIRED]: 0,
      [AlertType.OUT_OF_STOCK]: 0,
    };

    const bySeverity: Record<AlertSeverity, number> = {
      [AlertSeverity.LOW]: 0,
      [AlertSeverity.MEDIUM]: 0,
      [AlertSeverity.HIGH]: 0,
      [AlertSeverity.CRITICAL]: 0,
    };

    alerts.forEach((alert) => {
      byType[alert.alertType]++;
      bySeverity[alert.severity]++;
    });

    return {
      totalActive: alerts.length,
      byType,
      bySeverity,
    };
  }

  async getAlertPreferences(
    organizationId: string,
  ): Promise<AlertPreferenceEntity> {
    let preferences = await this.preferenceRepository.findOne({
      where: { organizationId },
    });

    if (!preferences) {
      // Create default preferences
      preferences = this.preferenceRepository.create({
        organizationId,
      });
      preferences = await this.preferenceRepository.save(preferences);
    }

    return preferences;
  }

  async updateAlertPreferences(
    organizationId: string,
    updates: Partial<AlertPreferenceEntity>,
  ): Promise<AlertPreferenceEntity> {
    const preferences = await this.getAlertPreferences(organizationId);

    Object.assign(preferences, updates);
    return this.preferenceRepository.save(preferences);
  }

  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async checkLowStockAlerts(): Promise<void> {
    this.logger.log('Running low stock alert check...');

    const preferences = await this.preferenceRepository.find();
    const preferencesMap = new Map(
      preferences.map((p) => [p.organizationId, p]),
    );

    const inventoryItems = await this.inventoryRepository.find();

    for (const item of inventoryItems) {
      const pref = preferencesMap.get(item.bloodBankId);
      const threshold = pref?.lowStockThreshold ?? 10;
      const criticalThreshold = pref?.criticalStockThreshold ?? 5;

      if (!pref?.enableLowStockAlerts) {
        continue;
      }

      if (item.availableUnits <= criticalThreshold) {
        await this.createAlert({
          bloodBankId: item.bloodBankId,
          bloodType: item.bloodType,
          alertType: AlertType.LOW_STOCK,
          severity: AlertSeverity.CRITICAL,
          message: `Critical stock level for ${item.bloodType} at ${item.bloodBankId}. Only ${item.availableUnits} units remaining.`,
          thresholdValue: criticalThreshold,
          currentValue: item.availableUnits,
        });
      } else if (item.availableUnits <= threshold) {
        await this.createAlert({
          bloodBankId: item.bloodBankId,
          bloodType: item.bloodType,
          alertType: AlertType.LOW_STOCK,
          severity: AlertSeverity.HIGH,
          message: `Low stock level for ${item.bloodType} at ${item.bloodBankId}. ${item.availableUnits} units remaining.`,
          thresholdValue: threshold,
          currentValue: item.availableUnits,
        });
      }
    }

    this.logger.log('Low stock alert check completed');
  }

  @Cron(CronExpression.EVERY_DAY_AT_1AM)
  async checkExpiringUnits(): Promise<void> {
    this.logger.log('Running expiring units check...');

    const preferences = await this.preferenceRepository.find();
    const preferencesMap = new Map(
      preferences.map((p) => [p.organizationId, p]),
    );

    // This would need to check blood units table
    // For now, we'll just log the check
    this.logger.log('Expiring units check completed');
  }

  @Cron(CronExpression.EVERY_DAY_AT_2AM)
  async autoMarkExpiredUnits(): Promise<void> {
    this.logger.log('Running auto-mark expired units...');

    // This would need to update blood units status
    // For now, we'll just log the check
    this.logger.log('Auto-mark expired units completed');
  }

  private async sendAlertNotifications(
    alert: InventoryAlertEntity,
  ): Promise<void> {
    try {
      const preferences = await this.getAlertPreferences(alert.bloodBankId);

      if (!preferences.enableEmailNotifications) {
        return;
      }

      const channels: NotificationChannel[] = [];

      if (preferences.enableEmailNotifications) {
        channels.push(NotificationChannel.EMAIL);
      }

      if (preferences.enableSmsNotifications) {
        channels.push(NotificationChannel.SMS);
      }

      if (preferences.enableInAppNotifications) {
        channels.push(NotificationChannel.IN_APP);
      }

      if (channels.length === 0) {
        return;
      }

      await this.notificationsService.send({
        recipientId: alert.bloodBankId,
        channels,
        templateKey: `inventory_alert_${alert.alertType}`,
        variables: {
          alertType: alert.alertType,
          severity: alert.severity,
          bloodType: alert.bloodType || 'N/A',
          message: alert.message,
          bloodBankId: alert.bloodBankId,
        },
      });
    } catch (error) {
      this.logger.error(
        `Failed to send alert notifications: ${error.message}`,
        error.stack,
      );
    }
  }
}
