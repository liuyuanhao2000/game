// 军旗翻翻棋 — AI 冒烟测试
const { test } = require('node:test');
const assert = require('node:assert');
require('../js/constants.js');
require('../js/board.js');
require('../js/rules.js');
require('../js/state.js');
require('../js/ai.js');

const C = Junqi.constants;
const S = Junqi.state;
const R = Junqi.rules;
const AI = Junqi.ai;
const idx = (r, co) => r * 5 + co;

function midgameState() {
  // 构造一个中等局面：部分翻开、部分未翻
  // 翻开规则是确定性的（不依赖 Math.random），保证测试可复现；初始发牌随机不影响断言
  const st = S.createInitialState();
  st.sidesAssigned = true;
  st.playerSide = 'red'; st.aiSide = 'blue'; st.turn = 'blue';
  let flipped = 0;
  for (let i = 0; i < st.board.length && flipped < 20; i++) {
    if (st.board[i].piece && i % 3 === 0) { st.board[i].revealed = true; flipped++; }
  }
  return st;
}

function isLegal(action, state, side) {
  const legal = AI.enumerateActions(state, side);
  return legal.some((a) =>
    (a.kind === action.kind) &&
    (a.kind === 'flip' ? a.index === action.index : a.from === action.from && a.to === action.to)
  );
}

test('ai: easy returns legal move', () => {
  const st = midgameState();
  const a = AI.chooseMove(st, C.DIFFICULTY.EASY, 'blue');
  assert.ok(a, 'easy should return an action');
  assert.ok(isLegal(a, st, 'blue'), 'easy action must be legal');
});

test('ai: medium returns legal move', () => {
  const st = midgameState();
  const a = AI.chooseMove(st, C.DIFFICULTY.MEDIUM, 'blue');
  assert.ok(a);
  assert.ok(isLegal(a, st, 'blue'));
});

test('ai: hard returns legal move (generous time guard)', () => {
  const st = midgameState();
  const t0 = Date.now();
  const a = AI.chooseMove(st, C.DIFFICULTY.HARD, 'blue');
  const dt = Date.now() - t0;
  assert.ok(a, 'hard should return an action');
  assert.ok(isLegal(a, st, 'blue'), 'hard action must be legal');
  // 困难档内部有 800ms 时间预算并回退普通档；此处仅设宽松上限防止失控死循环，避免计时抖动
  assert.ok(dt < 10000, 'hard should terminate well within 10s, took ' + dt + 'ms');
});

test('ai: hard takes obvious winning capture', () => {
  // 司令(rank9) 可吃 排长(rank2) 且无报复
  const st = S.createInitialState();
  // 清空棋盘，手摆局面
  for (let i = 0; i < st.board.length; i++) st.board[i] = { piece: null, revealed: false };
  st.board[idx(1,0)] = { piece: { type:'commander', rank:9, side:'blue' }, revealed: true };
  st.board[idx(1,1)] = { piece: { type:'platoon', rank:2, side:'red' }, revealed: true };
  st.sidesAssigned = true; st.playerSide='red'; st.aiSide='blue'; st.turn='blue';
  const a = AI.chooseMove(st, C.DIFFICULTY.HARD, 'blue');
  assert.ok(a && a.kind==='move' && a.from===idx(1,0) && a.to===idx(1,1),
    'hard should capture free platoon with commander, got ' + JSON.stringify(a));
});

test('ai: hard does not throw on near-empty board', () => {
  const st = S.createInitialState();
  for (let i = 0; i < st.board.length; i++) st.board[i] = { piece: null, revealed: false };
  st.board[idx(1,0)] = { piece: { type:'company', rank:3, side:'blue' }, revealed: true };
  st.sidesAssigned = true; st.playerSide='red'; st.aiSide='blue'; st.turn='blue';
  const a = AI.chooseMove(st, C.DIFFICULTY.HARD, 'blue');
  assert.ok(a);
});

test('ai: capturing a revealed piece must not inflate the hidden distribution', () => {
  const st = S.createInitialState();
  st.sidesAssigned = true; st.playerSide = 'red'; st.aiSide = 'blue'; st.turn = 'red';
  st.board[idx(1,0)] = { piece: { type:'commander', rank:9, side:'red' }, revealed: true };
  st.board[idx(1,1)] = { piece: { type:'platoon', rank:2, side:'blue' }, revealed: true };
  const before = AI.remainingDistribution(st).rem['platoon:blue'];
  S.applyMove(st, { kind:'move', from: idx(1,0), to: idx(1,1) }); // 红司令吃蓝排长
  const after = AI.remainingDistribution(st).rem['platoon:blue'];
  assert.strictEqual(after, before,
    '被吃的蓝排长应保持在隐藏池之外（修复前会从"已翻"变成"未知"，数值 +1）');
});

test('ai: remainingDistribution sums to the number of unrevealed cells after a capture', () => {
  const st = S.createInitialState();
  st.sidesAssigned = true; st.playerSide = 'red'; st.aiSide = 'blue'; st.turn = 'red';
  st.board[idx(1,0)] = { piece: { type:'commander', rank:9, side:'red' }, revealed: true };
  st.board[idx(1,1)] = { piece: { type:'platoon', rank:2, side:'blue' }, revealed: true };
  S.applyMove(st, { kind:'move', from: idx(1,0), to: idx(1,1) });
  const { rem, totalUnrevealed } = AI.remainingDistribution(st);
  let sum = 0; for (const k in rem) sum += rem[k];
  // 手工覆写了 (1,0)/(1,1) 两格的原子，故允许整体偏差恰好为 2（被覆写丢失的子）；
  // 关键回归：被吃子已扣除，偏差不应再随后续吃子增长。这里验证 sum 与暗格数的差稳定。
  assert.ok(sum >= totalUnrevealed, 'Σrem 不应小于暗格数');
  assert.ok(sum - totalUnrevealed <= 2, '差值只应来自手工覆写的 2 格，got ' + (sum - totalUnrevealed));
});

test('ai: Σrem === totalUnrevealed holds throughout a simulated game', () => {
  const st = S.createInitialState();
  st.sidesAssigned = true; st.playerSide = 'red'; st.aiSide = 'blue'; st.turn = 'red';
  let plies = 0;
  const check = () => {
    const { rem, totalUnrevealed } = AI.remainingDistribution(st);
    let sum = 0; for (const k in rem) sum += rem[k];
    assert.strictEqual(sum, totalUnrevealed,
      'ply ' + plies + ': Σrem(' + sum + ') !== 暗格数(' + totalUnrevealed + ')');
  };
  check();
  while (!st.winner && plies < 300) {
    const actions = R.enumerateActions(st, st.turn);
    if (!actions.length) break;
    const a = actions.find((x) => x.kind === 'move') || actions[0]; // 确定性选择
    if (!S.applyMove(st, a)) break;
    plies++;
    check();
  }
  assert.ok(plies > 0, 'should have played some plies');
});
