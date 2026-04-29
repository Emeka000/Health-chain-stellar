import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { EventSchemaRegistryService } from './event-schema-registry.service';
import { COMMON_EVENT_SCHEMAS } from './schemas/common-event-schemas';

/**
 * Event System Initializer
 * 
 * Registers all event schemas on application startup
 */
@Injectable()
export class EventSystemInitializerService implements OnModuleInit {
    private readonly logger = new Logger(EventSystemInitializerService.name);

    constructor(
        private readonly schemaRegistry: EventSchemaRegistryService,
    ) { }

    async onModuleInit(): Promise<void> {
        this.logger.log('Initializing event system...');

        // Register common event schemas
        this.schemaRegistry.registerSchemas(COMMON_EVENT_SCHEMAS);

        this.logger.log(
            `Event system initialized with ${COMMON_EVENT_SCHEMAS.length} schemas`,
        );
    }
}
