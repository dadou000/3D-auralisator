export const FIELD_PRODUCTS = Object.freeze([
  { id: 'mix', label: 'Mix' },
  { id: 'speaker_l', label: 'Left' },
  { id: 'speaker_r', label: 'Right' }
]);

export const FIELD_METRICS = Object.freeze([
  { id: 'avg_spl', label: 'Avg SPL', kind: 'spl', range: [20, 20000] },
  { id: 'infrabass_spl', label: 'Infrabass SPL', kind: 'spl', range: [20, 40] },
  { id: 'bass_spl', label: 'Bass SPL', kind: 'spl', range: [40, 100] },
  { id: 'midbass_spl', label: 'Midbass SPL', kind: 'spl', range: [100, 250] },
  { id: 'medium_spl', label: 'Medium SPL', kind: 'spl', range: [250, 1000] },
  { id: 'high_medium_spl', label: 'High Medium SPL', kind: 'spl', range: [1000, 4000] },
  { id: 'treble_spl', label: 'Treble SPL', kind: 'spl', range: [4000, 10000] },
  { id: 'top_highs_spl', label: 'Top Highs SPL', kind: 'spl', range: [10000, 20000] },
  { id: 'rt60', label: 'RT60', kind: 'time', range: [125, 4000] },
  { id: 'rt20', label: 'RT20', kind: 'time', range: [125, 4000] },
  { id: 'rt90', label: 'RT90', kind: 'time', range: [125, 4000] },
  { id: 'muddiness', label: 'Muddiness', kind: 'index', range: [125, 500] },
  { id: 'tonal_balance', label: 'Frequency Tonal Balance Index', kind: 'index', range: [20, 20000] }
]);

export const FIELD_WEIGHTINGS = Object.freeze([
  { id: 'z', label: 'Z' },
  { id: 'a', label: 'A' },
  { id: 'c', label: 'C' }
]);

const REFERENCE_SPL = 94;
const EPSILON = 1e-9;

export function evaluateFieldMetric({
  sourceBakes = [],
  weightedProbes = [],
  product = 'mix',
  metric = 'avg_spl',
  weighting = 'z'
} = {}) {
  const metricSpec = FIELD_METRICS.find(entry => entry.id === metric) ?? FIELD_METRICS[0];
  const selectedSources = product === 'mix'
    ? sourceBakes
    : sourceBakes.filter(sourceBake => sourceBake.sourceId === product);
  if (!selectedSources.length || !weightedProbes.length) {
    return 0;
  }

  if (metricSpec.kind === 'time') {
    return evaluateDecayTime(selectedSources, weightedProbes, metricSpec, metric);
  }
  if (metric === 'muddiness') {
    return evaluateMuddiness(selectedSources, weightedProbes, weighting);
  }
  if (metric === 'tonal_balance') {
    return evaluateTonalBalance(selectedSources, weightedProbes, weighting);
  }
  return evaluateSpl(selectedSources, weightedProbes, metricSpec.range, weighting);
}

export function metricUnit(metricId) {
  const metric = FIELD_METRICS.find(entry => entry.id === metricId);
  if (!metric || metric.kind === 'index') return '';
  return metric.kind === 'time' ? 's' : 'dB';
}

function evaluateSpl(sourceBakes, weightedProbes, range, weighting) {
  let energy = 0;
  for (const sourceBake of sourceBakes) {
    energy += interpolateSourceEnergy(sourceBake, weightedProbes, range, weighting);
  }
  return round3(REFERENCE_SPL + 10 * Math.log10(Math.max(EPSILON, energy)));
}

function evaluateDecayTime(sourceBakes, weightedProbes, metricSpec, metric) {
  let weightedRt = 0;
  let totalWeight = 0;
  for (const sourceBake of sourceBakes) {
    for (const entry of weightedProbes) {
      const response = sourceBake.probeResponses?.[entry.probe.id];
      if (!response?.metrics?.rt60) continue;
      const rt60 = averageBandMap(response.metrics.rt60, metricSpec.range);
      const scale = metric === 'rt20' ? 1 / 3 : metric === 'rt90' ? 1.5 : 1;
      weightedRt += rt60 * scale * entry.weight;
      totalWeight += entry.weight;
    }
  }
  return round3(weightedRt / Math.max(EPSILON, totalWeight));
}

function evaluateMuddiness(sourceBakes, weightedProbes, weighting) {
  const lowEnergy = sourceBakes.reduce((sum, sourceBake) => (
    sum + interpolateSourceEnergy(sourceBake, weightedProbes, [125, 500], weighting)
  ), 0);
  const clarityEnergy = sourceBakes.reduce((sum, sourceBake) => (
    sum + interpolateSourceEnergy(sourceBake, weightedProbes, [1000, 4000], weighting)
  ), 0);
  const avgRt = evaluateDecayTime(sourceBakes, weightedProbes, { range: [125, 500] }, 'rt60');
  return round3(10 * Math.log10((lowEnergy + EPSILON) / (clarityEnergy + EPSILON)) + avgRt * 2);
}

function evaluateTonalBalance(sourceBakes, weightedProbes, weighting) {
  const lows = sourceBakes.reduce((sum, sourceBake) => (
    sum + interpolateSourceEnergy(sourceBake, weightedProbes, [40, 250], weighting)
  ), 0);
  const mids = sourceBakes.reduce((sum, sourceBake) => (
    sum + interpolateSourceEnergy(sourceBake, weightedProbes, [250, 2000], weighting)
  ), 0);
  const highs = sourceBakes.reduce((sum, sourceBake) => (
    sum + interpolateSourceEnergy(sourceBake, weightedProbes, [2000, 16000], weighting)
  ), 0);
  const lowDb = 10 * Math.log10(lows + EPSILON);
  const midDb = 10 * Math.log10(mids + EPSILON);
  const highDb = 10 * Math.log10(highs + EPSILON);
  const average = (lowDb + midDb + highDb) / 3;
  const variance = ((lowDb - average) ** 2 + (midDb - average) ** 2 + (highDb - average) ** 2) / 3;
  return round3(Math.sqrt(variance));
}

function interpolateSourceEnergy(sourceBake, weightedProbes, range, weighting) {
  let energy = 0;
  for (const entry of weightedProbes) {
    const response = sourceBake.probeResponses?.[entry.probe.id];
    if (!response) continue;
    energy += responseEnergy(response, range, weighting) * entry.weight;
  }
  return energy;
}

function responseEnergy(response, range, weighting) {
  let energy = 0;
  let count = 0;
  for (const bin of response.lowFrequency?.bins ?? []) {
    if (!inRange(bin.frequency, range)) continue;
    const weightedMagnitude = (bin.magnitude ?? 0) * dbToLinear(weightingDb(bin.frequency, weighting));
    energy += weightedMagnitude * weightedMagnitude;
    count += 1;
  }
  for (const [frequencyKey, directGain] of Object.entries(response.direct?.gainPerBand ?? {})) {
    const frequency = Number(frequencyKey);
    if (!inRange(frequency, range)) continue;
    const weight = dbToLinear(weightingDb(frequency, weighting));
    const earlyEnergy = (response.early ?? []).reduce((sum, event) => {
      const gain = event.gainPerBand?.[frequencyKey] ?? event.gainPerBand?.[frequency] ?? 0;
      return sum + gain * gain;
    }, 0);
    const lateEnergy = response.late?.lateEnergy?.perBand?.[frequencyKey] ?? response.late?.lateEnergy?.perBand?.[frequency] ?? 0;
    energy += ((directGain * directGain) + earlyEnergy + lateEnergy) * weight * weight;
    count += 1;
  }
  return energy / Math.max(1, count);
}

function averageBandMap(map, range) {
  const values = Object.entries(map ?? {})
    .map(([frequency, value]) => [Number(frequency), value])
    .filter(([frequency]) => inRange(frequency, range))
    .map(([, value]) => value);
  if (!values.length) {
    return 0;
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function inRange(frequency, range) {
  return frequency >= range[0] && frequency <= range[1];
}

export function weightingDb(frequency, weighting = 'z') {
  if (weighting === 'z') {
    return 0;
  }
  const f2 = frequency * frequency;
  if (weighting === 'a') {
    const ra = (12194 ** 2 * f2 ** 2)
      / ((f2 + 20.6 ** 2) * Math.sqrt((f2 + 107.7 ** 2) * (f2 + 737.9 ** 2)) * (f2 + 12194 ** 2));
    return 20 * Math.log10(Math.max(EPSILON, ra)) + 2;
  }
  if (weighting === 'c') {
    const rc = (12194 ** 2 * f2) / ((f2 + 20.6 ** 2) * (f2 + 12194 ** 2));
    return 20 * Math.log10(Math.max(EPSILON, rc)) + 0.06;
  }
  return 0;
}

function dbToLinear(db) {
  return Math.pow(10, db / 20);
}

function round3(value) {
  return Math.round(value * 1000) / 1000;
}
