import assert from 'node:assert/strict';
import test from 'node:test';
import { formatTime } from '../src/audio/audio-engine.js';

test('formats transport times for the local audio player', () => {
  assert.equal(formatTime(0), '0:00');
  assert.equal(formatTime(7.9), '0:07');
  assert.equal(formatTime(65.2), '1:05');
  assert.equal(formatTime(Number.NaN), '0:00');
});
