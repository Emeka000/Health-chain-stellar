import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, InternalServerErrorException, NotFoundException, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { Queue } from 'bullmq';
import * as Handlebars from 'handlebars';
import { Repository } from 'typeorm';

import { NotificationQueryDto } from './dto/notification-query.dto';
import { SendNotificationDto } from './dto/send-notification.dto';
import { NotificationTemplateEntity } from './entities/notification-template.entity';
import { NotificationEntity } from './entities/notification.entity';
import { NotificationStatus } from './enums/notification-status.enum';
import { NotificationJobData } from './processors/notification.processor';

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    @InjectRepository(NotificationEntity)
    private readonly notificationRepo: Repository<NotificationEntity>,
    @InjectRepository(NotificationTemplateEntity)
    private readonly templateRepo: Repository<NotificationTemplateEntity>,
    @InjectQueue('notifications') private readonly notificationsQueue: Queue,
  ) {}

  async send(dto: SendNotificationDto): Promise<NotificationEntity[]> {
    const { recipientId, channels, templateKey, variables } = dto;

    const results: NotificationEntity[] = [];

    for (const channel of channels) {
      // 1. Load template
      const template = await this.templateRepo.findOne({
        where: { templateKey, channel },
      });

      if (!template) {
        throw new NotFoundException(
          `Template '${templateKey}' for channel '${channel}' not found`,
        );
      }

      // 2. Render body
      let renderedBody = template.body;
      try {
        const delegate = Handlebars.compile(template.body);
        renderedBody = delegate(variables || {});
      } catch (err) {
        this.logger.error(
          `Template compilation failed for key ${templateKey}`,
          err,
        );
        throw new InternalServerErrorException('Template compilation failed');
      }

      // 3. Create Notification DB entry
      const notification = this.notificationRepo.create({
        recipientId,
        channel,
        templateKey,
        variables,
        renderedBody,
        status: NotificationStatus.PENDING,
      });

      const saved = await this.notificationRepo.save(notification);
      results.push(saved);

      // 4. Enqueue Job
      const jobData: NotificationJobData = {
        notificationId: saved.id,
        recipientId,
        channel,
        renderedBody,
        templateKey,
        variables,
      };

      await this.notificationsQueue.add('sendNotification', jobData, {
        attempts: 5,
        backoff: {
          type: 'exponential',
          delay: 2000,
        },
      });
    }

    return results;
  }

  async findForRecipient(query: NotificationQueryDto) {
    const page = query.page || 1;
    const limit = query.limit || 10;
    const skip = (page - 1) * limit;

    const whereClause: any = {};
    if (query.recipientId) {
      whereClause.recipientId = query.recipientId;
    }

    const [items, total] = await this.notificationRepo.findAndCount({
      where: whereClause,
      order: { createdAt: 'DESC' },
      skip,
      take: limit,
    });

    return {
      data: items,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async markRead(id: string) {
    const notification = await this.notificationRepo.findOne({ where: { id } });
    if (!notification) {
      throw new NotFoundException(`Notification '${id}' not found`);
    }

    notification.status = NotificationStatus.READ;
    const updated = await this.notificationRepo.save(notification);

    return { message: 'Notification marked as read', data: updated };
  }
}
