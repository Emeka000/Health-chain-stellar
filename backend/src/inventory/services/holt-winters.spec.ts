import { forecastHoltWinters } from './holt-winters';

describe('forecastHoltWinters', () => {
  it('captures weekly seasonality in the next forecast point', () => {
    const series = [4, 6, 8, 6, 4, 3, 2, 5, 7, 9, 7, 5, 4, 3];

    const result = forecastHoltWinters(series, {
      seasonLength: 7,
      forecastPoints: 3,
    });

    expect(result.forecast).toHaveLength(3);
    expect(result.forecast[0]).toBeGreaterThan(4);
    expect(result.forecast[0]).toBeLessThan(8);
  });

  it('falls back safely for short series', () => {
    const result = forecastHoltWinters([1, 2, 3], {
      seasonLength: 7,
      forecastPoints: 2,
    });

    expect(result.forecast).toEqual([4, 5]);
  });

  it('uses warmup values to stabilize sparse demand history', () => {
    const result = forecastHoltWinters([0, 1, 0, 1, 0, 1, 0], {
      seasonLength: 7,
      forecastPoints: 1,
      warmupValues: [1, 1, 1, 1, 1, 1, 1],
    });

    expect(result.forecast[0]).toBeGreaterThan(0);
  });
});
