import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SorobanService } from '../soroban/soroban.service';
import { BloodUnitTrail } from '../soroban/entities/blood-unit-trail.entity';
import {
  RegisterBloodUnitDto,
  TransferCustodyDto,
  LogTemperatureDto,
} from './dto/blood-units.dto';

@Injectable()
export class BloodUnitsService {
  constructor(
    private sorobanService: SorobanService,
    @InjectRepository(BloodUnitTrail)
    private trailRepository: Repository<BloodUnitTrail>,
  ) {}

  async registerBloodUnit(dto: RegisterBloodUnitDto) {
    const result = await this.sorobanService.registerBloodUnit({
      unitId: dto.unitId,
      bloodType: dto.bloodType,
      donorId: dto.donorId,
      bankId: dto.bankId,
    });

    return {
      success: true,
      unitId: result.unitId,
      transactionHash: result.transactionHash,
      message: 'Blood unit registered successfully',
    };
  }

  async transferCustody(dto: TransferCustodyDto) {
    const result = await this.sorobanService.transferCustody({
      unitId: dto.unitId,
      fromAccount: dto.fromAccount,
      toAccount: dto.toAccount,
      condition: dto.condition,
    });

    return {
      success: true,
      transactionHash: result.transactionHash,
      message: 'Custody transferred successfully',
    };
  }

  async logTemperature(dto: LogTemperatureDto) {
    const result = await this.sorobanService.logTemperature({
      unitId: dto.unitId,
      temperature: dto.temperature,
      timestamp: dto.timestamp || Math.floor(Date.now() / 1000),
    });

    return {
      success: true,
      transactionHash: result.transactionHash,
      message: 'Temperature logged successfully',
    };
  }

  async getUnitTrail(unitId: number) {
    // Try to get from database first (cached)
    const cachedTrail = await this.trailRepository.findOne({
      where: { unitId },
    });

    if (cachedTrail) {
      return {
        unitId,
        custodyTrail: cachedTrail.custodyTrail,
        temperatureLogs: cachedTrail.temperatureLogs,
        statusHistory: cachedTrail.statusHistory,
        lastUpdated: cachedTrail.lastSyncedAt,
        source: 'cache',
      };
    }

    // If not in cache, fetch from blockchain
    try {
      const trail = await this.sorobanService.getUnitTrail(unitId);
      
      return {
        unitId,
        ...trail,
        lastUpdated: new Date(),
        source: 'blockchain',
      };
    } catch (error) {
      throw new NotFoundException(`Blood unit ${unitId} not found`);
    }
  }
}
