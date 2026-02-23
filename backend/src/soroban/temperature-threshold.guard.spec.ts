import {
  ContractError,
  TemperatureThreshold,
  get_threshold_or_default,
  validate_threshold,
} from './temperature-threshold.guard';

describe('temperature-threshold.guard', () => {
  const baseThreshold: TemperatureThreshold = {
    blood_type: 'A+',
    min_celsius_x100: 200,
    max_celsius_x100: 600,
  };

  it('returns ok for a valid threshold', () => {
    expect(validate_threshold(baseThreshold)).toEqual({ ok: true });
  });

  it('returns InvalidThreshold when min >= max', () => {
    const threshold: TemperatureThreshold = {
      ...baseThreshold,
      min_celsius_x100: 600,
      max_celsius_x100: 600,
    };

    expect(validate_threshold(threshold)).toEqual({
      ok: false,
      error: ContractError.InvalidThreshold,
    });
  });

  it('returns InvalidThreshold when min is below physical lower bound', () => {
    const threshold: TemperatureThreshold = {
      ...baseThreshold,
      min_celsius_x100: -5001,
    };

    expect(validate_threshold(threshold)).toEqual({
      ok: false,
      error: ContractError.InvalidThreshold,
    });
  });

  it('returns InvalidThreshold when max is above physical upper bound', () => {
    const threshold: TemperatureThreshold = {
      ...baseThreshold,
      max_celsius_x100: 4001,
    };

    expect(validate_threshold(threshold)).toEqual({
      ok: false,
      error: ContractError.InvalidThreshold,
    });
  });

  it('returns WHO default threshold when no threshold is configured', () => {
    const threshold = get_threshold_or_default(new Map(), 'O-');

    expect(threshold).toEqual({
      blood_type: 'O-',
      min_celsius_x100: 200,
      max_celsius_x100: 600,
    });
  });
});
