import { BAKE_QUALITY_PRESETS, FREQUENCY_RANGES } from '../schema.js';

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
  quality = 'draft',
  maxReflectionOrder,
  lateIrSeconds,
  sampleRate = 48000,
  validationSamplesPerCell
} = {}) {
  const responses = [];
  const preset = BAKE_QUALITY_PRESETS[quality] ?? BAKE_QUALITY_PRESETS.draft;
  const resolvedMaxReflectionOrder = maxReflectionOrder ?? preset.maxReflectionOrder;
  const resolvedLateIrSeconds = lateIrSeconds ?? preset.lateIrSeconds;
  const resolvedValidationSamples = validationSamplesPerCell ?? preset.validationSamplesPerCell;
  const rt60 = estimateRt60ByBand(scene);
  const sourceBakes = scene.speakers.map(speaker => {
    const sourceBake = createSourceBake({
      scene,
      speaker,
      probes,
      rt60,
      occlusionLossDb,
      maxReflectionOrder: resolvedMaxReflectionOrder,
      lateIrSeconds: resolvedLateIrSeconds,
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
  const adaptiveRefinement = analyzeAdaptiveRefinement(probes, sourceBakes, preset.targetProbeErrorDb);
  const validation = createValidationPass(scene, probes, sourceBakes, adaptiveRefinement, {
    samplesPerCell: resolvedValidationSamples,
    targetProbeErrorDb: preset.targetProbeErrorDb
  });
  const chunks = createRuntimeChunks(scene, probes, sourceBakes);
  return {
    solver: 'preview-baked-field-v2',
    bakePhilosophy: 'offline-heavy-runtime-sampler',
    quality: preset.label,
    qualityKey: quality,
    sampleRate,
    speedOfSound: SPEED_OF_SOUND,
    frequencyBands: SOLVER_FREQUENCY_BANDS,
    lowFrequencyBins: LOW_FREQUENCY_BINS,
    frequencyRanges: FREQUENCY_RANGES,
    bakeStrategy: {
      bass: '20-200 Hz complex pressure/modal solve at probes',
      lowMid: '200-1000 Hz hybrid occlusion, diffraction, phase, and directional energy',
      high: '1-20 kHz geometric sparse early events plus compressed directional late IR'
    },
    runtimeContract: {
      allowed: ['load chunks', 'locate listener cell', 'region-limited probe interpolation', 'crossfaded convolution', 'HRTF/Ambisonic decode'],
      avoided: ['live propagation solving', 'live diffraction solving', 'live RT60 estimation', 'acoustic path tracing']
    },
    speakers: scene.speakers.length,
    probes: probes.length,
    sourceBakes,
    probeGraph: createProbeGraph(probes),
    runtimeCells: chunks.cells,
    chunks: chunks.chunks,
    adaptiveRefinement,
    validation,
    responses,
    occluded,
    averageGain: responses.reduce((sum, response) => sum + response.gain, 0) / Math.max(1, responses.length),
    stats: {
      sourceCount: sourceBakes.length,
      probeResponseCount: responses.length,
      earlyEventCount: sourceBakes.reduce((sum, sourceBake) => sum + sourceBake.earlyReflectionDatabase.length, 0),
      lowFrequencyBinCount: LOW_FREQUENCY_BINS.length,
      maxReflectionOrder: resolvedMaxReflectionOrder,
      adaptiveCandidateCount: adaptiveRefinement.candidates.length,
      validationSampleCount: validation.samples.length,
      lateIrSeconds: resolvedLateIrSeconds
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
    const early = maxReflectionOrder > 0 ? solveEarlyReflections(scene, speaker, probe, maxReflectionOrder) : [];
    const late = solveLateField(scene, speaker, probe, direct, rt60, { lateIrSeconds, sampleRate });
    const lowFrequency = solveLowFrequencyPressure(scene, speaker, probe);
    const lowMid = solveLowMidHybridField(scene, speaker, probe, direct);
    const highFrequency = solveHighFrequencyField(speaker, probe, early, late);
    probeResponses[probe.id] = {
      probeId: probe.id,
      direct,
      early,
      late,
      lowFrequency,
      lowMid,
      highFrequency,
      representations: {
        direct: 'analytic-delay-gain-with-baked-occlusion-diffraction',
        early: 'sparse-event-list',
        late: 'compressed-directional-ambisonic-ir',
        lowFrequency: 'complex-pressure-map'
      },
      metrics: {
        distance: direct.distance,
        directToReverbRatioDb: round3(linearToDb(direct.gain / Math.max(1e-6, late.lateEnergy.fullBand))),
        earlyEventCount: early.length,
        earlyEnergy: round6(sumEarlyEnergy(early)),
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
    sourceSpectrum: createFlatBandMap(1),
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
      representation: 'compressed-directional-ir',
      encoding: 'foa',
      sampleRate,
      seconds: lateIrSeconds,
      rt60,
      blocksPerProbe: Object.fromEntries(Object.keys(probeResponses).map(probeId => [probeId, `${speaker.id}/${probeId}/late_foa`]))
    },
    runtimePayloads: {
      direct: `/bake/${speaker.id}/direct.bin`,
      early: `/bake/${speaker.id}/early_events.bin`,
      late: `/bake/${speaker.id}/late_ambisonic_ir.bin`,
      lowFrequency: `/bake/${speaker.id}/low_freq_pressure.bin`,
      metrics: `/bake/${speaker.id}/metrics.bin`
    },
    compression: {
      direct: 'band-float32-preview',
      early: 'delta-delay-band-gain-preview',
      late: 'basis-ir-float16-preview',
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

function solveEarlyReflections(scene, speaker, probe, maxReflectionOrder) {
  const maxEvents = Math.min(96, scene.walls.length * Math.max(1, maxReflectionOrder) * 4);
  const events = [];
  for (let order = 1; order <= maxReflectionOrder && events.length < maxEvents; order += 1) {
    for (const wallPath of buildWallPaths(scene.walls, order, maxEvents - events.length)) {
      const event = createReflectionEvent(wallPath, speaker, probe);
      if (event) {
        events.push(event);
      }
    }
  }
  return events.sort((a, b) => a.delayMs - b.delayMs).slice(0, maxEvents);
}

function createReflectionEvent(wallPath, speaker, probe) {
  const imageSource = [...speaker.position];
  for (const wall of wallPath) {
    const axis = wallPlaneAxis(wall);
    imageSource[axis] = 2 * wall.position[axis] - imageSource[axis];
  }
  const reflectionPoints = estimateReflectionPoints(wallPath, speaker.position, probe.position);
  const pathLength = estimatePolylineLength([speaker.position, ...reflectionPoints, probe.position]);
  if (!Number.isFinite(pathLength) || pathLength < 1e-6) {
    return null;
  }
  const materialPath = wallPath.map(wall => wall.material ?? 'default');
  const surfacePath = wallPath.map(wall => wall.id);
  const lastReflectionPoint = reflectionPoints[reflectionPoints.length - 1] ?? speaker.position;
  const gain = 1 / Math.max(1, pathLength);
  const reflectionLossByBand = Object.fromEntries(SOLVER_FREQUENCY_BANDS.map(frequency => [
    frequency,
    materialPath.reduce((product, material) => (
      product * Math.sqrt(Math.max(0, 1 - materialAbsorption(material, frequency)))
    ), 1)
  ]));
  return {
    wallId: surfacePath[0],
    imageSource: imageSource.map(round3),
    reflectionPoint: lastReflectionPoint.map(round3),
    reflectionPoints: reflectionPoints.map(point => point.map(round3)),
    pathLength: round3(pathLength),
    delayMs: round3(pathLength / SPEED_OF_SOUND * 1000),
    direction: normalize3(subtract3(probe.position, lastReflectionPoint)),
    gainPerBand: Object.fromEntries(SOLVER_FREQUENCY_BANDS.map(frequency => {
      return [frequency, round6(gain * reflectionLossByBand[frequency] * scatteringLoss(wallPath.length, frequency))];
    })),
    phase: Object.fromEntries([125, 250, 500, 1000].map(frequency => [
      frequency,
      round3(phaseForDistance(pathLength, frequency))
    ])),
    scatteringPerBand: Object.fromEntries(SOLVER_FREQUENCY_BANDS.map(frequency => [
      frequency,
      round3(1 - scatteringLoss(wallPath.length, frequency))
    ])),
    reflectionOrder: wallPath.length,
    surfacePath,
    materialPath
  };
}

function buildWallPaths(walls, order, limit) {
  if (order <= 1) {
    return walls.slice(0, limit).map(wall => [wall]);
  }
  const paths = [];
  const extend = path => {
    if (paths.length >= limit) {
      return;
    }
    if (path.length === order) {
      paths.push(path);
      return;
    }
    for (const wall of walls) {
      if (path[path.length - 1]?.id === wall.id) {
        continue;
      }
      extend([...path, wall]);
      if (paths.length >= limit) {
        break;
      }
    }
  };
  for (const wall of walls) {
    extend([wall]);
    if (paths.length >= limit) {
      break;
    }
  }
  return paths;
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

function solveLowMidHybridField(scene, speaker, probe, direct) {
  const lowMidBands = SOLVER_FREQUENCY_BANDS.filter(frequency => frequency >= 250 && frequency <= 1000);
  const wallHits = countWallIntersections(scene.walls, speaker.position, probe.position);
  return {
    representation: 'hybrid-directional-phase',
    bands: Object.fromEntries(lowMidBands.map(frequency => {
      const phase = phaseForDistance(distance3(speaker.position, probe.position), frequency);
      const diffractionDb = wallHits > 0 ? -Math.min(12, 3 + frequency / 250) : 0;
      return [frequency, {
        directionalEnergy: round6(direct.gainPerBand[frequency] ?? direct.gain),
        phase: round3(phase),
        diffractionDb: round3(diffractionDb),
        occlusionDb: direct.occlusionPerBand[frequency] ?? 0
      }];
    }))
  };
}

function solveHighFrequencyField(speaker, probe, early, late) {
  const highBands = SOLVER_FREQUENCY_BANDS.filter(frequency => frequency >= 1000);
  return {
    representation: 'geometric-events-late-ir',
    sparseEventCount: early.filter(event => event.reflectionOrder <= 3).length,
    lateIrBlock: `${speaker.id}/${probe.id}/late_foa`,
    bands: Object.fromEntries(highBands.map(frequency => [
      frequency,
      {
        earlyEnergy: round6(early.reduce((sum, event) => sum + ((event.gainPerBand[frequency] ?? 0) ** 2), 0)),
        lateEnergy: late.lateEnergy.perBand[frequency] ?? 0
      }
    ]))
  };
}

function analyzeAdaptiveRefinement(probes, sourceBakes, targetProbeErrorDb) {
  const seen = new Set();
  const candidates = [];
  for (const probe of probes) {
    for (const neighborId of probe.neighbors ?? []) {
      const key = [probe.id, neighborId].sort().join('|');
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      const neighbor = probes.find(entry => entry.id === neighborId);
      if (!neighbor || probe.acousticRegionId !== neighbor.acousticRegionId) {
        continue;
      }
      const error = estimateProbePairError(probe.id, neighbor.id, sourceBakes);
      if (error.totalDb > targetProbeErrorDb) {
        candidates.push({
          between: [probe.id, neighbor.id],
          acousticRegionId: probe.acousticRegionId,
          suggestedPosition: midpoint3(probe.position, neighbor.position).map(round3),
          estimatedErrorDb: round3(error.totalDb),
          reasons: error.reasons
        });
      }
    }
  }
  return {
    method: 'neighbor-response-difference',
    targetProbeErrorDb,
    candidates: candidates.sort((a, b) => b.estimatedErrorDb - a.estimatedErrorDb).slice(0, 64)
  };
}

function estimateProbePairError(probeAId, probeBId, sourceBakes) {
  let total = 0;
  const reasons = new Set();
  for (const sourceBake of sourceBakes) {
    const a = sourceBake.probeResponses[probeAId];
    const b = sourceBake.probeResponses[probeBId];
    if (!a || !b) {
      continue;
    }
    const gainDelta = Math.abs(linearToDb(a.direct.gain) - linearToDb(b.direct.gain));
    const rt60Delta = averageBandDelta(a.metrics.rt60, b.metrics.rt60) * 2;
    const earlyDelta = Math.abs(a.metrics.earlyEventCount - b.metrics.earlyEventCount);
    const bassDelta = averageMagnitudeDelta(a.lowFrequency.bins, b.lowFrequency.bins) * 8;
    const occlusionDelta = a.direct.occlusionHits === b.direct.occlusionHits ? 0 : 8;
    total = Math.max(total, gainDelta + rt60Delta + earlyDelta + bassDelta + occlusionDelta);
    if (gainDelta > 3) reasons.add('frequency response');
    if (rt60Delta > 1) reasons.add('RT60/EDC');
    if (earlyDelta > 2) reasons.add('early reflection timing');
    if (bassDelta > 2) reasons.add('bass pressure phase/amplitude');
    if (occlusionDelta > 0) reasons.add('direct path visibility');
  }
  return {
    totalDb: total,
    reasons: [...reasons]
  };
}

function createValidationPass(scene, probes, sourceBakes, adaptiveRefinement, {
  samplesPerCell,
  targetProbeErrorDb
}) {
  const candidates = adaptiveRefinement.candidates.slice(0, Math.max(0, samplesPerCell));
  const fallback = candidates.length ? [] : probes.slice(0, Math.max(0, samplesPerCell)).map(probe => ({
    between: [probe.id],
    acousticRegionId: probe.acousticRegionId,
    suggestedPosition: probe.position,
    estimatedErrorDb: 0,
    reasons: ['baseline sample']
  }));
  const samples = [...candidates, ...fallback].map((candidate, index) => ({
    id: `validation_${String(index).padStart(3, '0')}`,
    position: candidate.suggestedPosition,
    acousticRegionId: candidate.acousticRegionId,
    comparedProbeIds: candidate.between,
    interpolatedErrorDb: candidate.estimatedErrorDb,
    pass: candidate.estimatedErrorDb <= targetProbeErrorDb,
    reasons: candidate.reasons
  }));
  return {
    method: 'deterministic-extra-listener-samples',
    targetProbeErrorDb,
    sceneBounds: scene.bounds,
    sourceCount: sourceBakes.length,
    samples,
    failedSamples: samples.filter(sample => !sample.pass).length
  };
}

function createProbeGraph(probes) {
  return {
    interpolationPolicy: {
      method: 'region-limited-idw',
      neverInterpolateThroughSolidWalls: true,
      portalTransitionsOnly: true
    },
    probes: probes.map(probe => ({
      id: probe.id,
      position: probe.position,
      validRadius: probe.validRadius,
      neighbors: probe.neighbors ?? [],
      acousticRegionId: probe.acousticRegionId,
      roomId: probe.roomId ?? null,
      portalId: probe.portalId ?? null,
      occlusionRegionId: probe.occlusionRegionId ?? null,
      acousticGradient: probe.acousticGradient ?? [0, 0, 0]
    }))
  };
}

function createRuntimeChunks(scene, probes, sourceBakes) {
  const chunk = {
    id: 'chunk_main',
    bounds: scene.bounds,
    probeIds: probes.map(probe => probe.id),
    sourceIds: sourceBakes.map(sourceBake => sourceBake.sourceId),
    payloads: Object.fromEntries(sourceBakes.map(sourceBake => [sourceBake.sourceId, sourceBake.runtimePayloads]))
  };
  const cells = [{
    id: 'cell_main',
    bounds: scene.bounds,
    acousticRegionId: probes[0]?.acousticRegionId ?? 'zone_main',
    probeIds: probes.map(probe => probe.id),
    interpolationMethod: 'region-limited-idw',
    maxProbeCount: 4,
    sourceResponseBlocks: Object.fromEntries(sourceBakes.map(sourceBake => [
      sourceBake.sourceId,
      Object.keys(sourceBake.probeResponses).map(probeId => `${sourceBake.sourceId}/${probeId}`)
    ]))
  }];
  return { chunks: [chunk], cells };
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

function estimateReflectionPoints(wallPath, source, probe) {
  return wallPath.map((wall, index) => {
    const t = (index + 1) / (wallPath.length + 1);
    const point = [
      source[0] + (probe[0] - source[0]) * t,
      source[1] + (probe[1] - source[1]) * t,
      source[2] + (probe[2] - source[2]) * t
    ];
    const axis = wallPlaneAxis(wall);
    return estimateReflectionPointOnWall(wall, point, point, axis);
  });
}

function estimatePolylineLength(points) {
  let length = 0;
  for (let i = 1; i < points.length; i += 1) {
    length += distance3(points[i - 1], points[i]);
  }
  return length;
}

function scatteringLoss(order, frequency) {
  return Math.max(0.25, Math.pow(0.96 - Math.min(0.12, frequency / 120000), order));
}

function sumEarlyEnergy(events) {
  return events.reduce((sum, event) => (
    sum + Object.values(event.gainPerBand).reduce((bandSum, gain) => bandSum + gain * gain, 0)
  ), 0);
}

function averageBandDelta(a, b) {
  const keys = Object.keys(a ?? {});
  if (!keys.length) {
    return 0;
  }
  return keys.reduce((sum, key) => sum + Math.abs((a[key] ?? 0) - (b[key] ?? 0)), 0) / keys.length;
}

function averageMagnitudeDelta(aBins, bBins) {
  const count = Math.min(aBins?.length ?? 0, bBins?.length ?? 0);
  if (!count) {
    return 0;
  }
  let total = 0;
  for (let i = 0; i < count; i += 1) {
    total += Math.abs((aBins[i].magnitude ?? 0) - (bBins[i].magnitude ?? 0));
  }
  return total / count;
}

function midpoint3(a, b) {
  return [
    (a[0] + b[0]) / 2,
    (a[1] + b[1]) / 2,
    (a[2] + b[2]) / 2
  ];
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
