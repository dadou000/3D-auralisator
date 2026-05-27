import assert from 'node:assert/strict';
import test from 'node:test';
import { createDefaultAuralisatorScene } from '../src/app/default-scene.js';
import { createPreviewBake } from '../src/acoustic/bake/preview-bake.js';
import { solvePreviewAcousticField } from '../src/acoustic/solver/preview-solver.js';
import {
  evaluateFieldMetric,
  FIELD_METRICS,
  FIELD_WEIGHTINGS,
  weightingDb
} from '../src/acoustic/field-metrics.js';

test('field metric catalog exposes requested analysis products', () => {
  const metricIds = FIELD_METRICS.map(metric => metric.id);
  assert.ok(metricIds.includes('avg_spl'));
  assert.ok(metricIds.includes('infrabass_spl'));
  assert.ok(metricIds.includes('rt60'));
  assert.ok(metricIds.includes('rt20'));
  assert.ok(metricIds.includes('rt90'));
  assert.ok(metricIds.includes('muddiness'));
  assert.ok(metricIds.includes('tonal_balance'));
  assert.deepEqual(FIELD_WEIGHTINGS.map(weighting => weighting.id), ['z', 'a', 'c']);
});

test('field metrics evaluate weighted probe data from a solver result', () => {
  const scene = createDefaultAuralisatorScene();
  const bake = createPreviewBake({
    sceneId: scene.id,
    bounds: { min: [-2, 1.6, -2], max: [2, 1.6, 2] },
    spacing: 4,
    gridMode: '2d',
    planeY: 1.6
  });
  const result = solvePreviewAcousticField(scene, bake.probes, { quality: 'preview' });
  const weightedProbes = [{ probe: bake.probes[0], weight: 1, distance: 0 }];

  const avgSpl = evaluateFieldMetric({
    sourceBakes: result.sourceBakes,
    weightedProbes,
    product: 'mix',
    metric: 'avg_spl',
    weighting: 'z'
  });
  const rt60 = evaluateFieldMetric({
    sourceBakes: result.sourceBakes,
    weightedProbes,
    product: 'speaker_l',
    metric: 'rt60',
    weighting: 'z'
  });
  const tonalBalance = evaluateFieldMetric({
    sourceBakes: result.sourceBakes,
    weightedProbes,
    product: 'mix',
    metric: 'tonal_balance',
    weighting: 'a'
  });

  assert.ok(avgSpl > 0);
  assert.ok(rt60 > 0);
  assert.ok(tonalBalance >= 0);
  assert.ok(weightingDb(31.5, 'a') < weightingDb(1000, 'a'));
});
