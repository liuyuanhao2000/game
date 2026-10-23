// 军旗翻翻棋 — 娱乐·无限火力玩法（variant='bombFire'）单测
// 规则：军旗/工兵/地雷全部换成炸弹（每方 9 炸弹）；消灭对方全部棋子即胜。
const { test } = require('node:test');
const assert = require('node:assert');
require('../js/constants.js');
require('../js/board.js');
require('../js/rules.js');
require('../js/state.js');
require('../js/ai.js');
require('../js/ui.js');

const C = Junqi.constants;
const R = Junqi.rules;
const S = Junqi.state;
const AI = Junqi.ai;
const UI = Junqi.ui;
const idx = (r, c) => r * 5 + c;

function piece(type, side) { return { type, rank: C.PIECES[type].rank, side }; }
function emptyCell() { return { piece: null, revealed: false }; }
function emptyBoard() { const b = new Array(60); for (let i = 0; i < 60; i++) b[i] = emptyCell(); return b; }
function place(b, i, type, side, revealed = true) { b[i] = { piece: piece(type, side), revealed }; }
function makeState(board, variant = C.VARIANTS.BOMB_FIRE) {
  return {
    board, rows: 12, cols: 5, variant, turn: 'red',
    controllers: { red: 'human', blue: 'ai' }, mode: 'ai',
    sidesAssigned: true, winner: null, staleCount: 0,
    minesLost: { red: 0, blue: 0 }, captured: {}, lastMove: null, onChange: null,
  };
}
function countSide(st, side) {
  let n = 0;
  for (const c of st.board) if (c.piece && c.piece.side === side) n++;
  return n;
}

test('bombFire: 每方构成 = 9 炸弹 + 16 普通子，无军旗/工兵/地雷，共 50 枚暗子', () => {
  const st = S.createInitialState({ variant: C.VARIANTS.BOMB_FIRE });
  const count = { red: {}, blue: {} };
  let total = 0;
  for (const c of st.board) {
    if (!c.piece) continue;
    total++;
    assert.strictEqual(c.revealed, false, '开局全部背面朝下');
    count[c.piece.side][c.piece.type] = (count[c.piece.side][c.piece.type] || 0) + 1;
  }
  assert.strictEqual(total, 50);
  for (const side of C.SIDES) {
    assert.strictEqual(count[side].bomb, 9);
    assert.strictEqual(count[side].commander, 1);
    assert.strictEqual(count[side].company, 3);
    assert.strictEqual(count[side].platoon, 3);
    assert.strictEqual(count[side].flag, undefined, '无军旗');
    assert.strictEqual(count[side].mine, undefined, '无地雷');
    assert.strictEqual(count[side].engineer, undefined, '无工兵');
    const n = Object.values(count[side]).reduce((s, v) => s + v, 0);
    assert.strictEqual(n, 25, side + ' 仍为 25 子');
  }
  assert.strictEqual(st.sidesAssigned, false, '照常翻棋定边');
  assert.strictEqual(C.pieceCounts('bombFire'), C.BOMB_FIRE_COUNTS);
  assert.strictEqual(C.pieceCounts('classic'), C.BASE_COUNTS, '其他玩法构成不变');
});

test('bombFire: 消灭对方最后一子 → 立即获胜', () => {
  const b = emptyBoard();
  place(b, idx(1, 0), 'commander', 'red');
  place(b, idx(1, 1), 'platoon', 'blue');
  const st = makeState(b);
  assert.strictEqual(S.applyMove(st, { kind: 'move', from: idx(1, 0), to: idx(1, 1) }), true);
  assert.strictEqual(countSide(st, 'blue'), 0);
  assert.strictEqual(st.winner, 'red');
});

test('bombFire: 主动攻击却全军覆没 → 攻方判负（败方可能是行棋方）', () => {
  const b = emptyBoard();
  place(b, idx(1, 0), 'platoon', 'red');
  place(b, idx(1, 1), 'commander', 'blue');
  const st = makeState(b);
  assert.strictEqual(S.applyMove(st, { kind: 'move', from: idx(1, 0), to: idx(1, 1) }), true);
  assert.strictEqual(countSide(st, 'red'), 0);
  assert.strictEqual(st.winner, 'blue');
});

test('bombFire: 双方最后一子同归于尽 → 和局（不能误判任一方胜）', () => {
  const b = emptyBoard();
  place(b, idx(1, 0), 'commander', 'red');
  place(b, idx(1, 1), 'commander', 'blue');
  const st = makeState(b);
  assert.strictEqual(S.applyMove(st, { kind: 'move', from: idx(1, 0), to: idx(1, 1) }), true);
  assert.strictEqual(countSide(st, 'red'), 0);
  assert.strictEqual(countSide(st, 'blue'), 0);
  assert.strictEqual(st.winner, 'draw');
  assert.strictEqual(R.checkWinner(st), 'draw');
});

test('bombFire: 炸弹与任何子同归；只要双方仍有子就不终局', () => {
  const b = emptyBoard();
  place(b, idx(1, 0), 'bomb', 'red');
  place(b, idx(1, 1), 'commander', 'blue');
  place(b, idx(10, 0), 'company', 'red');
  place(b, idx(10, 4), 'company', 'blue');
  const st = makeState(b);
  S.applyMove(st, { kind: 'move', from: idx(1, 0), to: idx(1, 1) });
  assert.strictEqual(st.winner, null);
  assert.strictEqual(countSide(st, 'red'), 1);
  assert.strictEqual(countSide(st, 'blue'), 1);
  assert.strictEqual(st.board[idx(1, 1)].piece, null, '炸弹与司令同归');
});

test('bombFire: 军旗保护/拔雷规则不参与 — 无雷也能随意攻击任何子', () => {
  const b = emptyBoard();
  place(b, idx(1, 0), 'commander', 'red');
  place(b, idx(1, 1), 'platoon', 'blue');
  place(b, idx(10, 4), 'company', 'blue');
  const st = makeState(b);
  assert.ok(R.legalMoves(st, idx(1, 0)).some((m) => m.to === idx(1, 1)));
});

test('bombFire: AI 剩余分布按 9 炸弹构成，不含军旗/工兵/地雷', () => {
  const st = S.createInitialState({ variant: C.VARIANTS.BOMB_FIRE });
  const { rem, totalUnrevealed } = AI.remainingDistribution(st);
  assert.strictEqual(totalUnrevealed, 50);
  assert.strictEqual(rem['bomb:red'], 9);
  assert.strictEqual(rem['bomb:blue'], 9);
  assert.strictEqual(rem['company:red'], 3);
  assert.strictEqual(rem['flag:red'], undefined);
  assert.strictEqual(rem['mine:red'], undefined);
  assert.strictEqual(rem['engineer:red'], undefined);
});

test('bombFire: AI 中档返回合法动作且不篡改输入局面', () => {
  const st = S.createInitialState({ variant: C.VARIANTS.BOMB_FIRE });
  const before = JSON.stringify(st.board);
  const action = AI.chooseMove(st, C.DIFFICULTY.MEDIUM, 'red');
  assert.ok(action, '应返回动作');
  assert.strictEqual(action.kind, 'flip', '开局全部暗子，只能翻棋');
  assert.strictEqual(JSON.stringify(st.board), before, 'AI 不得篡改输入局面');
});

test('bombFire: 记牌器口径 — 9 炸弹、其余特殊子为 0，阵亡按实际棋子扣减', () => {
  const st = S.createInitialState({ variant: C.VARIANTS.BOMB_FIRE });
  let t = UI.trackerData(st);
  assert.strictEqual(t.hidden.red.bomb, 9);
  assert.strictEqual(t.hidden.blue.bomb, 9);
  assert.strictEqual(t.hidden.red.flag, 0);
  assert.strictEqual(t.hidden.red.mine, 0);
  assert.strictEqual(t.hidden.red.engineer, 0);

  st.captured = { 'bomb:red': 2, 'commander:blue': 1 };
  t = UI.trackerData(st);
  assert.strictEqual(t.hidden.red.bomb, 7);
  assert.strictEqual(t.hidden.blue.commander, 0);
  assert.deepStrictEqual(t.lost.red, ['bomb', 'bomb']);
  assert.deepStrictEqual(t.lost.blue, ['commander']);
});
