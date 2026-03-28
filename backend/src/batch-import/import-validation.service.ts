import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { OrganizationEntity } from '../../organizations/entities/organization.entity';
import { BloodType } from '../../blood-units/enums/blood-type.enum';
import { VehicleType } from '../../riders/enums/vehicle-type.enum';
import { OrganizationType } from '../../organizations/enums/organization-type.enum';

const VALID_BLOOD_TYPES = new Set<string>(Object.values(BloodType));
const VALID_VEHICLE_TYPES = new Set<string>(Object.values(VehicleType));
const VALID_ORG_TYPES = new Set<string>(Object.values(OrganizationType));

@Injectable()
export class ImportValidationService {
  constructor(
    @InjectRepository(OrganizationEntity)
    private readonly orgRepo: Repository<OrganizationEntity>,
  ) {}

  async validateOrganizationRow(
    row: Record<string, unknown>,
    existingNames: Set<string>,
  ): Promise<string[]> {
    const errors: string[] = [];

    if (!row['name'] || typeof row['name'] !== 'string') {
      errors.push('name is required');
    } else {
      const name = (row['name'] as string).trim().toLowerCase();
      // Duplicate within batch
      if (existingNames.has(name)) {
        errors.push(`Duplicate organization name "${row['name']}" in import`);
      }
      // Duplicate in DB
      const dbMatch = await this.orgRepo.findOne({
        where: { name: row['name'] as string },
      });
      if (dbMatch) errors.push(`Organization "${row['name']}" already exists`);
      existingNames.add(name);
    }

    if (row['type'] && !VALID_ORG_TYPES.has(row['type'] as string)) {
      errors.push(`Invalid type "${row['type']}". Must be one of: ${[...VALID_ORG_TYPES].join(', ')}`);
    }

    this.validateGeo(row, errors);

    if (row['email'] && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(row['email'] as string)) {
      errors.push('Invalid email format');
    }

    return errors;
  }

  validateRiderRow(
    row: Record<string, unknown>,
    existingLicenses: Set<string>,
  ): string[] {
    const errors: string[] = [];

    if (!row['vehicleNumber']) errors.push('vehicleNumber is required');
    if (!row['licenseNumber']) {
      errors.push('licenseNumber is required');
    } else {
      const lic = (row['licenseNumber'] as string).trim().toLowerCase();
      if (existingLicenses.has(lic)) {
        errors.push(`Duplicate licenseNumber "${row['licenseNumber']}" in import`);
      }
      existingLicenses.add(lic);
    }

    if (!row['vehicleType'] || !VALID_VEHICLE_TYPES.has(row['vehicleType'] as string)) {
      errors.push(`Invalid vehicleType. Must be one of: ${[...VALID_VEHICLE_TYPES].join(', ')}`);
    }

    this.validateGeo(row, errors);
    return errors;
  }

  validateInventoryRow(row: Record<string, unknown>): string[] {
    const errors: string[] = [];

    if (!row['bloodType'] || !VALID_BLOOD_TYPES.has(row['bloodType'] as string)) {
      errors.push(`Invalid bloodType. Must be one of: ${[...VALID_BLOOD_TYPES].join(', ')}`);
    }

    if (!row['region'] || typeof row['region'] !== 'string') {
      errors.push('region is required');
    }

    const qty = Number(row['quantity']);
    if (isNaN(qty) || qty < 0) {
      errors.push('quantity must be a non-negative number');
    } else if (qty > 100_000) {
      errors.push(`quantity ${qty} is anomalously high (> 100,000 units)`);
    }

    return errors;
  }

  private validateGeo(row: Record<string, unknown>, errors: string[]): void {
    if (row['latitude'] !== undefined && row['latitude'] !== '') {
      const lat = Number(row['latitude']);
      if (isNaN(lat) || lat < -90 || lat > 90) {
        errors.push(`Invalid latitude "${row['latitude']}"`);
      }
    }
    if (row['longitude'] !== undefined && row['longitude'] !== '') {
      const lng = Number(row['longitude']);
      if (isNaN(lng) || lng < -180 || lng > 180) {
        errors.push(`Invalid longitude "${row['longitude']}"`);
      }
    }
  }
}
