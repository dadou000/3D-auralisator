const SPEED_OF_SOUND = 343;

export function solvePreviewAcousticField(scene, probes, { occlusionLossDb = 12 } = {}) {
  const responses = [];
  for (const speaker of scene.speakers) {
    for (const probe of probes) {
      const distance = distance3(speaker.position, probe.position);
      const occlusionHits = countWallIntersections(scene.walls, speaker.position, probe.position);
      const delayMs = distance / SPEED_OF_SOUND * 1000;
      const freeFieldGain = 1 / Math.max(1, distance);
      const occlusionGain = dbToLinear(-occlusionHits * occlusionLossDb);
      responses.push({
        speakerId: speaker.id,
        probeId: probe.id,
        distance,
        delayMs,
        gain: freeFieldGain * occlusionGain,
        occlusionHits
      });
    }
  }

  const occluded = responses.filter(response => response.occlusionHits > 0).length;
  return {
    solver: 'preview-direct-field',
    speakers: scene.speakers.length,
    probes: probes.length,
    responses,
    occluded,
    averageGain: responses.reduce((sum, response) => sum + response.gain, 0) / Math.max(1, responses.length)
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

function distance3(a, b) {
  const dx = a[0] - b[0];
  const dy = a[1] - b[1];
  const dz = a[2] - b[2];
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

function dbToLinear(db) {
  return Math.pow(10, db / 20);
}
