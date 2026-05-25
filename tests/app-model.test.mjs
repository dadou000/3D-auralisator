import assert from 'node:assert/strict';
import test from 'node:test';
import { createDefaultAuralisatorScene, summarizeScene } from '../src/app/default-scene.js';
import { createPreviewBake } from '../src/acoustic/bake/preview-bake.js';
import { flattenHardwareConnections, summarizeHardwareGraph } from '../src/hardware/hardware-model.js';

test('default app scene exposes renderer migration primitives', () => {
  const scene = createDefaultAuralisatorScene();
  const summary = summarizeScene(scene);

  assert.equal(scene.units, 'meters');
  assert.equal(summary.speakers, 2);
  assert.equal(summary.walls, 5);
  assert.equal(summary.rooms, 1);
  assert.equal(scene.acoustic.runtimeMode, 'baked-field');
  assert.equal(scene.acoustic.probeGridMode, '3d');
  assert.equal(scene.acoustic.previewProbePlaneY, 1.6);
  assert.equal(scene.hardware.dsp.name, 'Sigma-style DSP');
});

test('default scene can generate a preview acoustic bake', () => {
  const scene = createDefaultAuralisatorScene();
  const bake = createPreviewBake({
    sceneId: scene.id,
    bounds: scene.bounds,
    spacing: scene.acoustic.previewProbeSpacing,
    gridMode: scene.acoustic.probeGridMode,
    planeY: scene.acoustic.previewProbePlaneY
  });

  assert.ok(bake.probes.length > 0);
  assert.equal(bake.manifest.sceneHash, scene.id);
  assert.equal(bake.cells[0].acousticRegionId, 'zone_main');
});

test('default hardware graph connects mix outputs through DSP and amp channels', () => {
  const scene = createDefaultAuralisatorScene();
  const summary = summarizeHardwareGraph(scene.hardware);
  const connections = flattenHardwareConnections(scene.hardware);

  assert.deepEqual(summary, {
    mixOutputs: 2,
    dspInputs: 2,
    dspOutputs: 2,
    amps: 1,
    ampChannels: 2,
    connections: 8
  });
  assert.ok(connections.some(connection => connection.from === 'mix_l' && connection.to === 'dsp_in_l'));
  assert.ok(connections.some(connection => connection.from === 'amp_a_ch1' && connection.to === 'speaker_l'));
  assert.ok(connections.some(connection => connection.from === 'amp_a_ch2' && connection.to === 'speaker_r'));
});
