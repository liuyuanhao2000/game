// 军旗翻翻棋 — sfx 手势解锁回归测试（P0-6）
// 缺陷链：静音游玩时 play() 的 muted 早退使 AudioContext 从未创建；取消静音只翻转标志；
// 下一个音效（AI 落子音）由 450ms setTimeout + worker 回调触发（非手势栈），届时才
// new AudioContext() → 自动播放策略下创建即 suspended、非手势 resume 不保证生效 → 长时间无声。
// 修复：setMuted(false)（静音按钮 click 必在手势栈内，index.html:215）时 unlock()
// 预创建 ctx + resume + 零长静音 buffer（兼容老 WebKit 白名单）。
//
// 注：ctx 是 sfx.js 模块级单例，同进程内创建后无法复位，故本场景独立成文件
// （node --test 每文件独立进程），不能并入 sfx.test.js。
const { test } = require('node:test');
const assert = require('node:assert');

// ---- 可控 FakeAudioContext：计数实例/resume，可切换 resume 返回值形态 ----
let instances = 0;
let resumeCalls = 0;
let resumeMode = 'promise'; // 'promise' | 'undefined' | 'throw' | 'reject'
let theCtx = null;

function param() {
  return {
    value: 0,
    setValueAtTime() { return this; },
    linearRampToValueAtTime() { return this; },
    exponentialRampToValueAtTime() { return this; },
  };
}
function fakeNode() {
  return {
    gain: param(), frequency: param(), Q: param(),
    type: 'sine', loop: false, buffer: null,
    connect(n) { return n; }, start() {}, stop() {},
  };
}

class UnlockFakeCtx {
  constructor() {
    instances++;
    theCtx = this;
    this.destination = {};
    this.currentTime = 0;
    this.state = 'suspended'; // 严格自动播放策略：非手势栈创建 → 出生即挂起
    this.sampleRate = 8000;
    this._handlers = {};
  }
  addEventListener(type, fn) { (this._handlers[type] = this._handlers[type] || []).push(fn); }
  fireStateChange() { for (const fn of (this._handlers.statechange || [])) fn(); }
  resume() {
    resumeCalls++;
    this.state = 'running';
    if (resumeMode === 'undefined') return undefined;                        // 老实现：无返回值
    if (resumeMode === 'throw') throw new Error('resume unavailable');       // 老实现：同步抛错
    if (resumeMode === 'reject') return Promise.reject(new Error('autoplay')); // 策略拒绝
    return Promise.resolve();
  }
  createGain() { return fakeNode(); }
  createOscillator() { return fakeNode(); }
  createBufferSource() { return fakeNode(); }
  createBiquadFilter() { return fakeNode(); }
  createBuffer(ch, len) { return { getChannelData: () => new Float32Array(len) }; }
}
global.AudioContext = UnlockFakeCtx;

require('../js/sfx.js');
const sfx = Junqi.sfx;

// 用例按声明顺序串行执行，共享同一 fake ctx 单例（与真实模块行为一致）

test('sfx解锁: 静音期间 play 从不创建 AudioContext', () => {
  sfx.setMuted(true); // 进入静音（setMuted(true) 不触发 unlock）
  assert.strictEqual(instances, 0);
  sfx.play('move');
  sfx.play('flip');
  assert.strictEqual(instances, 0, '静音时 play 早退，ctx 应从未创建（缺陷链的起点）');
});

test('sfx解锁: 取消静音（手势栈内）→ 当场创建并解锁 ctx（P0-6 核心）', () => {
  const now = sfx.toggleMuted(); // 模拟静音按钮 click → setMuted(false) → unlock()
  assert.strictEqual(now, false);
  assert.strictEqual(instances, 1,
    '取消静音瞬间就应创建 ctx 完成手势解锁——修复前拖到首个非手势音效才创建，出生即 suspended → 长时间无声');
  assert.ok(resumeCalls >= 1, 'suspended 的 ctx 应在手势内被 resume');
  assert.strictEqual(theCtx.state, 'running');

  const before = resumeCalls;
  sfx.play('move'); // 模拟随后的 AI 落子音（非手势栈到达）
  assert.strictEqual(instances, 1, '后续音效应复用已解锁的 ctx，不再新建');
  assert.strictEqual(resumeCalls, before, 'running 状态不应重复 resume');
});

test('sfx解锁: iOS 来电打断（interrupted）经 statechange 自动恢复；suspended 不空转', () => {
  theCtx.state = 'interrupted';
  const before = resumeCalls;
  theCtx.fireStateChange();
  assert.strictEqual(resumeCalls, before + 1, 'interrupted 恢复后应自动补一次 resume');
  assert.strictEqual(theCtx.state, 'running');

  theCtx.state = 'suspended';
  const b2 = resumeCalls;
  theCtx.fireStateChange();
  assert.strictEqual(resumeCalls, b2, 'suspended 态的 statechange 不应做非手势 resume（无效空转）');
});

test('sfx解锁: resume 各老实现形态（undefined/同步抛错/Promise拒绝）均不破坏出声', async () => {
  for (const mode of ['undefined', 'throw', 'reject']) {
    resumeMode = mode;
    theCtx.state = 'suspended';
    assert.doesNotThrow(() => sfx.play('move'), 'resume ' + mode + ' 不得让 play 抛错');
    assert.strictEqual(theCtx.state, 'running');
  }
  resumeMode = 'promise';
  // 给 reject 分支一个暴露 unhandledRejection 的机会：若 safeResume 没接住 .catch，
  // node --test 会把未处理的拒绝记为文件级错误
  await new Promise((r) => setImmediate(r));
});
