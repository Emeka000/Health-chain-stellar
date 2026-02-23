export interface TemperatureThreshold {
  blood_type: string;
  min_celsius_x100: number;
  max_celsius_x100: number;
}

export enum ContractError {
  InvalidThreshold = 'InvalidThreshold',
}

export type GuardResult = { ok: true } | { ok: false; error: ContractError };

const VALID_BLOOD_TYPES = new Set([
  'A+',
  'A-',
  'B+',
  'B-',
  'AB+',
  'AB-',
  'O+',
  'O-',
]);

const WHO_DEFAULT_MIN_CELSIUS_X100 = 200;
const WHO_DEFAULT_MAX_CELSIUS_X100 = 600;

export function validate_threshold(threshold: TemperatureThreshold): GuardResult {
  if (!VALID_BLOOD_TYPES.has(threshold.blood_type)) {
    return { ok: false, error: ContractError.InvalidThreshold };
  }

  if (threshold.min_celsius_x100 >= threshold.max_celsius_x100) {
    return { ok: false, error: ContractError.InvalidThreshold };
  }

  if (threshold.min_celsius_x100 < -5000) {
    return { ok: false, error: ContractError.InvalidThreshold };
  }

  if (threshold.max_celsius_x100 > 4000) {
    return { ok: false, error: ContractError.InvalidThreshold };
  }

  return { ok: true };
}

export function get_threshold_or_default(
  thresholds: Map<string, TemperatureThreshold>,
  blood_type: string,
): TemperatureThreshold {
  return (
    thresholds.get(blood_type) ?? {
      blood_type,
      min_celsius_x100: WHO_DEFAULT_MIN_CELSIUS_X100,
      max_celsius_x100: WHO_DEFAULT_MAX_CELSIUS_X100,
    }
  );
}
