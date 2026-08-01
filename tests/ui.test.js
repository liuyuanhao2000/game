// 军旗翻翻棋 — ui 纯函数单测（记牌器数据层）
const { test } = require('node:test');
const assert = require('node:assert');
require('../js/constants.js');
require('../js/board.js');
require('../js/rules.js');
require('../js/state.js');
require('../js/ui.js');

const C = Junqi.constants;
const UI = Junqi.ui;
const idx = (r, c) => r * 5 + c;

function emptyState() {
  const b = new Array(60);
  for (let i = 0; i < 60; i++) b[i] = { piece: null, revealed: false };
  return {
    board: b, rows: 12, cols: 5, turn: null, playerSide: null, aiSide: null,
    sidesAssigned: false, winner: null, staleCount: 0,
    minesLost: { red: 0, blue: 0 }, captured: {}, lastMove: null, onChange: null,
  };
}
function place(st, r, c, type, side, revealed = true) {
  st.board[idx(r, c)] = { piece: { type, rank: C.PIECES[type].rank, side }, revealed };
}

test('ui: trackerData 初始局面 — 全部计数为初始值、无阵亡', () => {
  const t = UI.trackerData(emptyState());
  assert.strictEqual(t.hidden.red.commander, 1);
  assert.strictEqual(t.hidden.red.company, 3);
  assert.strictEqual(t.hidden.blue.mine, 3);
  assert.strictEqual(t.lost.red.length, 0);
  assert.strictEqual(t.lost.blue.length, 0);
  assert.deepStrictEqual(t.minesLost, { red: 0, blue: 0 });
});

test('ui: trackerData — 已翻与已吃从各方未翻计数中扣除', () => {
  const st = emptyState();
  place(st, 0, 0, 'commander', 'red', true);   // 红司令已翻 → 不再计入未翻
  place(st, 1, 0, 'platoon', 'blue', false);   // 蓝排长未翻 → 仍计入未翻
  st.captured = { 'platoon:blue': 2, 'bomb:red': 1 };
  const t = UI.trackerData(st);
  assert.strictEqual(t.hidden.red.commander, 0, '已翻司令不计未翻');
  assert.strictEqual(t.hidden.blue.platoon, 1, '蓝排长 3 − 已翻 0 − 已吃 2 = 1');
  assert.strictEqual(t.hidden.red.bomb, 1, '红炸弹 2 − 已吃 1 = 1');
  assert.deepStrictEqual(t.lost.blue, ['platoon', 'platoon']);
  assert.deepStrictEqual(t.lost.red, ['bomb']);
});

test('ui: trackerData — 阵亡清单按 rank 降序展开', () => {
  const st = emptyState();
  st.captured = { 'platoon:red': 1, 'general:red': 1, 'engineer:red': 1 };
  const t = UI.trackerData(st);
  assert.deepStrictEqual(t.lost.red, ['general', 'platoon', 'engineer']); // rank 8 > 2 > 1
});

test('ui: trackerData — minesLost 透传', () => {
  const st = emptyState();
  st.minesLost = { red: 2, blue: 3 };
  const t = UI.trackerData(st);
  assert.deepStrictEqual(t.minesLost, { red: 2, blue: 3 });
});
