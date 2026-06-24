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
  const st = S.createInitialState();
  st.sidesAssigned = true;
  st.playerSide = 'red'; st.aiSide = 'blue'; st.turn = 'blue';
  // 随机翻开若干格以模拟中盘
  let flipped = 0;
  for (let i = 0; i < st.board.length && flipped < 20; i++) {
    if (st.board[i].piece && Math.random() < 0.4) { st.board[i].revealed = true; flipped++; }
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

test('ai: hard returns legal move within ~2s', () => {
  const st = midgameState();
  const t0 = Date.now();
  const a = AI.chooseMove(st, C.DIFFICULTY.HARD, 'blue');
  const dt = Date.now() - t0;
  assert.ok(a, 'hard should return an action');
  assert.ok(isLegal(a, st, 'blue'), 'hard action must be legal');
  assert.ok(dt < 2000, 'hard should respond within 2s, took ' + dt + 'ms');
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

console.log('ai tests loaded');
