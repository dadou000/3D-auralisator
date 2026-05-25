import { createEmptyBakeManifest } from '../schema.js';

export const PROBE_GRID_MODES = Object.freeze({
  grid2d: '2d',
  grid3d: '3d'
});

export function createPreviewBake({
  sceneId = 'current-scene',
  bounds,
  spacing = 4,
  gridMode = PROBE_GRID_MODES.grid3d,
  planeY = 1.6
} = {}) {
  const bakeBounds = bounds ?? {
    min: [-10, 0.5, -10],
    max: [10, 2, 10]
  };
  const zone = {
    id: 'zone_main',
    type: 'room',
    bounds: bakeBounds,
    portals: [],
    wallIds: []
  };
  const probes = generateGridProbes(bakeBounds, spacing, zone.id, { gridMode, planeY });
  return {
    manifest: createEmptyBakeManifest({
      sceneHash: sceneId,
      probeLayout: {
        gridMode,
        spacing,
        planeY: gridMode === PROBE_GRID_MODES.grid2d ? clamp(planeY, bakeBounds.min[1], bakeBounds.max[1]) : null
      },
      zones: [zone],
      chunks: [{
        id: 'chunk_main',
        bounds: bakeBounds,
        probeIds: probes.map(probe => probe.id),
        zoneIds: [zone.id],
        payloads: {}
      }],
      sources: []
    }),
    probes,
    cells: [{
      id: 'cell_main',
      bounds: bakeBounds,
      acousticRegionId: zone.id,
      probeIds: probes.map(probe => probe.id)
    }]
  };
}

export function generateGridProbes(bounds, spacing, acousticRegionId, {
  gridMode = PROBE_GRID_MODES.grid3d,
  planeY = 1.6
} = {}) {
  const probes = [];
  let index = 0;
  const yValues = gridMode === PROBE_GRID_MODES.grid2d
    ? [clamp(planeY, bounds.min[1], bounds.max[1])]
    : makeAxisValues(bounds.min[1], bounds.max[1], spacing);

  for (let x = bounds.min[0]; x <= bounds.max[0]; x += spacing) {
    for (const y of yValues) {
      for (let z = bounds.min[2]; z <= bounds.max[2]; z += spacing) {
        probes.push({
          id: `probe_${String(index).padStart(5, '0')}`,
          position: [round3(x), round3(y), round3(z)],
          validRadius: spacing * 1.75,
          neighbors: [],
          acousticRegionId,
          roomId: acousticRegionId,
          portalId: null,
          acousticGradient: [0, 0, 0]
        });
        index += 1;
      }
    }
  }
  linkNearestNeighbors(probes, spacing * 1.1);
  return probes;
}

export function createManualProbe({
  id,
  position,
  spacing = 4,
  acousticRegionId = 'zone_main',
  validRadius = spacing * 1.75
}) {
  return {
    id,
    position: position.map(round3),
    validRadius,
    neighbors: [],
    acousticRegionId,
    roomId: acousticRegionId,
    portalId: null,
    acousticGradient: [0, 0, 0],
    manual: true
  };
}

export function relinkProbeNeighbors(probes, maxDistance) {
  linkNearestNeighbors(probes, maxDistance);
  return probes;
}

function makeAxisValues(min, max, spacing) {
  const values = [];
  for (let value = min; value <= max; value += spacing) {
    values.push(value);
  }
  if (!values.length || values[values.length - 1] !== max) {
    values.push(max);
  }
  return values;
}

function linkNearestNeighbors(probes, maxDistance) {
  const maxDistanceSq = maxDistance * maxDistance;
  for (const probe of probes) {
    probe.neighbors = probes
      .filter(other => other !== probe && distanceSq(probe.position, other.position) <= maxDistanceSq)
      .map(other => other.id);
  }
}

function distanceSq(a, b) {
  const dx = a[0] - b[0];
  const dy = a[1] - b[1];
  const dz = a[2] - b[2];
  return dx * dx + dy * dy + dz * dz;
}

function round3(value) {
  return Math.round(value * 1000) / 1000;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}
