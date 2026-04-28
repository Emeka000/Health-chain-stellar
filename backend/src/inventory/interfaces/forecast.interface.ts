export interface ForecastThreshold {
  bloodType: string;
  region: string;
  daysThreshold: number;
}

export interface ForecastSeasonality {
  bloodType: string;
  region: string;
  seasonLength: number;
  alpha?: number;
  beta?: number;
  gamma?: number;
}

export interface DemandForecast {
  bloodType: string;
  region: string;
  currentStock: number;
  averageDailyDemand: number;
  projectedDaysOfSupply: number;
  forecastedDemand: number;
  seasonLength: number;
  sampleSize: number;
}
