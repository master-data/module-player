import assert from "node:assert/strict";
import test from "node:test";
import { SidPlayer } from "../sid/sid-player.js";

function capture(player, records) {
  player._sidContext = { getAndClearSidWriteTracesPacked: () => Float64Array.from(records.flat()) };
  player._captureSidWriteTraces();
}

test("D418 samples retain cycle spacing and stay separate from PCM and other chips", () => {
  const player = new SidPlayer();
  capture(player, [[0, 24, 0, 1000], [0, 24, 15, 11000], [0, 24, 0, 41000]]);
  const trace = player.readSidDigiTrace();
  assert.equal(trace.length, 512);
  assert(trace[0] < 0);
  assert(trace[127] < 0);
  assert(trace[128] > 0);
  assert(trace[510] > 0);
  assert(trace[511] < 0);
  assert(Math.abs(trace.reduce((sum, value) => sum + value, 0)) < 0.0001);
  assert(player.readSidDigiTrace(1).every(value => value === 0));
  assert.equal(player._scopeBuffers.length, 2);
  assert.equal(player.getSidWriteTrace().length, 0);
});

test("constant volume and filter changes are flat; unrelated voice writes are ignored", () => {
  const player = new SidPlayer();
  capture(player, [[0, 24, 15, 1000], [0, 24, 255, 21000], [0, 4, 129, 41000]]);
  assert(player.readSidDigiTrace().every(value => value === 0));
});

test("sample activity expires even with no further register writes", () => {
  const player = new SidPlayer();
  capture(player, [[0, 24, 15, 1000], [0, 24, 0, 21000]]);
  assert(player.readSidDigiTrace().some(value => value !== 0));
  for (let render = 0; render < 5; render++) capture(player, []);
  assert(player.readSidDigiTrace().every(value => value === 0));
});

test("history is bounded and cleared on playback reset", () => {
  const player = new SidPlayer();
  capture(player, Array.from({ length: 9000 }, (_, index) => [0, 24, index % 16, index * 100]));
  assert.equal(player._sidDigiWriteHistory.get(0).length, 8192);
  player._resetRenderState();
  assert.equal(player._sidDigiWriteHistory.size, 0);
  assert(player.readSidDigiTrace().every(value => value === 0));
  assert.throws(() => player.readSidDigiTrace(-1), RangeError);
  assert.throws(() => player.readSidDigiTrace(0.5), RangeError);
});

test("small audio buffers receive fresh SID captures in sub-frame render batches", () => {
  const player = new SidPlayer({ processorBufferSize: 512 });
  const renderCycles = [];
  let captures = 0;
  player._state = "playing";
  player._sidContext = {
    render(cycles) {
      renderCycles.push(cycles);
      return new Int16Array(1024);
    },
    getAndClearSidWriteTracesPacked() {
      captures++;
      return Float64Array.of(0, 24, captures % 16, captures * 8000);
    }
  };
  const channels = [new Float32Array(512), new Float32Array(512)];
  const event = { outputBuffer: { getChannelData: channel => channels[channel] } };
  player._processAudio(event);
  player._processAudio(event);
  assert.deepEqual(renderCycles, [8000, 8000]);
  assert.equal(captures, 2);
  assert.equal(player._scopeRevision, 2);
  assert.equal(player._diagnostics.underrunCount, 0);
});