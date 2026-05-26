import { NestFactory } from '@nestjs/core';
import { DataSource } from 'typeorm';
import * as QRCode from 'qrcode';

import { AppModule } from '../app.module';

import { UserRole } from '../auth/enums/user-role.enum';
import { hashPassword } from '../auth/utils/password.util';
import { UserEntity } from '../users/entities/user.entity';
import { BloodUnitEntity } from '../blood-units/entities/blood-unit.entity';
import { BloodType } from '../blood-units/enums/blood-type.enum';
import { OrganizationEntity } from '../organizations/entities/organization.entity';
import { OrganizationType } from '../organizations/enums/organization-type.enum';
import { OrganizationVerificationStatus } from '../organizations/enums/organization-verification-status.enum';
import { VerificationStatus } from '../organizations/enums/verification-status.enum';

async function generateBarcode(payload: Record<string, unknown>) {
  return QRCode.toDataURL(JSON.stringify(payload), {
    margin: 1,
    width: 320,
  });
}

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const dataSource = app.get(DataSource);

  console.log('Seeding database...');

  // 1. Clear existing data (optional, but good for determinism in local dev)
  // Disable foreign key checks for clearing
  try {
    await dataSource.query('TRUNCATE TABLE "users" CASCADE');
    await dataSource.query('TRUNCATE TABLE "organizations" CASCADE');
    await dataSource.query('TRUNCATE TABLE "blood_units" CASCADE');
  } catch (error) {
    console.warn('Unable to truncate tables, likely they do not exist yet. Syncing database schema...');
    // If tables don't exist, synchronize will create them (as synchronize: true is set in development)
  }

  // 2. Seed Organizations
  const organizationsRepository = dataSource.getRepository(OrganizationEntity);
  const orgs = await organizationsRepository.save([
    {
      name: 'City Central Hospital',
      legalName: 'Metropolis Health Services',
      type: OrganizationType.HOSPITAL,
      status: OrganizationVerificationStatus.APPROVED,
      verificationStatus: VerificationStatus.VERIFIED,
      email: 'contact@citycentral.hospital',
      phone: '+1234567890',
      address: '101 Medical Dr, Metropolis',
      city: 'Metropolis',
      country: 'HealthLand',
      registrationNumber: 'HOSP-001',
      licenseNumber: 'LIC-H001',
      isActive: true,
      latitude: 40.7128,
      longitude: -74.006,
    },
    {
      name: 'Universal Blood Bank',
      legalName: 'National Blood Supply System',
      type: OrganizationType.BLOOD_BANK,
      status: OrganizationVerificationStatus.APPROVED,
      verificationStatus: VerificationStatus.VERIFIED,
      email: 'info@universalblood.bank',
      phone: '+1234567891',
      address: '202 Plasma Ave, Metropolis',
      city: 'Metropolis',
      country: 'HealthLand',
      registrationNumber: 'BB-001',
      licenseNumber: 'LIC-BB001',
      isActive: true,
      latitude: 40.713,
      longitude: -74.007,
    },
  ]);

  const hospital = orgs[0];
  const bloodBank = orgs[1];

  console.log('Organizations seeded.');

  // 3. Seed Users
  const usersRepository = dataSource.getRepository(UserEntity);
  const hashedPassword = await hashPassword('password123');
  const seededUsers = await usersRepository.save([
    {
      email: 'admin@healthchain.com',
      name: 'System Admin',
      firstName: 'Admin',
      lastName: 'User',
      role: UserRole.ADMIN,
      roles: [UserRole.ADMIN],
      passwordHash: hashedPassword,
      isActive: true,
    },
    {
      email: 'hospital@healthchain.com',
      name: 'Hospital Admin',
      firstName: 'John',
      lastName: 'Doe',
      role: UserRole.HOSPITAL,
      roles: [UserRole.HOSPITAL],
      passwordHash: hashedPassword,
      isActive: true,
      organizationId: hospital.id,
    },
    {
      email: 'bank@healthchain.com',
      name: 'Blood Bank Clerk',
      firstName: 'Jane',
      lastName: 'Smith',
      role: UserRole.HOSPITAL, 
      roles: [UserRole.HOSPITAL],
      passwordHash: hashedPassword,
      isActive: true,
      organizationId: bloodBank.id,
    },
    {
      email: 'rider@healthchain.com',
      name: 'Emergency Rider',
      firstName: 'Fast',
      lastName: 'Rider',
      role: UserRole.RIDER,
      roles: [UserRole.RIDER],
      passwordHash: hashedPassword,
      isActive: true,
    },
    {
      email: 'donor@healthchain.com',
      name: 'Global Donor',
      firstName: 'Alice',
      lastName: 'Donor',
      role: UserRole.DONOR,
      roles: [UserRole.DONOR],
      passwordHash: hashedPassword,
      isActive: true,
      profile: {
        bloodType: 'O+',
        age: 28,
      },
    },
  ]);

  const bankUser = seededUsers[2];

  console.log('Users seeded.');

  // 4. Seed Blood Units
  const bloodUnitRepository = dataSource.getRepository(BloodUnitEntity);
  const futureDate = new Date();
  futureDate.setMonth(futureDate.getMonth() + 1);

  const unitsData = [
    { type: BloodType.O_POSITIVE, ml: 450, code: 'O-POS-882211', unitId: 101 },
    { type: BloodType.O_NEGATIVE, ml: 500, code: 'O-NEG-882212', unitId: 102 },
    { type: BloodType.A_POSITIVE, ml: 450, code: 'A-POS-882213', unitId: 103 },
    { type: BloodType.B_NEGATIVE, ml: 450, code: 'B-NEG-882214', unitId: 104 },
  ];

  for (const item of unitsData) {
    const payload = {
      unitNumber: item.code,
      bloodType: item.type,
      quantityMl: item.ml,
      bankId: bloodBank.id,
      expirationDate: futureDate,
      blockchainUnitId: item.unitId,
      blockchainTransactionHash: '0x' + Math.random().toString(16).slice(2, 66),
    };

    const barcodeData = await generateBarcode({
        ...payload,
        unitId: item.unitId,
        transactionHash: payload.blockchainTransactionHash
    });

    await bloodUnitRepository.save({
      ...payload,
      barcodeData,
      registeredBy: bankUser.id,
    });
  }

  console.log('Blood units seeded.');

  console.log('Seeding completed successfully.');
  await app.close();
}

bootstrap().catch((error) => {
  console.error('Seeding failed:', error);
  process.exit(1);
});
