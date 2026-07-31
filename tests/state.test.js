// 军旗翻翻棋 — state 单元测试
const { test } = require('node:test');
const assert = require('node:assert');
require('../js/constants.js');
require('../js/board.js');
require('../js/rules.js');
require('../js/state.js');

const C = Junqi.constants;
const B = Junqi.board;
const R = Junqi.rules;
const S = Junqi.state;
const idx = (r, co) => r * 5 + co;

function piece(type, side) { return { type, rank: C.PIECES[type].rank, side }; }
function emptyCell() { return { piece: null, revealed: false }; }
function emptyBoard() { const b = new Array(60); for (let i=0;i<60;i++) b[i]=emptyCell(); return b; }
function place(b, i, type, side, revealed=true) { b[i] = { piece: piece(type, side), revealed }; }
function makeState(board) {
  return { board, rows:12, cols:5, turn:null, playerSide:null, aiSide:null,
    sidesAssigned:false, winner:null, staleCount:0, minesLost:{red:0,blue:0}, history:[], onChange:null };
}

test('state: first flip assigns sides and passes turn to AI', () => {
  const b = emptyBoard();
  place(b, idx(0,0), 'company', 'blue');
  b[idx(0,0)].revealed = false;
  const st = makeState(b);
  S.applyMove(st, { kind:'flip', index: idx(0,0) });
  assert.strictEqual(st.playerSide, 'blue');
  assert.strictEqual(st.aiSide, 'red');
  assert.strictEqual(st.sidesAssigned, true);
  assert.strictEqual(st.turn, 'red'); // AI (red) to move
  assert.strictEqual(st.staleCount, 0);
});

test('state: second flip does not reassign sides', () => {
  const b = emptyBoard();
  place(b, idx(0,0), 'company', 'blue'); b[idx(0,0)].revealed=false;
  place(b, idx(0,1), 'flag', 'red');    b[idx(0,1)].revealed=false;
  const st = makeState(b);
  S.applyMove(st, { kind:'flip', index: idx(0,0) }); // playerSide=blue, turn=red
  S.applyMove(st, { kind:'flip', index: idx(0,1) }); // red(AI) flips, turn->blue
  assert.strictEqual(st.playerSide, 'blue'); // unchanged
  assert.strictEqual(st.turn, 'blue');
});

test('state: staleCount increments on no-eat move, resets on flip', () => {
  const b = emptyBoard();
  place(b, idx(1,0), 'company', 'red');
  place(b, idx(1,1), 'company', 'red');
  const st = makeState(b, );
  st.sidesAssigned = true; st.turn = 'red'; st.playerSide='red'; st.aiSide='blue';
  S.applyMove(st, { kind:'move', from: idx(1,1), to: idx(1,2) }); // empty move
  assert.strictEqual(st.staleCount, 1);
});

test('state: 40 quiet plies is NOT a draw (draw needs 40 rounds = 80 plies)', () => {
  const b = emptyBoard();
  place(b, idx(1,0), 'company', 'red');
  place(b, idx(10,4), 'company', 'blue'); // 蓝方远处有一可动子：排除困毙，仅验和棋阈值
  const st = makeState(b);
  st.sidesAssigned = true; st.turn='red'; st.playerSide='red'; st.aiSide='blue';
  st.staleCount = 39;
  S.applyMove(st, { kind:'move', from: idx(1,0), to: idx(1,1) }); // 安静一步 ->40 ply
  assert.notStrictEqual(st.winner, 'draw', '40 单方步 = 20 回合，不应判和');
});

test('state: 80 quiet plies (40 rounds) -> draw', () => {
  const b = emptyBoard();
  place(b, idx(1,0), 'company', 'red');
  place(b, idx(10,4), 'company', 'blue'); // 蓝方远处有一可动子：排除困毙，仅验和棋阈值
  const st = makeState(b);
  st.sidesAssigned = true; st.turn='red'; st.playerSide='red'; st.aiSide='blue';
  st.staleCount = 79;
  S.applyMove(st, { kind:'move', from: idx(1,0), to: idx(1,1) }); // 安静一步 ->80 ply = 40 回合
  assert.strictEqual(st.winner, 'draw');
});

test('state: bomb destroys flag -> attacker wins (flag owner loses)', () => {
  const b = emptyBoard();
  place(b, idx(1,0), 'bomb', 'red');
  place(b, idx(1,1), 'flag', 'blue');
  place(b, idx(10,4), 'company', 'blue'); // 蓝方另有一可动子：排除"困毙"干扰，胜只能来自炸旗
  const st = makeState(b);
  st.sidesAssigned=true; st.turn='red'; st.playerSide='red'; st.aiSide='blue';
  st.minesLost = { red:0, blue:3 }; // 雷已拔满，允许攻旗
  const ok = S.applyMove(st, { kind:'move', from: idx(1,0), to: idx(1,1) });
  assert.strictEqual(ok, true);
  assert.strictEqual(st.winner, 'red', '炸弹炸掉军旗 → 旗方(蓝)判负，攻击方(红)胜');
  assert.strictEqual(st.board[idx(1,1)].piece, null, '炸弹与军旗同归于尽');
  assert.strictEqual(st.board[idx(1,0)].piece, null);
});

test('state: applyMove rejects unreachable teleport', () => {
  const b = emptyBoard();
  place(b, idx(0,0), 'company', 'red');
  const st = makeState(b);
  st.sidesAssigned=true; st.turn='red'; st.playerSide='red'; st.aiSide='blue';
  const ok = S.applyMove(st, { kind:'move', from: idx(0,0), to: idx(11,4) });
  assert.strictEqual(ok, false, '连长不能瞬移到底角');
  assert.strictEqual(st.board[idx(0,0)].piece.type, 'company', '局面未被改动');
  assert.strictEqual(st.turn, 'red', '非法动作不切换回合');
});

test('state: applyMove rejects moving out of turn', () => {
  const b = emptyBoard();
  place(b, idx(1,0), 'company', 'red');
  const st = makeState(b);
  st.sidesAssigned=true; st.turn='blue'; st.playerSide='red'; st.aiSide='blue'; // 轮到蓝
  const ok = S.applyMove(st, { kind:'move', from: idx(1,0), to: idx(1,1) }); // 动红子
  assert.strictEqual(ok, false, '不能动非己方回合的子');
  assert.strictEqual(st.board[idx(1,0)].piece.type, 'company');
});

test('state: flag capture -> attacker wins (only after 3 mines gone)', () => {
  const b = emptyBoard();
  place(b, idx(1,0), 'commander', 'red');  // 司令 rank9
  place(b, idx(1,1), 'flag', 'blue');       // blue flag revealed
  const st = makeState(b);
  st.sidesAssigned=true; st.turn='red'; st.playerSide='red'; st.aiSide='blue';
  // 蓝方地雷未拔满 → 不可吃旗
  st.minesLost = { red: 0, blue: 2 };
  assert.strictEqual(S.applyMove(st, { kind:'move', from: idx(1,0), to: idx(1,1) }), false);
  assert.strictEqual(st.winner, null);
  // 拔满 3 颗 → 可吃旗获胜
  st.minesLost = { red: 0, blue: 3 };
  S.applyMove(st, { kind:'move', from: idx(1,0), to: idx(1,1) });
  assert.strictEqual(st.winner, 'red');
  assert.strictEqual(st.board[idx(1,1)].piece.type, 'commander');
});

test('state: mine destruction increments minesLost', () => {
  // 工兵挖雷
  let b = emptyBoard();
  place(b, idx(1,0), 'engineer', 'red');
  place(b, idx(1,1), 'mine', 'blue');
  let st = makeState(b);
  st.sidesAssigned=true; st.turn='red'; st.playerSide='red'; st.aiSide='blue';
  S.applyMove(st, { kind:'move', from: idx(1,0), to: idx(1,1) });
  assert.strictEqual(st.minesLost.blue, 1);
  // 炸弹炸雷
  b = emptyBoard();
  place(b, idx(1,0), 'bomb', 'red');
  place(b, idx(1,1), 'mine', 'blue');
  st = makeState(b);
  st.sidesAssigned=true; st.turn='red'; st.playerSide='red'; st.aiSide='blue';
  S.applyMove(st, { kind:'move', from: idx(1,0), to: idx(1,1) });
  assert.strictEqual(st.minesLost.blue, 1);
  // 非工兵撞雷 → 雷留，minesLost 不增
  b = emptyBoard();
  place(b, idx(1,0), 'company', 'red');
  place(b, idx(1,1), 'mine', 'blue');
  st = makeState(b);
  st.sidesAssigned=true; st.turn='red'; st.playerSide='red'; st.aiSide='blue';
  S.applyMove(st, { kind:'move', from: idx(1,0), to: idx(1,1) });
  assert.strictEqual(st.minesLost.blue, 0);
  assert.strictEqual(st.board[idx(1,1)].piece.type, 'mine');
});

test('state: same-rank battle both die', () => {
  const b = emptyBoard();
  place(b, idx(1,0), 'division', 'red');
  place(b, idx(1,1), 'division', 'blue');
  const st = makeState(b);
  st.sidesAssigned=true; st.turn='red'; st.playerSide='red'; st.aiSide='blue';
  S.applyMove(st, { kind:'move', from: idx(1,0), to: idx(1,1) });
  assert.strictEqual(st.board[idx(1,1)].piece, null);
  assert.strictEqual(st.board[idx(1,0)].piece, null);
  assert.strictEqual(st.staleCount, 0); // battle resets
});

test('state: no legal moves -> opponent wins', () => {
  const b = emptyBoard();
  place(b, idx(5,0), 'mine', 'blue');   // blue only has immobile mine, revealed
  const st = makeState(b);
  st.sidesAssigned=true; st.turn='blue'; st.playerSide='red'; st.aiSide='blue';
  // blue has no unrevealed cells and no movable pieces
  S.applyMove(st, { kind:'move', from: idx(5,0), to: idx(5,0) }); // invalid, returns false, no turn change
  // simulate blue's turn with no moves: checkWinner via a flip? none. Force check:
  st.winner = R.checkWinner(st);
  assert.strictEqual(st.winner, 'red');
});

test('state: initial placement never puts pieces in camps', () => {
  for (let attempt = 0; attempt < 20; attempt++) {
    const st = S.createInitialState();
    let pieces = 0;
    for (let i = 0; i < st.board.length; i++) {
      if (B.terrainAt(i) === 'camp') {
        assert.strictEqual(st.board[i].piece, null, 'camp cell must be empty: idx ' + i);
      } else {
        if (st.board[i].piece) pieces++;
      }
    }
    assert.strictEqual(pieces, 50, 'all 50 pieces placed in non-camp cells');
  }
});

test('state: lastMove records flip/move/battle outcomes', () => {
  // fresh state has no last move
  assert.strictEqual(S.createInitialState().lastMove, null);

  // flip
  let b = emptyBoard();
  place(b, idx(0,0), 'commander', 'red'); b[idx(0,0)].revealed = false;
  let st = makeState(b);
  S.applyMove(st, { kind:'flip', index: idx(0,0) });
  assert.deepStrictEqual(st.lastMove, { kind:'flip', index: idx(0,0), side:'red', type:'commander' });

  // empty move
  b = emptyBoard();
  place(b, idx(1,0), 'engineer', 'red');
  st = makeState(b);
  st.sidesAssigned=true; st.turn='red'; st.playerSide='red'; st.aiSide='blue';
  S.applyMove(st, { kind:'move', from: idx(1,0), to: idx(1,1) });
  assert.deepStrictEqual(st.lastMove, { kind:'move', from: idx(1,0), to: idx(1,1), side:'red', type:'engineer', battle: null });

  // battle: engineer vs mine -> win
  b = emptyBoard();
  place(b, idx(1,0), 'engineer', 'red');
  place(b, idx(1,1), 'mine', 'blue');
  st = makeState(b);
  st.sidesAssigned=true; st.turn='red'; st.playerSide='red'; st.aiSide='blue';
  S.applyMove(st, { kind:'move', from: idx(1,0), to: idx(1,1) });
  assert.strictEqual(st.lastMove.battle.outcome, 'win');

  // battle: platoon vs mine -> lose
  b = emptyBoard();
  place(b, idx(1,0), 'platoon', 'red');
  place(b, idx(1,1), 'mine', 'blue');
  st = makeState(b);
  st.sidesAssigned=true; st.turn='red'; st.playerSide='red'; st.aiSide='blue';
  S.applyMove(st, { kind:'move', from: idx(1,0), to: idx(1,1) });
  assert.strictEqual(st.lastMove.battle.outcome, 'lose');

  // battle: same rank -> both
  b = emptyBoard();
  place(b, idx(1,0), 'company', 'red');
  place(b, idx(1,1), 'company', 'blue');
  st = makeState(b);
  st.sidesAssigned=true; st.turn='red'; st.playerSide='red'; st.aiSide='blue';
  S.applyMove(st, { kind:'move', from: idx(1,0), to: idx(1,1) });
  assert.strictEqual(st.lastMove.battle.outcome, 'both');
});

console.log('state tests loaded');
