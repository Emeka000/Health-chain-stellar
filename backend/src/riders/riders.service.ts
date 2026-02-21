import { Injectable, NotFoundException } from '@nestjs/common';

export type RiderStatus = 'available' | 'busy' | 'offline';

export interface RiderRecord {
  id: string;
  name: string;
  status: RiderStatus;
  latitude: number | null;
  longitude: number | null;
  activeDeliveries: number;
  averageRating: number;
  createdAt: Date;
  updatedAt: Date;
}

@Injectable()
export class RidersService {
  private readonly riders = new Map<string, RiderRecord>();

  async findAll(status?: string) {
    const data = Array.from(this.riders.values()).filter(
      (rider) => !status || rider.status === status,
    );
    return {
      message: 'Riders retrieved successfully',
      data,
    };
  }

  async findOne(id: string) {
    const rider = this.riders.get(id);
    if (!rider) {
      throw new NotFoundException(`Rider '${id}' not found`);
    }
    return {
      message: 'Rider retrieved successfully',
      data: rider,
    };
  }

  async create(createRiderDto: any) {
    const now = new Date();
    const id = createRiderDto.id ?? `rider-${Date.now()}`;
    const rider: RiderRecord = {
      id,
      name: createRiderDto.name ?? id,
      status: (createRiderDto.status ?? 'available') as RiderStatus,
      latitude: createRiderDto.latitude ?? null,
      longitude: createRiderDto.longitude ?? null,
      activeDeliveries: Number(createRiderDto.activeDeliveries ?? 0),
      averageRating: Number(createRiderDto.averageRating ?? 5),
      createdAt: now,
      updatedAt: now,
    };
    this.riders.set(id, rider);
    return {
      message: 'Rider created successfully',
      data: rider,
    };
  }

  async update(id: string, updateRiderDto: any) {
    const existing = this.riders.get(id);
    if (!existing) {
      throw new NotFoundException(`Rider '${id}' not found`);
    }
    const updated: RiderRecord = {
      ...existing,
      ...updateRiderDto,
      averageRating:
        updateRiderDto.averageRating !== undefined
          ? Number(updateRiderDto.averageRating)
          : existing.averageRating,
      activeDeliveries:
        updateRiderDto.activeDeliveries !== undefined
          ? Number(updateRiderDto.activeDeliveries)
          : existing.activeDeliveries,
      updatedAt: new Date(),
    };
    this.riders.set(id, updated);
    return {
      message: 'Rider updated successfully',
      data: updated,
    };
  }

  async remove(id: string) {
    if (!this.riders.has(id)) {
      throw new NotFoundException(`Rider '${id}' not found`);
    }
    this.riders.delete(id);
    return {
      message: 'Rider deleted successfully',
      data: { id },
    };
  }

  async updateStatus(id: string, status: string) {
    const rider = this.riders.get(id);
    if (!rider) {
      throw new NotFoundException(`Rider '${id}' not found`);
    }
    rider.status = status as RiderStatus;
    rider.updatedAt = new Date();
    this.riders.set(id, rider);
    return {
      message: 'Rider status updated successfully',
      data: rider,
    };
  }

  async updateLocation(id: string, latitude: number, longitude: number) {
    const rider = this.riders.get(id);
    if (!rider) {
      throw new NotFoundException(`Rider '${id}' not found`);
    }
    rider.latitude = latitude;
    rider.longitude = longitude;
    rider.updatedAt = new Date();
    this.riders.set(id, rider);
    return {
      message: 'Rider location updated successfully',
      data: rider,
    };
  }

  async getAvailableRiders() {
    const data = Array.from(this.riders.values()).filter(
      (rider) => rider.status === 'available',
    );
    return {
      message: 'Available riders retrieved successfully',
      data,
    };
  }

  async getNearbyRiders(latitude: number, longitude: number, radius: number) {
    const radiusKm = Number(radius);
    const data = Array.from(this.riders.values()).filter((rider) => {
      if (rider.latitude === null || rider.longitude === null) {
        return false;
      }
      const latKm = Math.abs(rider.latitude - latitude) * 111;
      const lngKm =
        Math.abs(rider.longitude - longitude) *
        111 *
        Math.cos((latitude * Math.PI) / 180);
      return Math.sqrt(latKm ** 2 + lngKm ** 2) <= radiusKm;
    });
    return {
      message: 'Nearby riders retrieved successfully',
      data,
    };
  }
}
