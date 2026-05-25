const EPSILON = 1e-6;

export class ProbeFieldSampler {
  constructor({ probes = [], zones = [], cells = [], maxProbeCount = 4 } = {}) {
    this.probes = probes;
    this.zones = zones;
    this.cells = cells;
    this.maxProbeCount = maxProbeCount;
    this.probeById = new Map(probes.map(probe => [probe.id, probe]));
    this.zoneById = new Map(zones.map(zone => [zone.id, zone]));
  }

  locate(position, options = {}) {
    const cell = this.findCell(position, options);
    const candidateProbes = cell
      ? cell.probeIds.map(id => this.probeById.get(id)).filter(Boolean)
      : this.probes;
    const regionId = options.acousticRegionId ?? cell?.acousticRegionId ?? null;
    const weighted = this.computeWeights(position, candidateProbes, regionId);
    return {
      cell,
      regionId,
      probes: weighted
    };
  }

  findCell(position, options = {}) {
    const regionId = options.acousticRegionId ?? null;
    return this.cells.find(cell => {
      if (regionId && cell.acousticRegionId && cell.acousticRegionId !== regionId) {
        return false;
      }
      return containsPoint(cell.bounds, position);
    }) ?? null;
  }

  computeWeights(position, candidateProbes, regionId = null) {
    const valid = candidateProbes
      .filter(probe => this.canUseProbe(probe, position, regionId))
      .map(probe => ({
        probe,
        distance: distance3(position, probe.position)
      }))
      .sort((a, b) => a.distance - b.distance)
      .slice(0, this.maxProbeCount);

    if (!valid.length) {
      return [];
    }

    if (valid[0].distance <= EPSILON) {
      return [{ probe: valid[0].probe, weight: 1, distance: 0 }];
    }

    const raw = valid.map(entry => ({
      ...entry,
      weight: 1 / Math.max(entry.distance * entry.distance, EPSILON)
    }));
    const total = raw.reduce((sum, entry) => sum + entry.weight, 0);
    return raw.map(entry => ({
      probe: entry.probe,
      distance: entry.distance,
      weight: entry.weight / total
    }));
  }

  canUseProbe(probe, position, regionId = null) {
    if (!probe) {
      return false;
    }
    if (regionId && probe.acousticRegionId !== regionId) {
      return false;
    }
    const radius = Number.isFinite(probe.validRadius) ? probe.validRadius : Infinity;
    return distance3(position, probe.position) <= radius + EPSILON;
  }
}

export function interpolateScalar(weightedProbes, readValue) {
  return weightedProbes.reduce((sum, entry) => {
    const value = readValue(entry.probe);
    return sum + (Number.isFinite(value) ? value : 0) * entry.weight;
  }, 0);
}

export function interpolateVector(weightedProbes, readValue) {
  const out = [0, 0, 0];
  for (const entry of weightedProbes) {
    const value = readValue(entry.probe);
    if (!Array.isArray(value) || value.length < 3) {
      continue;
    }
    out[0] += value[0] * entry.weight;
    out[1] += value[1] * entry.weight;
    out[2] += value[2] * entry.weight;
  }
  return out;
}

export function containsPoint(bounds, position) {
  if (!bounds || !Array.isArray(bounds.min) || !Array.isArray(bounds.max)) {
    return false;
  }
  return position[0] >= bounds.min[0] && position[0] <= bounds.max[0]
    && position[1] >= bounds.min[1] && position[1] <= bounds.max[1]
    && position[2] >= bounds.min[2] && position[2] <= bounds.max[2];
}

export function distance3(a, b) {
  const dx = a[0] - b[0];
  const dy = a[1] - b[1];
  const dz = a[2] - b[2];
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}
