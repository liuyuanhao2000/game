// 军旗翻翻棋 — sfx 单测（事件映射 + 环境健壮性；音色本身需真浏览器人耳验收）
const { test } = require('node:test');
const assert = require('node:assert');
require('../js/sfx.js');

const sfx = Junqi.sfx;

test('sfx: soundFor 事件→音效名 全映射', () => {
  assert.strictEqual(sfx.soundFor(null), null);
  assert.strictEqual(sfx.soundFor({ kind: 'flip', index: 3 }), 'flip');
  assert.strictEqual(sfx.soundFor({ kind: 'move', from: 0, to: 1, type: 'company', battle: null }), 'move');
  // 炸弹相关（攻方是炸弹 / 守方是炸弹）
  assert.strictEqual(sfx.soundFor({ kind: 'move', type: 'bomb', battle: { type: 'general', outcome: 'both' } }), 'bomb');
  assert.strictEqual(sfx.soundFor({ kind: 'move', type: 'company', battle: { type: 'bomb', outcome: 'both' } }), 'bomb');
  assert.strictEqual(sfx.soundFor({ kind: 'move', type: 'bomb', battle: { type: 'flag', outcome: 'flag' } }), 'bomb');
  // 工兵拔雷 vs 非工兵撞雷
  assert.strictEqual(sfx.soundFor({ kind: 'move', type: 'engineer', battle: { type: 'mine', outcome: 'win' } }), 'mine');
  assert.strictEqual(sfx.soundFor({ kind: 'move', type: 'company', battle: { type: 'mine', outcome: 'lose' } }), 'die');
  // 常规交战
  assert.strictEqual(sfx.soundFor({ kind: 'move', type: 'commander', battle: { type: 'platoon', outcome: 'win' } }), 'capture');
  assert.strictEqual(sfx.soundFor({ kind: 'move', type: 'commander', battle: { type: 'flag', outcome: 'flag' } }), 'capture');
  assert.strictEqual(sfx.soundFor({ kind: 'move', type: 'division', battle: { type: 'division', outcome: 'both' } }), 'both');
  assert.strictEqual(sfx.soundFor({ kind: 'move', type: 'platoon', battle: { type: 'commander', outcome: 'lose' } }), 'die');
});

test('sfx: 无 AudioContext 环境（node/桩）下 play 静默不抛错', () => {
  const names = ['select', 'flip', 'move', 'capture', 'die', 'both', 'bomb', 'mine', 'invalid', 'win', 'lose', 'draw', 'nope'];
  assert.doesNotThrow(() => { for (const n of names) sfx.play(n); });
});

test('sfx: FakeAudioContext 下全部音效能播放、静音后不再创建节点', () => {
  let oscCount = 0;
  class FakeParam {
    constructor(v) { this.value = v == null ? 0 : v; }
    setValueAtTime() { return this; }
    linearRampToValueAtTime() { return this; }
    exponentialRampToValueAtTime() { return this; }
  }
  class FakeNode {
    constructor() { this.gain = new FakeParam(1); this.frequency = new FakeParam(440); this.Q = new FakeParam(1); this.type = 'sine'; this.loop = false; this.buffer = null; }
    connect(n) { return n; }
    start() {}
    stop() {}
  }
  class FakeAudioContext {
    constructor() { this.destination = {}; this.currentTime = 0; this.state = 'running'; this.sampleRate = 8000; }
    createOscillator() { oscCount++; return new FakeNode(); }
    createGain() { return new FakeNode(); }
    createBufferSource() { return new FakeNode(); }
    createBiquadFilter() { return new FakeNode(); }
    createBuffer(ch, len) { return { getChannelData: () => new Float32Array(len) }; }
    resume() { return Promise.resolve(); }
  }
  global.AudioContext = FakeAudioContext;
  try {
    sfx.setMuted(false);
    const names = ['select', 'flip', 'move', 'capture', 'die', 'both', 'bomb', 'mine', 'invalid', 'win', 'lose', 'draw'];
    for (const n of names) assert.doesNotThrow(() => sfx.play(n), '音效 ' + n + ' 不应抛错');
    assert.ok(oscCount > 0, '应创建振荡器节点');
    const before = oscCount;
    sfx.setMuted(true);
    sfx.play('win');
    assert.strictEqual(oscCount, before, '静音时不应创建新节点');
  } finally {
    sfx.setMuted(false);
    delete global.AudioContext;
  }
});
