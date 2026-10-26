import { test } from 'node:test';
import assert from 'node:assert/strict';
import { N, makeHeight, sampleChunk } from './world.ts';

test('the same seed builds the same terrain; another seed does not', () => {
  const a = makeHeight(42);
  const b = makeHeight(42);
  for (const [x, z] of [[0, 0], [1234.5, -987], [-50_000, 72_000]]) assert.equal(a(x, z), b(x, z));
  assert.notEqual(a(1234.5, -987), makeHeight(43)(1234.5, -987));
});

test('neighbouring chunks share their edge heights exactly', () => {
  const height = makeHeight(1);
  const left = sampleChunk(height, 0, 0);
  const right = sampleChunk(height, 1, 0);
  // x = 256 is the left chunk's last inner column and the right chunk's first
  for (let j = 0; j < N; j++) assert.equal(left[(N - 2) * N + j], right[N + j]);
});
