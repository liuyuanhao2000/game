// 军旗翻翻棋 — main.js Worker 生命周期回归测试
// 覆盖 P0-1 缺陷链：看门狗/onerror 只置 aiWorker=null 不 terminate（僵尸线程烧 CPU、
// 双 worker 并存）且不作废 thinkId（慢 worker 的迟到结果污染已同步补走的局面：
// 重播音效、"军旗显形" toast 二次弹出）；reset 后旧 worker 仍跑满思考预算。
//
// 手法：桩掉 Worker/document/UI/SFX（main.js 在加载时捕获 Junqi.ui / Junqi.sfx，
// 须在 require main.js 之前就位），用 node:test 的 mock timers 精确驱动
// aiTimer(450ms) 与看门狗(15s)，全程无真实等待。
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

// 桩 UI/SFX：只捕获 onSelect 回调，其余为 no-op。
// soundFor 记录调用：soundAfterApply 每次必然调它，是"被拒走子是否误播音效"的观测点。
let onSelect = null;
const sfxCalls = [];
const soundForCalls = [];
Junqi.ui = {
  init(opts) { onSelect = opts.onSelect; },
  render() {}, clearSelection() {}, setSelection() {},
  toast() {}, flashInvalid() {},
};
Junqi.sfx = {
  soundFor(lm) { soundForCalls.push(lm); return null; },
  play(name) { sfxCalls.push(name); },
};

require('../js/main.js');

const C = Junqi.constants;
const MAIN = Junqi.main;

// 兜底清理：即使用例断言失败中途抛出，也终止在岗 worker、清掉挂起定时器，
// 避免僵尸引用（aiWorker 仍指向旧实例）级联污染下一个用例的失败原因。
afterEach(() => { try { MAIN.reset(); } catch { /* 清理失败不掩盖原始断言错误 */ } });

// 每局准备：清空桩记录 → 新开局（easy 档让看门狗后的同步补走保持毫秒级）→ 人类首翻。
// 首翻定阵营后 turn 归 AI（state.js:136），commitAction → scheduleAI 挂起 450ms aiTimer。
function freshGame() {
  workers.length = 0;
  sfxCalls.length = 0;
  soundForCalls.length = 0;
  MAIN.setMode('ai');
  MAIN.setDifficulty(C.DIFFICULTY.EASY);
  MAIN.start();
  const st = MAIN.getState();
  const i = st.board.findIndex((c) => c.piece && !c.revealed);
  assert.ok(i >= 0, '开局应有可翻的暗子');
  onSelect(i); // 走 main 正式链路：commitAction → applyMove → scheduleAI
  return st;
}

// 推进到 AI 已发出思考请求（worker #1 就位、看门狗挂起）
function tickUntilThinkPosted(t) {
  t.mock.timers.tick(450); // aiTimer 到期 → runAI → ensureWorker + postMessage + 看门狗
  assert.strictEqual(workers.length, 1, 'runAI 应恰好创建一个 worker');
  assert.strictEqual(workers[0].posted.length, 1, '应发出一次思考请求');
  return workers[0];
}

// 找当前局面下一个可翻的暗子（构造"迟到结果"用的合法动作）
function someUnrevealedIndex(st) {
  const j = st.board.findIndex((c) => c.piece && !c.revealed);
  assert.ok(j >= 0, '应存在暗子');
  return j;
}

test('main: 看门狗触发 → terminate 旧 worker、作废迟到结果、同步补走这一步', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const st = freshGame();
  const w1 = tickUntilThinkPosted(t);
  const lateId = w1.posted[0].id;

  // 模拟"worker 只是慢不是死"：超过 15s 看门狗才触发
  t.mock.timers.tick(16000);

  assert.strictEqual(w1.terminated, true, '看门狗必须 terminate 旧 worker（防僵尸线程烧 CPU）');
  assert.ok(st.lastMove, '看门狗触发后应同步补走一步');
  assert.strictEqual(st.controllers[st.turn], 'human', '补走后应轮回人类');

  // 迟到结果此刻才到达 → 必须被静默丢弃（thinkId 已作废），不得改动局面、不得播音效
  const lastAfterSync = st.lastMove;
  const j = someUnrevealedIndex(st);
  const playsBefore = sfxCalls.length;
  w1.onmessage({ data: { type: 'result', id: lateId, action: { kind: 'flip', index: j } } });
  assert.strictEqual(st.lastMove, lastAfterSync, '迟到结果不得再次走子（污染局面）');
  assert.strictEqual(st.board[j].revealed, false, '迟到结果的翻棋不得被应用');
  assert.strictEqual(sfxCalls.length, playsBefore, '迟到结果不得触发音效');

  // 人类再走一步 → 应恰好重建一个新 worker，且旧的保持已终止（无双 worker 并存）
  onSelect(someUnrevealedIndex(st));
  t.mock.timers.tick(450);
  assert.strictEqual(workers.length, 2, '应惰性重建恰好一个新 worker');
  assert.strictEqual(workers[1].terminated, false, '新 worker 应在岗');
  assert.strictEqual(workers[0].terminated, true, '旧 worker 应保持已终止');

  MAIN.reset(); // 清理：终止在岗 worker、清空挂起的定时器
});

test('main: reset 终止思考中的 worker（重开新局后不再让它跑满预算）', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  freshGame();
  const w1 = tickUntilThinkPosted(t);
  assert.strictEqual(w1.terminated, false);

  MAIN.reset();

  assert.strictEqual(w1.terminated, true, 'reset 必须 terminate 思考中的 worker');
});

test('main: worker onerror → terminate 并同步补走，排队中的结果作废', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const st = freshGame();
  const w1 = tickUntilThinkPosted(t);
  const lateId = w1.posted[0].id;

  w1.onerror(new Error('boom')); // 真实 Worker 传 ErrorEvent；main.js 不读参数

  assert.strictEqual(w1.terminated, true, 'onerror 必须 terminate（防僵尸线程）');
  assert.ok(st.lastMove, 'onerror 后应同步补走一步');
  assert.strictEqual(st.controllers[st.turn], 'human', '补走后应轮回人类');

  // onerror 前已入队的结果消息随后到达 → 必须按作废的请求号丢弃
  const lastAfterSync = st.lastMove;
  const j = someUnrevealedIndex(st);
  w1.onmessage({ data: { type: 'result', id: lateId, action: { kind: 'flip', index: j } } });
  assert.strictEqual(st.lastMove, lastAfterSync, '排队中的迟到结果不得污染局面');
  assert.strictEqual(st.board[j].revealed, false, '迟到结果的翻棋不得被应用');

  MAIN.reset();
});

// ---- P0-2：applyMove 返回值不得被忽略（被拒走子未发生，不能播音伪装成功） ----

// 构造一个必被 applyMove 拒绝的动作：freshGame 后轮到 AI，此时 0 号格只可能是
// 空格（行营）/ 暗子 / 人类唯一的已翻子（首翻可能在 0 号），三者对 move 皆非法。
const ILLEGAL_ACTION = { kind: 'move', from: 0, to: 1 };

test('main: worker 回传非法动作 → 拒绝不播音，记日志并同步补走（AI 不停摆）', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const errMock = t.mock.method(console, 'error');
  const st = freshGame();
  const w1 = tickUntilThinkPosted(t);
  const soundForBefore = soundForCalls.length;

  w1.onmessage({ data: { type: 'result', id: w1.posted[0].id, action: ILLEGAL_ACTION } });

  assert.strictEqual(errMock.mock.callCount(), 1, '被拒动作应记录错误日志');
  assert.strictEqual(soundForCalls.length, soundForBefore + 1,
    '音效恰好一次——只为恢复补走的成功一步；被拒走子本身不得播音（修复前会重播上一步音效）');
  assert.strictEqual(st.controllers[st.turn], 'human',
    '被拒后应以实时局面同步重算补走，轮回人类（修复前 AI 停摆在自己回合）');

  MAIN.reset();
});

// ---- P0-4：worker 回传 null action → 必须同步兜底，AI 不得永久停摆 ----

test('main: worker 回传 null action → 同步重算兜底，AI 不停摆', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const errMock = t.mock.method(console, 'error');
  const st = freshGame();
  const w1 = tickUntilThinkPosted(t);
  const lastBefore = st.lastMove; // 人类首翻

  w1.onmessage({ data: { type: 'result', id: w1.posted[0].id, action: null } });

  assert.strictEqual(errMock.mock.callCount(), 1, 'null action 应记录日志（修复前静默吞掉）');
  assert.notStrictEqual(st.lastMove, lastBefore, '应同步重算兜底走出新的一步');
  assert.strictEqual(st.controllers[st.turn], 'human',
    '回合应回到人类（修复前：直接 return，AI 永久停摆在自己回合且无提示）');

  MAIN.reset();
});

test('main: 同步路径 AI 动作被拒 → 不播任何音效、记录日志、局面不变', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const errMock = t.mock.method(console, 'error');
  // 临时替换 chooseMove 返回必非法动作（模拟深层引擎 bug）；t.mock 测试结束自动还原
  t.mock.method(Junqi.ai, 'chooseMove', () => ILLEGAL_ACTION);
  const st = freshGame();
  tickUntilThinkPosted(t);
  const lastBefore = st.lastMove;
  const soundForBefore = soundForCalls.length;

  t.mock.timers.tick(16000); // 看门狗触发 → killWorker → runAISync → 桩动作被 applyMove 拒绝

  assert.strictEqual(errMock.mock.callCount(), 1, '被拒动作应记录错误日志');
  assert.strictEqual(soundForCalls.length, soundForBefore,
    '被拒走子不得播任何音效（修复前在此重播上一步音效伪装成功）');
  assert.strictEqual(st.lastMove, lastBefore, '被拒走子后局面不得变化');
  assert.strictEqual(st.controllers[st.turn], 'ai', '仍是 AI 回合（走子未发生）');

  MAIN.reset();
});
