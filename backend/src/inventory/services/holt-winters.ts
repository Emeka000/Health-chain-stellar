export interface HoltWintersOptions {
  seasonLength: number;
  alpha?: number;
  beta?: number;
  gamma?: number;
  forecastPoints?: number;
  warmupValues?: number[];
}

export interface HoltWintersResult {
  fitted: number[];
  forecast: number[];
  level: number;
  trend: number;
  seasonals: number[];
  alpha: number;
  beta: number;
  gamma: number;
}

const DEFAULT_ALPHA = 0.4;
const DEFAULT_BETA = 0.2;
const DEFAULT_GAMMA = 0.3;

function clampNonNegative(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return value < 0 ? 0 : value;
}

function average(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }

  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function sanitizeSeries(values: number[]): number[] {
  return values
    .filter((value) => Number.isFinite(value))
    .map((value) => clampNonNegative(value));
}

function initializeSeasonals(series: number[], seasonLength: number): number[] {
  const seasons = Math.floor(series.length / seasonLength);
  const seasonAverages = Array.from({ length: seasons }, (_, seasonIndex) =>
    average(
      series.slice(
        seasonIndex * seasonLength,
        (seasonIndex + 1) * seasonLength,
      ),
    ),
  );

  return Array.from({ length: seasonLength }, (_, offset) => {
    let total = 0;

    for (let seasonIndex = 0; seasonIndex < seasons; seasonIndex += 1) {
      total +=
        series[seasonIndex * seasonLength + offset] -
        seasonAverages[seasonIndex];
    }

    return total / seasons;
  });
}

function buildFallback(
  series: number[],
  seasonLength: number,
  forecastPoints: number,
  alpha: number,
  beta: number,
  gamma: number,
): HoltWintersResult {
  const baseLevel = average(series);
  const trend =
    series.length > 1
      ? (series[series.length - 1] - series[0]) / (series.length - 1)
      : 0;
  const fitted = series.map((value) => clampNonNegative(value));
  const forecast = Array.from({ length: forecastPoints }, (_, index) =>
    clampNonNegative(baseLevel + trend * (index + 1)),
  );

  return {
    fitted,
    forecast,
    level: baseLevel,
    trend,
    seasonals: Array.from({ length: seasonLength }, () => 0),
    alpha,
    beta,
    gamma,
  };
}

export function forecastHoltWinters(
  series: number[],
  options: HoltWintersOptions,
): HoltWintersResult {
  const seasonLength = Math.max(2, Math.floor(options.seasonLength || 7));
  const forecastPoints = Math.max(1, Math.floor(options.forecastPoints || 1));
  const alpha = options.alpha ?? DEFAULT_ALPHA;
  const beta = options.beta ?? DEFAULT_BETA;
  const gamma = options.gamma ?? DEFAULT_GAMMA;
  const workingSeries = sanitizeSeries([
    ...(options.warmupValues ?? []),
    ...series,
  ]);

  if (workingSeries.length === 0) {
    return buildFallback([0], seasonLength, forecastPoints, alpha, beta, gamma);
  }

  if (workingSeries.length < seasonLength * 2) {
    return buildFallback(
      workingSeries,
      seasonLength,
      forecastPoints,
      alpha,
      beta,
      gamma,
    );
  }

  const initialSeason = workingSeries.slice(0, seasonLength);
  const seasonals = initializeSeasonals(workingSeries, seasonLength);
  let level = average(initialSeason);
  let trend = average(
    initialSeason.map(
      (_, index) =>
        (workingSeries[seasonLength + index] - workingSeries[index]) /
        seasonLength,
    ),
  );

  const fitted: number[] = [];

  for (let index = 0; index < workingSeries.length; index += 1) {
    const value = workingSeries[index];
    const seasonalIndex = index % seasonLength;
    const seasonal = seasonals[seasonalIndex] ?? 0;

    if (index === 0) {
      fitted.push(clampNonNegative(level + seasonal));
      continue;
    }

    const previousLevel = level;
    level =
      alpha * (value - seasonal) + (1 - alpha) * (previousLevel + trend);
    trend = beta * (level - previousLevel) + (1 - beta) * trend;
    seasonals[seasonalIndex] =
      gamma * (value - level) + (1 - gamma) * seasonal;

    fitted.push(clampNonNegative(level + trend + seasonals[seasonalIndex]));
  }

  const forecast = Array.from({ length: forecastPoints }, (_, offset) => {
    const seasonalIndex = (workingSeries.length + offset) % seasonLength;
    return clampNonNegative(
      level + trend * (offset + 1) + (seasonals[seasonalIndex] ?? 0),
    );
  });

  return {
    fitted,
    forecast,
    level,
    trend,
    seasonals,
    alpha,
    beta,
    gamma,
  };
}
