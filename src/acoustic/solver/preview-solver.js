const SPEED_OF_SOUND = 343;

export const SOLVER_FREQUENCY_BANDS = Object.freeze([31.5, 63, 125, 250, 500, 1000, 2000, 4000, 8000, 16000]);
export const LOW_FREQUENCY_BINS = Object.freeze([20, 31.5, 40, 50, 63, 80, 100, 125, 160, 200]);

const MATERIAL_ABSORPTION = Object.freeze({
  absorber: Object.freeze({ 125: 0.45, 250: 0.65, 500: 0.82, 1000: 0.9, 2000: 0.94, 4000: 0.96 }),
  brick: Object.freeze({ 125: 0.03, 250: 0.03, 500: 0.04, 1000: 0.05, 2000: 0.07, 4000: 0.08 }),
  concrete: Object.freeze({ 125: 0.02, 250: 0.02, 500: 0.03, 1000: 0.04, 2000: 0.05, 4000: 0.06 }),
  glass: Object.freeze({ 125: 0.18, 250: 0.06, 500: 0.04, 1000: 0.03, 2000: 0.02, 4000: 0.02 }),
  default: Object.freeze({ 125: 0.15, 250: 0.18, 500: 0.2, 1000: 0.22, 2000: 0.24, 4000: 0.25 })
});

export function solvePreviewAcousticField(scene, probes, {
  occlusionLossDb = 12,
  maxReflectionOrder = 1,
  lateIrSeconds = 0.75,
  sampleRate = 48000
} = {}) {
  const responses = [];
  const rt60 = estimateRt60ByBand(scene);
  const sourceBakes = scene.speakers.map(speaker => {
    const sourceBake = createSourceBake({
      scene,
      speaker,
      probes,
      rt60,
      occlusionLossDb,
      maxReflectionOrder,
      lateIrSeconds,
      sampleRate
    });
    responses.push(...Object.values(sourceBake.probeResponses).map(response => ({
      speakerId: speaker.id,
      probeId: response.probeId,
      distance: response.direct.distance,
      delayMs: response.direct.delayMs,
      gain: response.direct.gain,
      occlusionHits: response.direct.occlusionHits
    })));
    return sourceBake;
  });

  const occluded = responses.filter(response => response.occlusionHits > 0).length;
  return {
    solver: 'preview-baked-field-v1',
    sampleRate,
    speedOfSound: SPEED_OF_SOUND,
    frequencyBands: SOLVER_FREQUENCY_BANDS,
    lowFrequencyBins: LOW_FREQUENCY_BINS,
    speakers: scene.speakers.length,
    probes: probes.length,
    sourceBakes,
    responses,
    occluded,
    averageGain: responses.reduce((sum, response) => sum + response.gain, 0) / Math.max(1, responses.length),
    stats: {
      sourceCount: sourceBakes.length,
      probeResponseCount: responses.length,
      earlyEventCount: sourceBakes.reduce((sum, sourceBake) => sum + sourceBake.earlyReflectionDatabase.length, 0),
      lowFrequencyBinCount: LOW_FREQUENCY_BINS.length,
      lateIrSeconds
    }
  };
}

function createSourceBake({
  scene,
  speaker,
  probes,
  rt60,
  occlusionLossDb,
  maxReflectionOrder,
  lateIrSeconds,
  sampleRate
}) {
  const probeResponses = {};
  for (const probe of probes) {
    const direct = solveDirectResponse(scene, speaker, probe, occlusionLossDb);
    const early = maxReflectionOrder > 0 ? solveFirstOrderReflections(scene, speaker, probe) : [];
    const late = solveLateField(scene, speaker, probe, direct, rt60, { lateIrSeconds, sampleRate });
    const lowFrequency = solveLowFrequencyPressure(scene, speaker, probe);
    probeResponses[probe.id] = {
      probeId: probe.id,
      direct,
      early,
      late,
      lowFrequency,
      metrics: {
        distance: direct.distance,
        directToReverbRatioDb: round3(linearToDb(direct.gain / Math.max(1e-6, late.lateEnergy.fullBand))),
        earlyEventCount: early.length,
        rt60,
        edt: scaleBandMap(rt60, 0.82),
        edc: buildEnergyDecayCurve(late.lateEnergy.fullBand, lateIrSeconds)
      }
    };
  }

  return {
    sourceId: speaker.id,
    sourcePosition: [...speaker.position],
    directivity: {
      type: 'cardioid-approx',
      amount: speaker.directivity ?? 0,
      aim: speaker.aim ?? [0, 0, 1]
    },
    spectrum: createFlatBandMap(1),
    probeResponses,
    lowFrequencyPressureField: Object.fromEntries(Object.values(probeResponses).map(response => [
      response.probeId,
      response.lowFrequency
    ])),
    earlyReflectionDatabase: Object.values(probeResponses).flatMap(response => response.early.map(event => ({
      ...event,
      probeId: response.probeId
    }))),
    lateReverbField: {
      representation: 'compressed-directional-ir-placeholder',
      encoding: 'foa',
      sampleRate,
      seconds: lateIrSeconds,
      rt60,
      blocksPerProbe: Object.fromEntries(Object.keys(probeResponses).map(probeId => [probeId, `${speaker.id}/${probeId}/late_foa`]))
    },
    compression: {
      direct: 'band-float32-preview',
      early: 'delta-delay-band-gain-preview',
      late: 'basis-ir-placeholder',
      lowFrequency: 'complex-float32-preview'
    }
  };
}

function solveDirectResponse(scene, speaker, probe, occlusionLossDb) {
  const distance = distance3(speaker.position, probe.position);
  const direction = normalize3(subtract3(probe.position, speaker.position));
  const occlusionHits = countWallIntersections(scene.walls, speaker.position, probe.position);
  const delayMs = distance / SPEED_OF_SOUND * 1000;
  const freeFieldGain = 1 / Math.max(1, distance);
  const sourceGain = dbToLinear(speaker.gainDb ?? 0);
  const directivityGain = directivityAt(speaker, direction);
  const gain = freeFieldGain * sourceGain * directivityGain * dbToLinear(-occlusionHits * occlusionLossDb);
  return {
    delayMs: round3(delayMs + (speaker.delayMs ?? 0)),
    distance: round3(distance),
    gain: round6(gain),
    gainPerBand: Object.fromEntries(SOLVER_FREQUENCY_BANDS.map(frequency => [
      frequency,
      round6(gain * dbToLinear(-occlusionHits * occlusionLossDb * frequencyOcclusionWeight(frequency)))
    ])),
    occlusionPerBand: Object.fromEntries(SOLVER_FREQUENCY_BANDS.map(frequency => [
      frequency,
      round3(occlusionHits * occlusionLossDb * frequencyOcclusionWeight(frequency))
    ])),
    occlusionHits,
    diffractionCorrection: Object.fromEntries(SOLVER_FREQUENCY_BANDS.map(frequency => [
      frequency,
      round3(occlusionHits > 0 ? -Math.min(9, 2 + frequency / 2000) : 0)
    ])),
    direction
  };
}

function solveFirstOrderReflections(scene, speaker, probe) {
  return scene.walls
    .map(wall => createFirstOrderReflection(wall, speaker, probe))
    .filter(Boolean)
    .sort((a, b) => a.delayMs - b.delayMs);
}

function createFirstOrderReflection(wall, speaker, probe) {
  const axis = wallPlaneAxis(wall);
  const imageSource = [...speaker.position];
  imageSource[axis] = 2 * wall.position[axis] - speaker.position[axis];
  const reflectionPoint = estimateReflectionPointOnWall(wall, speaker.position, probe.position, axis);
  const sourceToReflect = distance3(speaker.position, reflectionPoint);
  const reflectToProbe = distance3(reflectionPoint, probe.position);
  const pathLength = sourceToReflect + reflectToProbe;
  if (!Number.isFinite(pathLength) || pathLength < 1e-6) {
    return null;
  }
  const material = wall.material ?? 'default';
  const gain = 1 / Math.max(1, pathLength);
  return {
    wallId: wall.id,
    imageSource: imageSource.map(round3),
    reflectionPoint: reflectionPoint.map(round3),
    pathLength: round3(pathLength),
    delayMs: round3(pathLength / SPEED_OF_SOUND * 1000),
    direction: normalize3(subtract3(probe.position, reflectionPoint)),
    gainPerBand: Object.fromEntries(SOLVER_FREQUENCY_BANDS.map(frequency => {
      const absorption = materialAbsorption(material, frequency);
      return [frequency, round6(gain * Math.sqrt(Math.max(0, 1 - absorption)))];
    })),
    phase: Object.fromEntries([250, 500, 1000].map(frequency => [
      frequency,
      round3(phaseForDistance(pathLength, frequency))
    ])),
    reflectionOrder: 1,
    surfacePath: [wall.id],
    materialPath: [material]
  };
}

function solveLateField(scene, speaker, probe, direct, rt60, { lateIrSeconds, sampleRate }) {
  const roomVolume = estimateRoomVolume(scene.bounds);
  const wallArea = scene.walls.reduce((sum, wall) => sum + wallAreaEstimate(wall), 0);
  const distanceFactor = 1 / Math.sqrt(Math.max(1, distance3(speaker.position, probe.position)));
  const fullBand = distanceFactor * Math.min(1, roomVolume / Math.max(1, wallArea * 3));
  return {
    representation: 'directional-ir-summary',
    encoding: 'foa',
    sampleRate,
    seconds: lateIrSeconds,
    blockSize: 1024,
    rt60,
    edt: scaleBandMap(rt60, 0.82),
    edc: buildEnergyDecayCurve(fullBand, lateIrSeconds),
    lateEnergy: {
      fullBand: round6(fullBand),
      perBand: Object.fromEntries(SOLVER_FREQUENCY_BANDS.map(frequency => [
        frequency,
        round6(fullBand * Math.exp(-frequency / 24000) * (direct.occlusionHits ? 1.12 : 1))
      ]))
    },
    dominantDirection: normalize3(subtract3(probe.position, speaker.position))
  };
}

function solveLowFrequencyPressure(scene, speaker, probe) {
  const roomSize = subtract3(scene.bounds.max, scene.bounds.min).map(value => Math.max(1, value));
  const localProbePosition = subtract3(probe.position, scene.bounds.min);
  return {
    bins: LOW_FREQUENCY_BINS.map(frequency => {
      const distance = Math.max(0.5, distance3(speaker.position, probe.position));
      const phase = phaseForDistance(distance, frequency);
      const modalContribution = estimateModalContribution(roomSize, localProbePosition, frequency);
      const amplitude = modalContribution / distance;
      return {
        frequency,
        real: round6(Math.cos(phase) * amplitude),
        imaginary: round6(Math.sin(phase) * amplitude),
        magnitude: round6(amplitude),
        phase: round3(phase),
        modalContribution: round6(modalContribution)
      };
    })
  };
}

export function countWallIntersections(walls, start, end) {
  return walls.reduce((count, wall) => count + (segmentIntersectsWallBox(start, end, wall) ? 1 : 0), 0);
}

export function segmentIntersectsWallBox(start, end, wall) {
  const half = wall.size.map(value => value / 2);
  const min = [
    wall.position[0] - half[0],
    wall.position[1] - half[1],
    wall.position[2] - half[2]
  ];
  const max = [
    wall.position[0] + half[0],
    wall.position[1] + half[1],
    wall.position[2] + half[2]
  ];
  return segmentIntersectsAabb(start, end, min, max);
}

export function segmentIntersectsAabb(start, end, min, max) {
  let tMin = 0;
  let tMax = 1;
  for (let axis = 0; axis < 3; axis += 1) {
    const delta = end[axis] - start[axis];
    if (Math.abs(delta) < 1e-9) {
      if (start[axis] < min[axis] || start[axis] > max[axis]) {
        return false;
      }
      continue;
    }
    const inv = 1 / delta;
    let t1 = (min[axis] - start[axis]) * inv;
    let t2 = (max[axis] - start[axis]) * inv;
    if (t1 > t2) {
      [t1, t2] = [t2, t1];
    }
    tMin = Math.max(tMin, t1);
    tMax = Math.min(tMax, t2);
    if (tMin > tMax) {
      return false;
    }
  }
  return tMax >= 0 && tMin <= 1;
}

function estimateRt60ByBand(scene) {
  const volume = estimateRoomVolume(scene.bounds);
  return Object.fromEntries(SOLVER_FREQUENCY_BANDS.map(frequency => {
    const absorptionArea = scene.walls.reduce((sum, wall) => (
      sum + wallAreaEstimate(wall) * materialAbsorption(wall.material, frequency)
    ), 0);
    const rt60 = 0.161 * volume / Math.max(1, absorptionArea);
    return [frequency, round3(Math.min(12, Math.max(0.08, rt60)))];
  }));
}

function materialAbsorption(material, frequency) {
  const table = MATERIAL_ABSORPTION[material] ?? MATERIAL_ABSORPTION.default;
  const keys = Object.keys(table).map(Number).sort((a, b) => a - b);
  let closest = keys[0];
  for (const key of keys) {
    if (Math.abs(key - frequency) < Math.abs(closest - frequency)) {
      closest = key;
    }
  }
  return table[closest];
}

function estimateRoomVolume(bounds) {
  const size = subtract3(bounds.max, bounds.min);
  return Math.max(1, size[0] * size[1] * size[2]);
}

function wallAreaEstimate(wall) {
  const sorted = [...wall.size].sort((a, b) => b - a);
  return Math.max(0.1, sorted[0] * sorted[1]);
}

function wallPlaneAxis(wall) {
  let axis = 0;
  for (let i = 1; i < wall.size.length; i += 1) {
    if (wall.size[i] < wall.size[axis]) {
      axis = i;
    }
  }
  return axis;
}

function estimateReflectionPointOnWall(wall, source, probe, axis) {
  const point = [
    (source[0] + probe[0]) / 2,
    (source[1] + probe[1]) / 2,
    (source[2] + probe[2]) / 2
  ];
  point[axis] = wall.position[axis];
  const half = wall.size.map(value => value / 2);
  for (let i = 0; i < 3; i += 1) {
    point[i] = Math.min(wall.position[i] + half[i], Math.max(wall.position[i] - half[i], point[i]));
  }
  return point;
}

function directivityAt(speaker, direction) {
  const amount = Math.min(1, Math.max(0, speaker.directivity ?? 0));
  const aim = normalize3(speaker.aim ?? [0, 0, 1]);
  const dot = Math.max(-1, Math.min(1, dot3(aim, direction)));
  return round6((1 - amount) + amount * Math.max(0, (1 + dot) / 2));
}

function frequencyOcclusionWeight(frequency) {
  if (frequency < 200) return 0.25;
  if (frequency < 1000) return 0.65;
  return 1;
}

function estimateModalContribution(roomSize, position, frequency) {
  const local = position.map((value, index) => Math.max(0, Math.min(1, value / roomSize[index])));
  const axial = roomSize.map(size => SPEED_OF_SOUND / (2 * size));
  const modalBoost = axial.reduce((sum, modeFrequency, index) => {
    const distanceToMode = Math.abs(frequency - modeFrequency);
    const spatial = Math.abs(Math.cos(Math.PI * local[index]));
    return sum + spatial / (1 + distanceToMode / 20);
  }, 0);
  return 1 + modalBoost;
}

function buildEnergyDecayCurve(energy, seconds) {
  return [0, 0.25, 0.5, 0.75, 1].map(position => ({
    timeMs: round3(position * seconds * 1000),
    energy: round6(energy * Math.exp(-6.91 * position))
  }));
}

function scaleBandMap(map, scale) {
  return Object.fromEntries(Object.entries(map).map(([frequency, value]) => [frequency, round3(value * scale)]));
}

function createFlatBandMap(value) {
  return Object.fromEntries(SOLVER_FREQUENCY_BANDS.map(frequency => [frequency, value]));
}

function subtract3(a, b) {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function normalize3(vector) {
  const length = Math.hypot(vector[0], vector[1], vector[2]);
  if (length < 1e-9) {
    return [0, 0, 0];
  }
  return vector.map(value => round6(value / length));
}

function dot3(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function phaseForDistance(distance, frequency) {
  return (2 * Math.PI * frequency * distance / SPEED_OF_SOUND) % (2 * Math.PI);
}

function distance3(a, b) {
  const dx = a[0] - b[0];
  const dy = a[1] - b[1];
  const dz = a[2] - b[2];
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

function dbToLinear(db) {
  return Math.pow(10, db / 20);
}

function linearToDb(value) {
  return 20 * Math.log10(Math.max(1e-9, value));
}

function round3(value) {
  return Math.round(value * 1000) / 1000;
}

function round6(value) {
  return Math.round(value * 1000000) / 1000000;
}
