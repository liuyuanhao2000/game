// 军旗翻翻棋 — 悔棋（undo）回归测试
// 语义（v1.3.0 用户约定）：人机模式一次悔棋撤销一整回合（人类的一步 + AI 应手），
// 双人模式撤销一步；不限次数；AI 思考中允许悔棋（作废在飞思考）；终局后禁止悔棋。
//
// 手法：与 tests/main.test.js 同款桩环境——FakeWorker + UI/SFX 录音桩必须先于
// require('../js/main.js') 就位（main.js 加载时捕获 Junqi.ui / Junqi.sfx），
// mock timers 精确驱动 aiTimer(450ms)。
// ⚠ 断言必须重新取 MAIN.getState()：undo 采用整对象替换（快照恢复），
//   旧的 st 引用指向已被丢弃的对象——那正是过期守卫（身份比较）赖以失效的机制。
// ⚠ UI 桩比 main.test.js 多 rebuildTracker / markLastMoveRendered 两个悔棋专用
//   导出（真实实现见 js/ui.js）；若 ui.js 再增导出，两处桩需同步检查。
const { test, afterEach } = require('node:test');
const assert = require('node:assert');

// ---- 桩环境（必须先于 require('../js/main.js') 构建） ----
const workers = [];
class FakeWorker {
  constructor(url) {
    this.url = url;
    this.terminated = false;
    this.posted = [];
    this.onmessage = null;
    this.onerror = null;
    workers.push(this);
  }
  postMessage(m) { this.posted.push(m); }
  terminate() { this.terminated = true; }
}
global.Worker = FakeWorker;
global.document = {
  readyState: 'loading', // 阻止 require main.js 时自动 boot；测试内手动 start()
  addEventListener() {},
  getElementById: () => ({ textContent: '' }),
};

require('../js/constants.js');
require('../js/board.js');
require('../js/rules.js');
require('../js/state.js');
require('../js/ai.js');

let onSelect = null;
const sfxCalls = [];
const toastCalls = [];
const renderCalls = [];
const rebuildTrackerCalls = [];
const markLastMoveCalls = [];
Junqi.ui = {
  init(opts) { onSelect = opts.onSelect; },
  render(st) { renderCalls.push(st); },
  clearSelection() {}, setSelection() {},
  toast(m) { toastCalls.push(m); },
  flashInvalid() {},
  rebuildTracker() { rebuildTrackerCalls.push(1); },
  markLastMoveRendered(st) { markLastMoveCalls.push(st); },
};
Junqi.sfx = {
  soundFor() { return null; }, // 记牌器/终局音不参与本组断言
  play(name) { sfxCalls.push(name); },
};

require('../js/main.js');

const C = Junqi.constants;
const MAIN = Junqi.main;

// 兜底清理：终止在岗 worker、清挂起定时器、开新局隔离下一用例
afterEach(() => { try { MAIN.reset(); } catch { /* 清理失败不掩盖原始断言错误 */ } });

const plain = (st) => JSON.parse(JSON.stringify(st)); // 去掉 onChange 的深度可比值

function clearRecords() {
  workers.length = 0;
  sfxCalls.length = 0;
  toastCalls.length = 0;
  renderCalls.length = 0;
  rebuildTrackerCalls.length = 0;
  markLastMoveCalls.length = 0;
}

function firstDark(st) {
  const i = st.board.findIndex((c) => c.piece && !c.revealed);
  assert.ok(i >= 0, '应存在可翻的暗子');
  return i;
}

function freshAIGame() {
  clearRecords();
  MAIN.setMode('ai');
  MAIN.setDifficulty(C.DIFFICULTY.EASY);
  MAIN.start();
  return MAIN.getState();
}

function freshPvpGame() {
  clearRecords();
  MAIN.setMode('pvp');
  MAIN.start();
  return MAIN.getState();
}

// 驱动 AI 走完整一步：aiTimer 到期 → worker 发出思考请求 → 回传翻棋应手
function aiReplyFlip(t) {
  t.mock.timers.tick(450);
  assert.strictEqual(workers.length, 1, 'runAI 应恰好创建一个 worker');
  const w = workers[0];
  const j = firstDark(MAIN.getState());
  w.onmessage({ data: { type: 'result', id: w.posted[0].id, action: { kind: 'flip', index: j } } });
  assert.strictEqual(MAIN.getState().board[j].revealed, true, 'AI 应手应已落下');
  return w;
}

test('undo: 双人模式 — 一次悔棋撤销一步（对方翻棋复原朝下，轮回对方）', () => {
  freshPvpGame();
  const i = firstDark(MAIN.getState());
  onSelect(i);                          // A 首翻：定阵营，turn 交给 B
  const afterA = plain(MAIN.getState());
  const j = firstDark(MAIN.getState());
  onSelect(j);                          // B 翻棋
  assert.strictEqual(MAIN.getState().board[j].revealed, true, '前置：B 已翻');

  MAIN.undo();

  const st = MAIN.getState();
  assert.deepStrictEqual(plain(st), afterA, '应深度等于 B 走子前的局面');
  assert.strictEqual(st.board[j].revealed, false, 'B 的子复原朝下');
  assert.strictEqual(st.board[i].revealed, true, 'A 的翻棋保留');
  assert.strictEqual(st.turn, afterA.turn, '轮回 B');
});

test('undo: 人机模式 — 一次悔棋撤销整回合（我的一步 + AI 应手），回到发牌后局面', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  freshAIGame();
  const preFlip = plain(MAIN.getState());
  const i = firstDark(MAIN.getState());
  onSelect(i);                          // 人类首翻 → turn 归 AI
  const w = aiReplyFlip(t);             // AI 翻棋应手 → 轮回人类

  MAIN.undo();

  const st = MAIN.getState();
  assert.deepStrictEqual(plain(st), preFlip,
    '应深度等于人类走子前局面（prevMove/mode/variant/staleCount 全部保真）');
  assert.strictEqual(st.sidesAssigned, false, '首翻的定阵营应被撤销');
  assert.strictEqual(st.turn, null);
  assert.deepStrictEqual(st.controllers, { red: null, blue: null });
  assert.strictEqual(st.board[i].revealed, false, '人类的翻棋复原');
  assert.strictEqual(st.winner, null);
  assert.strictEqual(w.terminated, true, '在飞 worker 应被 terminate');
});

test('undo: 人机模式 — 450ms 思考窗口内悔棋 → aiTimer 清除，AI 永不出手', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  freshAIGame();
  const preFlip = plain(MAIN.getState());
  onSelect(firstDark(MAIN.getState())); // 人类首翻，aiTimer 挂起中

  MAIN.undo();
  t.mock.timers.tick(1000);             // 越过 450ms：若未清除，runAI 必已建 worker

  assert.strictEqual(workers.length, 0, 'aiTimer 应被清除，runAI 不得触发');
  assert.deepStrictEqual(plain(MAIN.getState()), preFlip);
});

test('undo: 人机模式 — worker 思考中悔棋 → terminate + 迟到结果按 id 作废', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  freshAIGame();
  onSelect(firstDark(MAIN.getState()));
  t.mock.timers.tick(450);
  const w = workers[0];
  const lateId = w.posted[0].id;

  MAIN.undo();                          // worker 在飞时悔棋
  assert.strictEqual(w.terminated, true, '在飞线程应 terminate（不跑满预算烧 CPU）');

  const st = MAIN.getState();
  const j = firstDark(st);
  const sfxBefore = sfxCalls.length;
  const rendersBefore = renderCalls.length;
  w.onmessage({ data: { type: 'result', id: lateId, action: { kind: 'flip', index: j } } });
  assert.strictEqual(st.board[j].revealed, false, '迟到结果的翻棋不得被应用');
  assert.strictEqual(st.lastMove, null, '迟到结果不得走子');
  assert.strictEqual(sfxCalls.length, sfxBefore, '迟到结果不得播音效');
  assert.strictEqual(renderCalls.length, rendersBefore, '迟到结果不得触发渲染');
});

test('undo: 不限次数 — 双人连悔三步回到发牌态，空栈再点只提示不改局面', () => {
  freshPvpGame();
  const initial = plain(MAIN.getState());
  for (let k = 0; k < 3; k++) onSelect(firstDark(MAIN.getState()));
  assert.strictEqual(MAIN.getState().board.filter((c) => c.revealed).length, 3, '前置：已翻三子');

  MAIN.undo(); MAIN.undo(); MAIN.undo();
  assert.deepStrictEqual(plain(MAIN.getState()), initial, '应回到发牌态（全暗、未定阵营）');

  const before = plain(MAIN.getState());
  MAIN.undo();
  assert.deepStrictEqual(toastCalls.slice(-1), ['暂无可悔棋的步数']);
  assert.deepStrictEqual(plain(MAIN.getState()), before, '空栈悔棋不得改动局面');
});

test('undo: 终局后拒绝悔棋（用户约定：不允许抢救），不做任何恢复动作', () => {
  freshPvpGame();
  onSelect(firstDark(MAIN.getState()));  // 制造一条历史
  const st = MAIN.getState();
  st.winner = 'red';                     // 白盒置终局（守卫顺序：winner 先于空栈检查）

  const rebuilds = rebuildTrackerCalls.length;
  const renders = renderCalls.length;
  MAIN.undo();

  assert.deepStrictEqual(toastCalls.slice(-1), ['对局已结束，无法悔棋']);
  assert.strictEqual(MAIN.getState(), st, 'state 对象不得被替换');
  assert.strictEqual(rebuildTrackerCalls.length, rebuilds, '拦截时不得重建记牌器');
  assert.strictEqual(renderCalls.length, renders, '拦截时不得重渲染');
});

test('undo: reset 清空历史 — 旧局快照不得跨局复活', () => {
  freshPvpGame();
  onSelect(firstDark(MAIN.getState()));
  MAIN.reset();                          // 重新开局（重新发牌）
  MAIN.undo();
  assert.deepStrictEqual(toastCalls.slice(-1), ['暂无可悔棋的步数']);
});

test('undo: 恢复钩子 — 记牌器重建×1 / 动画抑制拿到恢复态 / undo 音效 / onChange 重挂', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  freshAIGame();
  onSelect(firstDark(MAIN.getState()));
  aiReplyFlip(t);

  const rebuilds = rebuildTrackerCalls.length;
  const marks = markLastMoveCalls.length;
  MAIN.undo();

  assert.strictEqual(rebuildTrackerCalls.length, rebuilds + 1, '应恰好重建一次记牌器');
  assert.strictEqual(markLastMoveCalls.length, marks + 1, '应恰好标记一次 lastMove 已渲染');
  assert.strictEqual(markLastMoveCalls[marks], MAIN.getState(), '标记参数必须是恢复后的 state 对象');
  assert.ok(sfxCalls.includes('undo'), '应播放悔棋音效');

  // onChange 重挂：悔棋后再走一步，applyMove → notify → onChange → render 链应恢复
  const renders = renderCalls.length;
  onSelect(firstDark(MAIN.getState()));
  assert.strictEqual(renderCalls.length, renders + 1, '恢复态的 onChange 应驱动渲染');
});
