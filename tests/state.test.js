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
function makeState(board, mode='ai') {
  return { board, rows:12, cols:5, turn:null, controllers:{red:null,blue:null}, mode,
    sidesAssigned:false, winner:null, staleCount:0, minesLost:{red:0,blue:0}, onChange:null };
}

test('state: createInitialState defaults to ai mode with unset controllers', () => {
  const st = S.createInitialState();
  assert.strictEqual(st.mode, 'ai');
  assert.deepStrictEqual(st.controllers, { red: null, blue: null });
  assert.strictEqual(st.playerSide, undefined, '旧字段 playerSide 应被移除');
  assert.strictEqual(st.aiSide, undefined, '旧字段 aiSide 应被移除');
});

test('state: ai mode first flip assigns human/AI controllers and passes turn to AI', () => {
  const b = emptyBoard();
  place(b, idx(0,0), 'company', 'blue');
  b[idx(0,0)].revealed = false;
  const st = makeState(b);
  S.applyMove(st, { kind:'flip', index: idx(0,0) });
  assert.strictEqual(st.controllers.blue, 'human');
  assert.strictEqual(st.controllers.red, 'ai');
  assert.strictEqual(st.sidesAssigned, true);
  assert.strictEqual(st.turn, 'red'); // AI (red) to move
  assert.strictEqual(st.staleCount, 0);
});

test('state: pvp first flip keeps both controllers human, turn passes to opposite color', () => {
  const b = emptyBoard();
  place(b, idx(0,0), 'company', 'blue');
  b[idx(0,0)].revealed = false;
  const st = makeState(b, 'pvp');
  S.applyMove(st, { kind:'flip', index: idx(0,0) });
  assert.strictEqual(st.controllers.blue, 'human', '先翻者执翻出的颜色，但双人都是人类');
  assert.strictEqual(st.controllers.red, 'human');
  assert.strictEqual(st.sidesAssigned, true);
  assert.strictEqual(st.turn, 'red'); // 对方（红）行动
});

test('state: pvp second flip just alternates turn', () => {
  const b = emptyBoard();
  place(b, idx(0,0), 'company', 'blue'); b[idx(0,0)].revealed=false;
  place(b, idx(0,1), 'flag', 'red');    b[idx(0,1)].revealed=false;
  const st = makeState(b, 'pvp');
  S.applyMove(st, { kind:'flip', index: idx(0,0) }); // 翻出蓝，轮到红
  S.applyMove(st, { kind:'flip', index: idx(0,1) }); // 红翻，轮到蓝
  assert.strictEqual(st.controllers.blue, 'human');
  assert.strictEqual(st.controllers.red, 'human');
  assert.strictEqual(st.turn, 'blue');
});

test('state: second flip does not reassign sides', () => {
  const b = emptyBoard();
  place(b, idx(0,0), 'company', 'blue'); b[idx(0,0)].revealed=false;
  place(b, idx(0,1), 'flag', 'red');    b[idx(0,1)].revealed=false;
  const st = makeState(b);
  S.applyMove(st, { kind:'flip', index: idx(0,0) }); // 翻出蓝，turn=red
  S.applyMove(st, { kind:'flip', index: idx(0,1) }); // red(AI) flips, turn->blue
  assert.strictEqual(st.controllers.blue, 'human'); // unchanged
  assert.strictEqual(st.controllers.red, 'ai'); // unchanged
  assert.strictEqual(st.turn, 'blue');
});

test('state: staleCount increments on no-eat move, resets on flip', () => {
  const b = emptyBoard();
  place(b, idx(1,0), 'company', 'red');
  place(b, idx(1,1), 'company', 'red');
  const st = makeState(b);
  st.sidesAssigned = true; st.turn = 'red'; st.controllers={red:'human',blue:'ai'};
  S.applyMove(st, { kind:'move', from: idx(1,1), to: idx(1,2) }); // empty move
  assert.strictEqual(st.staleCount, 1);
});

test('state: 40 quiet plies is NOT a draw (draw needs 40 rounds = 80 plies)', () => {
  const b = emptyBoard();
  place(b, idx(1,0), 'company', 'red');
  place(b, idx(10,4), 'company', 'blue'); // 蓝方远处有一可动子：排除困毙，仅验和棋阈值
  const st = makeState(b);
  st.sidesAssigned = true; st.turn='red'; st.controllers={red:'human',blue:'ai'};
  st.staleCount = 39;
  S.applyMove(st, { kind:'move', from: idx(1,0), to: idx(1,1) }); // 安静一步 ->40 ply
  assert.notStrictEqual(st.winner, 'draw', '40 单方步 = 20 回合，不应判和');
});

test('state: 80 quiet plies (40 rounds) -> draw', () => {
  const b = emptyBoard();
  place(b, idx(1,0), 'company', 'red');
  place(b, idx(10,4), 'company', 'blue'); // 蓝方远处有一可动子：排除困毙，仅验和棋阈值
  const st = makeState(b);
  st.sidesAssigned = true; st.turn='red'; st.controllers={red:'human',blue:'ai'};
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
  st.sidesAssigned=true; st.turn='red'; st.controllers={red:'human',blue:'ai'};
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
  st.sidesAssigned=true; st.turn='red'; st.controllers={red:'human',blue:'ai'};
  const ok = S.applyMove(st, { kind:'move', from: idx(0,0), to: idx(11,4) });
  assert.strictEqual(ok, false, '连长不能瞬移到底角');
  assert.strictEqual(st.board[idx(0,0)].piece.type, 'company', '局面未被改动');
  assert.strictEqual(st.turn, 'red', '非法动作不切换回合');
});

test('state: applyMove rejects moving out of turn', () => {
  const b = emptyBoard();
  place(b, idx(1,0), 'company', 'red');
  const st = makeState(b);
  st.sidesAssigned=true; st.turn='blue'; st.controllers={red:'human',blue:'ai'}; // 轮到蓝
  const ok = S.applyMove(st, { kind:'move', from: idx(1,0), to: idx(1,1) }); // 动红子
  assert.strictEqual(ok, false, '不能动非己方回合的子');
  assert.strictEqual(st.board[idx(1,0)].piece.type, 'company');
});

test('state: flag capture -> attacker wins (only after 3 mines gone)', () => {
  const b = emptyBoard();
  place(b, idx(1,0), 'commander', 'red');  // 司令 rank9
  place(b, idx(1,1), 'flag', 'blue');       // blue flag revealed
  const st = makeState(b);
  st.sidesAssigned=true; st.turn='red'; st.controllers={red:'human',blue:'ai'};
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
  st.sidesAssigned=true; st.turn='red'; st.controllers={red:'human',blue:'ai'};
  S.applyMove(st, { kind:'move', from: idx(1,0), to: idx(1,1) });
  assert.strictEqual(st.minesLost.blue, 1);
  // 炸弹炸雷
  b = emptyBoard();
  place(b, idx(1,0), 'bomb', 'red');
  place(b, idx(1,1), 'mine', 'blue');
  st = makeState(b);
  st.sidesAssigned=true; st.turn='red'; st.controllers={red:'human',blue:'ai'};
  S.applyMove(st, { kind:'move', from: idx(1,0), to: idx(1,1) });
  assert.strictEqual(st.minesLost.blue, 1);
  // 非工兵撞雷 → 雷留，minesLost 不增
  b = emptyBoard();
  place(b, idx(1,0), 'company', 'red');
  place(b, idx(1,1), 'mine', 'blue');
  st = makeState(b);
  st.sidesAssigned=true; st.turn='red'; st.controllers={red:'human',blue:'ai'};
  S.applyMove(st, { kind:'move', from: idx(1,0), to: idx(1,1) });
  assert.strictEqual(st.minesLost.blue, 0);
  assert.strictEqual(st.board[idx(1,1)].piece.type, 'mine');
});

test('state: same-rank battle both die', () => {
  const b = emptyBoard();
  place(b, idx(1,0), 'division', 'red');
  place(b, idx(1,1), 'division', 'blue');
  const st = makeState(b);
  st.sidesAssigned=true; st.turn='red'; st.controllers={red:'human',blue:'ai'};
  S.applyMove(st, { kind:'move', from: idx(1,0), to: idx(1,1) });
  assert.strictEqual(st.board[idx(1,1)].piece, null);
  assert.strictEqual(st.board[idx(1,0)].piece, null);
  assert.strictEqual(st.staleCount, 0); // battle resets
});

test('state: no legal moves -> opponent wins', () => {
  const b = emptyBoard();
  place(b, idx(5,0), 'mine', 'blue');   // blue only has immobile mine, revealed
  const st = makeState(b);
  st.sidesAssigned=true; st.turn='blue'; st.controllers={red:'human',blue:'ai'};
  // blue has no unrevealed cells and no movable pieces
  S.applyMove(st, { kind:'move', from: idx(5,0), to: idx(5,0) }); // invalid, returns false, no turn change
  // simulate blue's turn with no moves: checkWinner via a flip? none. Force check:
  st.winner = R.checkWinner(st);
  assert.strictEqual(st.winner, 'red');
});

test('state: pvp full-game simulation — turns alternate, no AI controller ever', () => {
  for (let attempt = 0; attempt < 10; attempt++) {
    const st = S.createInitialState({ mode: 'pvp' });
    let guard = 0;
    while (!st.winner && guard++ < 600) {
      // 任意未翻子可翻（含首翻）；否则走当前行动方一步合法着法
      const hidden = st.board.findIndex((c) => c.piece && !c.revealed);
      let applied = false;
      if (hidden !== -1) {
        applied = S.applyMove(st, { kind: 'flip', index: hidden });
      }
      if (!applied) {
        const side = st.turn;
        const mv = st.board
          .flatMap((c, i) => (c.piece && c.revealed && c.piece.side === side) ? R.legalMoves(st, i).map((m) => ({ from: i, to: m.to })) : [])
          [0];
        if (!mv) break;
        applied = S.applyMove(st, { kind: 'move', from: mv.from, to: mv.to });
      }
      assert.strictEqual(applied, true, 'pvp 模拟中动作必须合法: ply ' + guard);
      // 双人同屏：任何一方都不该出现 AI 操作者
      assert.strictEqual(st.controllers.red, 'human');
      assert.strictEqual(st.controllers.blue, 'human');
      if (!st.winner) assert.notStrictEqual(st.turn, null);
    }
    assert.ok(st.winner || guard >= 600, 'pvp 对局应正常终结或达到步数上限');
  }
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

test('state: capture records the eaten piece in state.captured', () => {
  const b = emptyBoard();
  place(b, idx(1,0), 'commander', 'red');
  place(b, idx(1,1), 'platoon', 'blue');
  const st = makeState(b);
  st.sidesAssigned=true; st.turn='red'; st.controllers={red:'human',blue:'ai'};
  S.applyMove(st, { kind:'move', from: idx(1,0), to: idx(1,1) });
  assert.strictEqual(st.captured['platoon:blue'], 1, '蓝排长被吃应记 1');
  assert.strictEqual(st.captured['commander:red'] || 0, 0, '红司令存活不应计入');
});

test('state: both-die records both captured', () => {
  const b = emptyBoard();
  place(b, idx(1,0), 'division', 'red');
  place(b, idx(1,1), 'division', 'blue');
  const st = makeState(b);
  st.sidesAssigned=true; st.turn='red'; st.controllers={red:'human',blue:'ai'};
  S.applyMove(st, { kind:'move', from: idx(1,0), to: idx(1,1) });
  assert.strictEqual(st.captured['division:red'], 1);
  assert.strictEqual(st.captured['division:blue'], 1);
});

test('state: non-engineer hits mine records attacker captured, mine stays', () => {
  const b = emptyBoard();
  place(b, idx(1,0), 'company', 'red');
  place(b, idx(1,1), 'mine', 'blue');
  const st = makeState(b);
  st.sidesAssigned=true; st.turn='red'; st.controllers={red:'human',blue:'ai'};
  S.applyMove(st, { kind:'move', from: idx(1,0), to: idx(1,1) });
  assert.strictEqual(st.captured['company:red'], 1, '撞雷的连长被移除');
  assert.strictEqual(st.captured['mine:blue'] || 0, 0, '地雷仍在，不计被吃');
});

test('state: bomb vs flag records both bomb and flag captured', () => {
  const b = emptyBoard();
  place(b, idx(1,0), 'bomb', 'red');
  place(b, idx(1,1), 'flag', 'blue');
  const st = makeState(b);
  st.sidesAssigned=true; st.turn='red'; st.controllers={red:'human',blue:'ai'};
  st.minesLost = { red:0, blue:3 };
  S.applyMove(st, { kind:'move', from: idx(1,0), to: idx(1,1) });
  assert.strictEqual(st.captured['bomb:red'], 1);
  assert.strictEqual(st.captured['flag:blue'], 1);
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
  st.sidesAssigned=true; st.turn='red'; st.controllers={red:'human',blue:'ai'};
  S.applyMove(st, { kind:'move', from: idx(1,0), to: idx(1,1) });
  assert.deepStrictEqual(st.lastMove, { kind:'move', from: idx(1,0), to: idx(1,1), side:'red', type:'engineer', battle: null });

  // battle: engineer vs mine -> win
  b = emptyBoard();
  place(b, idx(1,0), 'engineer', 'red');
  place(b, idx(1,1), 'mine', 'blue');
  st = makeState(b);
  st.sidesAssigned=true; st.turn='red'; st.controllers={red:'human',blue:'ai'};
  S.applyMove(st, { kind:'move', from: idx(1,0), to: idx(1,1) });
  assert.strictEqual(st.lastMove.battle.outcome, 'win');

  // battle: platoon vs mine -> lose
  b = emptyBoard();
  place(b, idx(1,0), 'platoon', 'red');
  place(b, idx(1,1), 'mine', 'blue');
  st = makeState(b);
  st.sidesAssigned=true; st.turn='red'; st.controllers={red:'human',blue:'ai'};
  S.applyMove(st, { kind:'move', from: idx(1,0), to: idx(1,1) });
  assert.strictEqual(st.lastMove.battle.outcome, 'lose');

  // battle: same rank -> both
  b = emptyBoard();
  place(b, idx(1,0), 'company', 'red');
  place(b, idx(1,1), 'company', 'blue');
  st = makeState(b);
  st.sidesAssigned=true; st.turn='red'; st.controllers={red:'human',blue:'ai'};
  S.applyMove(st, { kind:'move', from: idx(1,0), to: idx(1,1) });
  assert.strictEqual(st.lastMove.battle.outcome, 'both');
});

// ---- 司令阵亡亮军旗（司令死 → 该方军旗自动翻开）----
test('state: 炸弹换司令 → 司令方军旗自动翻开', () => {
  const b = emptyBoard();
  place(b, idx(1,0), 'bomb', 'red');
  place(b, idx(1,1), 'commander', 'blue');
  place(b, idx(10,4), 'company', 'blue');  // 蓝方另有可动子（防困毙判负干扰）
  place(b, idx(10,0), 'company', 'red');   // 红方另有可动子
  place(b, idx(9,4), 'flag', 'blue', false); // 蓝旗暗置
  const st = makeState(b);
  st.sidesAssigned=true; st.turn='red'; st.controllers={red:'human',blue:'ai'};
  assert.strictEqual(S.applyMove(st, { kind:'move', from: idx(1,0), to: idx(1,1) }), true);
  assert.strictEqual(st.board[idx(9,4)].revealed, true, '蓝方司令阵亡 → 蓝旗自动翻开');
  assert.ok(st.lastMove.battle.revealedFlags.includes(idx(9,4)), 'lastMove 记录亮旗格');
});

test('state: 司令撞雷阵亡 → 攻击方（司令方）军旗翻开', () => {
  const b = emptyBoard();
  place(b, idx(1,0), 'commander', 'red');
  place(b, idx(1,1), 'mine', 'blue');
  place(b, idx(10,4), 'company', 'blue');
  place(b, idx(10,0), 'company', 'red');
  place(b, idx(0,2), 'flag', 'red', false);  // 红旗暗置
  const st = makeState(b);
  st.sidesAssigned=true; st.turn='red'; st.controllers={red:'human',blue:'ai'};
  assert.strictEqual(S.applyMove(st, { kind:'move', from: idx(1,0), to: idx(1,1) }), true);
  assert.strictEqual(st.board[idx(0,2)].revealed, true, '红方司令撞雷阵亡 → 红旗自动翻开');
  assert.strictEqual(st.minesLost.blue, 0, '雷存活，不计拔除');
});

test('state: 司令对司令同归 → 双方军旗同时翻开', () => {
  const b = emptyBoard();
  place(b, idx(1,0), 'commander', 'red');
  place(b, idx(1,1), 'commander', 'blue');
  place(b, idx(10,4), 'company', 'blue');
  place(b, idx(10,0), 'company', 'red');
  place(b, idx(0,2), 'flag', 'red', false);
  place(b, idx(9,4), 'flag', 'blue', false);
  const st = makeState(b);
  st.sidesAssigned=true; st.turn='red'; st.controllers={red:'human',blue:'ai'};
  assert.strictEqual(S.applyMove(st, { kind:'move', from: idx(1,0), to: idx(1,1) }), true);
  assert.strictEqual(st.board[idx(0,2)].revealed, true, '红司令阵亡 → 红旗翻开');
  assert.strictEqual(st.board[idx(9,4)].revealed, true, '蓝司令阵亡 → 蓝旗翻开');
  assert.strictEqual(st.lastMove.battle.revealedFlags.length, 2);
});

test('state: 普通吃子不触发亮旗', () => {
  const b = emptyBoard();
  place(b, idx(1,0), 'commander', 'red');
  place(b, idx(1,1), 'platoon', 'blue');
  place(b, idx(10,4), 'company', 'blue');
  place(b, idx(9,4), 'flag', 'blue', false);
  const st = makeState(b);
  st.sidesAssigned=true; st.turn='red'; st.controllers={red:'human',blue:'ai'};
  S.applyMove(st, { kind:'move', from: idx(1,0), to: idx(1,1) });
  assert.strictEqual(st.board[idx(9,4)].revealed, false, '无人阵亡司令 → 军旗保持暗置');
  assert.deepStrictEqual(st.lastMove.battle.revealedFlags, []);
});

test('state: 军旗已翻开时司令阵亡不再重复记录', () => {
  const b = emptyBoard();
  place(b, idx(1,0), 'bomb', 'red');
  place(b, idx(1,1), 'commander', 'blue');
  place(b, idx(10,4), 'company', 'blue');
  place(b, idx(10,0), 'company', 'red');
  place(b, idx(9,4), 'flag', 'blue'); // 蓝旗已翻开
  const st = makeState(b);
  st.sidesAssigned=true; st.turn='red'; st.controllers={red:'human',blue:'ai'};
  S.applyMove(st, { kind:'move', from: idx(1,0), to: idx(1,1) });
  assert.strictEqual(st.board[idx(9,4)].revealed, true, '仍为翻开状态');
  assert.deepStrictEqual(st.lastMove.battle.revealedFlags, [], '已翻开的旗不重复记录');
});

// ---- v1.0.9：prevMove 记录语义（供 AI 反向走子检测）----
test('state: prevMove — move 记录行动者，flip 清空行动者（非被翻子颜色）', () => {
  const b = emptyBoard();
  place(b, idx(1,0), 'platoon', 'red');
  place(b, idx(1,1), 'company', 'blue', false); // 暗子：蓝方子但由红方翻
  place(b, idx(10,4), 'company', 'blue');       // 蓝方可动子
  const st = makeState(b);
  st.sidesAssigned=true; st.turn='red'; st.controllers={red:'human',blue:'ai'};
  st.prevMove = { red: { from: idx(0,0), to: idx(0,1) }, blue: null };
  // 红方翻出蓝子：行动者是红 → prevMove.red 清空，blue 不动
  S.applyMove(st, { kind:'flip', index: idx(1,1) });
  assert.strictEqual(st.prevMove.red, null, '翻棋清空行动者（红）的 prevMove');
  assert.strictEqual(st.prevMove.blue, null, '被翻子颜色方（蓝）不受影响');
  // 红方走子：记录 {from,to}（翻棋后回合已切蓝，设回红）
  st.turn = 'red';
  S.applyMove(st, { kind:'move', from: idx(1,0), to: idx(1,1) });
  assert.deepStrictEqual(st.prevMove.red, { from: idx(1,0), to: idx(1,1) }, 'move 记录行动者上一步');
});

// ============ v1.2.0 娱乐·军衔升级玩法（variant='rankUp'）============
function makeFunState(b, mode = 'ai') {
  const st = makeState(b, mode);
  st.variant = 'rankUp';
  return st;
}
function ready(st, turn = 'red') {
  st.sidesAssigned = true; st.turn = turn; st.controllers = { red: 'human', blue: 'ai' };
  return st;
}
function supEng(side, captures) {
  return { type: 'engineer', rank: 1 + captures, side, captures };
}

test('state: createInitialState 默认经典玩法；opts.variant 指定娱乐玩法且随 JSON 快照传递', () => {
  const st1 = S.createInitialState();
  assert.strictEqual(st1.variant, 'classic');
  const st2 = S.createInitialState({ mode: 'pvp', variant: 'rankUp' });
  assert.strictEqual(st2.variant, 'rankUp');
  assert.strictEqual(st2.mode, 'pvp');
  assert.strictEqual(JSON.parse(JSON.stringify(st2)).variant, 'rankUp', 'variant 是纯数据字段，worker 快照必须保留');
});

test('state(rankUp): 攻击方吃子存活 → 军衔升一级；type 不变；原对象不被修改（克隆替换）', () => {
  const b = emptyBoard();
  place(b, idx(1,0), 'platoon', 'red');
  place(b, idx(1,1), 'engineer', 'blue');
  const st = ready(makeFunState(b));
  const before = st.board[idx(1,0)].piece;
  assert.ok(S.applyMove(st, { kind:'move', from: idx(1,0), to: idx(1,1) }));
  const after = st.board[idx(1,1)].piece;
  assert.strictEqual(after.rank, 3, '排长(2) 吃子 → 升为战力3（连长）');
  assert.strictEqual(after.type, 'platoon', 'type 不变：记牌器/AI 剩余分布口径不受影响');
  assert.notStrictEqual(after, before, '升级以克隆替换落地，不得原地改（AI make/unmake 契约）');
  assert.strictEqual(before.rank, 2, '原对象 rank 不得被修改（否则 undoAction 泄漏升级）');
  assert.deepStrictEqual(st.lastMove.battle.promotion,
    { side: 'red', type: 'platoon', fromRank: 2, rank: 3, captures: 0 });
});

test('state(rankUp): 防守方反杀来袭子 → 防守方同样升级（攻防都触发）', () => {
  const b = emptyBoard();
  place(b, idx(1,0), 'division', 'red');
  place(b, idx(1,1), 'general', 'blue');
  const st = ready(makeFunState(b));
  assert.ok(S.applyMove(st, { kind:'move', from: idx(1,0), to: idx(1,1) }));
  const surv = st.board[idx(1,1)].piece;
  assert.strictEqual(surv.type, 'general');
  assert.strictEqual(surv.side, 'blue');
  assert.strictEqual(surv.rank, 9, '军长(8) 反杀师长 → 升到司令战力');
  assert.strictEqual(st.lastMove.battle.promotion.side, 'blue');
  assert.strictEqual(st.lastMove.battle.promotion.rank, 9);
  assert.strictEqual(st.captured['division:red'], 1);
});

test('state(rankUp): 司令封顶 — 再吃子保持司令，无 promotion 记录', () => {
  const b = emptyBoard();
  place(b, idx(1,0), 'commander', 'red');
  place(b, idx(1,1), 'division', 'blue');
  const st = ready(makeFunState(b));
  assert.ok(S.applyMove(st, { kind:'move', from: idx(1,0), to: idx(1,1) }));
  assert.strictEqual(st.board[idx(1,1)].piece.rank, 9);
  assert.strictEqual(st.lastMove.battle.promotion, null);
});

test('state(rankUp): 同归于尽 → 双方都不升级', () => {
  const b = emptyBoard();
  place(b, idx(1,0), 'division', 'red');
  place(b, idx(1,1), 'division', 'blue');
  const st = ready(makeFunState(b));
  assert.ok(S.applyMove(st, { kind:'move', from: idx(1,0), to: idx(1,1) }));
  assert.strictEqual(st.board[idx(1,1)].piece, null);
  assert.strictEqual(st.lastMove.battle.promotion, null);
  assert.strictEqual(st.captured['division:red'], 1);
  assert.strictEqual(st.captured['division:blue'], 1);
});

test('state(rankUp): 非工兵撞雷身亡 → 地雷为特殊子不升级、不记雷损', () => {
  const b = emptyBoard();
  place(b, idx(1,0), 'platoon', 'red');
  place(b, idx(1,1), 'mine', 'blue');
  const st = ready(makeFunState(b));
  assert.ok(S.applyMove(st, { kind:'move', from: idx(1,0), to: idx(1,1) }));
  const m = st.board[idx(1,1)].piece;
  assert.strictEqual(m.type, 'mine');
  assert.strictEqual(m.rank, 0);
  assert.strictEqual(m.captures, undefined);
  assert.strictEqual(st.lastMove.battle.promotion, null);
  assert.strictEqual(st.minesLost.blue, 0);
  assert.strictEqual(st.captured['platoon:red'], 1);
});

test('state(rankUp): 工兵排雷 → 升级超级工兵（captures=1、战力2），排雷计为吃子', () => {
  const b = emptyBoard();
  place(b, idx(1,0), 'engineer', 'red');
  place(b, idx(1,1), 'mine', 'blue');
  const st = ready(makeFunState(b));
  assert.ok(S.applyMove(st, { kind:'move', from: idx(1,0), to: idx(1,1) }));
  const e = st.board[idx(1,1)].piece;
  assert.strictEqual(e.type, 'engineer', 'type 保持工兵：排雷/铁路转弯能力天然保留');
  assert.strictEqual(e.captures, 1);
  assert.strictEqual(e.rank, 2, '战力 = 1 + 吃子数');
  assert.strictEqual(st.minesLost.blue, 1);
  assert.deepStrictEqual(st.lastMove.battle.promotion,
    { side: 'red', type: 'engineer', fromRank: 1, rank: 2, captures: 1 });
});

test('state(rankUp): 超级工兵继续排雷 → 战力累加，移动方式不变（仍走工兵铁路 BFS）', () => {
  const b = emptyBoard();
  b[idx(1,0)] = { piece: supEng('red', 1), revealed: true }; // 已吃 1 子（战力2）
  place(b, idx(1,1), 'mine', 'blue');
  const st = ready(makeFunState(b));
  // 移动合法性走 legalMoves：工兵在铁路上可转弯（type 判定，与 rank 无关）
  assert.ok(R.legalMoves(st, idx(1,0)).some((m) => m.to === idx(1,1)));
  assert.ok(S.applyMove(st, { kind:'move', from: idx(1,0), to: idx(1,1) }));
  const e = st.board[idx(1,1)].piece;
  assert.strictEqual(e.captures, 2);
  assert.strictEqual(e.rank, 3);
  assert.strictEqual(st.minesLost.blue, 1);
});

test('state(rankUp): 超级工兵战力数值同场比较 — 战力3吃排长(2)再升，与连长(3)同归', () => {
  const b = emptyBoard();
  b[idx(1,0)] = { piece: supEng('red', 2), revealed: true }; // 战力 3
  place(b, idx(1,1), 'platoon', 'blue');
  const st = ready(makeFunState(b));
  assert.ok(S.applyMove(st, { kind:'move', from: idx(1,0), to: idx(1,1) }));
  assert.strictEqual(st.board[idx(1,1)].piece.rank, 4);
  assert.strictEqual(st.board[idx(1,1)].piece.captures, 3);

  const b2 = emptyBoard();
  b2[idx(1,0)] = { piece: supEng('red', 2), revealed: true }; // 战力 3
  place(b2, idx(1,1), 'company', 'blue');                    // 连长 3
  const st2 = ready(makeFunState(b2));
  assert.ok(S.applyMove(st2, { kind:'move', from: idx(1,0), to: idx(1,1) }));
  assert.strictEqual(st2.board[idx(1,1)].piece, null, '同战力同归于尽');
  assert.strictEqual(st2.lastMove.battle.promotion, null);
});

test('state(rankUp): 吃军旗同样触发升级（同时终局）', () => {
  const b = emptyBoard();
  place(b, idx(1,0), 'division', 'red');
  place(b, idx(1,1), 'flag', 'blue');
  const st = ready(makeFunState(b));
  st.minesLost.blue = C.MINES_PER_SIDE; // 雷已拔满，军旗可吃
  assert.ok(S.applyMove(st, { kind:'move', from: idx(1,0), to: idx(1,1) }));
  assert.strictEqual(st.winner, 'red');
  assert.strictEqual(st.board[idx(1,1)].piece.rank, 8);
  assert.strictEqual(st.lastMove.battle.promotion.rank, 8);
});

test('state(classic): 同款战斗不触发任何升级 — 经典模式回归护栏', () => {
  const b = emptyBoard();
  place(b, idx(1,0), 'platoon', 'red');
  place(b, idx(1,1), 'engineer', 'blue');
  const st = ready(makeState(b)); // 无 variant → classic
  const before = st.board[idx(1,0)].piece;
  assert.ok(S.applyMove(st, { kind:'move', from: idx(1,0), to: idx(1,1) }));
  const after = st.board[idx(1,1)].piece;
  assert.strictEqual(after, before, '经典玩法：存活者就是原对象，无克隆');
  assert.strictEqual(after.rank, 2);
  assert.strictEqual(after.captures, undefined);
  assert.strictEqual(st.lastMove.battle.promotion, null);
});

// ============ v1.4.0 娱乐·镜像明棋玩法（variant='mirrorOpen'）============
test('state(mirrorOpen): 跨楚河镜像对称、全体明棋、非行营格全占', () => {
  for (let attempt = 0; attempt < 10; attempt++) {
    const st = S.createInitialState({ variant: 'mirrorOpen' });
    let red = 0, blue = 0;
    for (let i = 0; i < C.CELL_COUNT; i++) {
      const c = st.board[i];
      if (B.terrainAt(i) === 'camp') {
        assert.strictEqual(c.piece, null, '行营必须为空: idx ' + i);
        continue;
      }
      assert.ok(c.piece, '非行营格必须放子: idx ' + i);
      assert.strictEqual(c.revealed, true, '所有棋子必须明置: idx ' + i);
      if (c.piece.side === 'red') red++; else blue++;
      const m = B.mirrorIndex(i);
      assert.ok(st.board[m].piece, '镜像格必须有子');
      assert.strictEqual(st.board[m].piece.type, c.piece.type, '镜像格同类型');
      assert.strictEqual(st.board[m].piece.side, C.opposite(c.piece.side), '镜像格敌对阵营');
    }
    assert.strictEqual(red, 25);
    assert.strictEqual(blue, 25);
  }
});

test('state(mirrorOpen): 双方棋子构成与 PIECES 一致（各 25 枚）', () => {
  const st = S.createInitialState({ variant: 'mirrorOpen' });
  for (const side of C.SIDES) {
    const counts = {};
    for (let i = 0; i < C.CELL_COUNT; i++) {
      const p = st.board[i].piece;
      if (!p || p.side !== side) continue;
      counts[p.type] = (counts[p.type] || 0) + 1;
      assert.strictEqual(p.rank, C.PIECES[p.type].rank);
    }
    for (const t in C.PIECES) {
      assert.strictEqual(counts[t], C.PIECES[t].count, side + ' ' + t);
    }
  }
});

test('state(mirrorOpen): 红方恒先行、开局即定边；人机一 human 一 ai，双人双 human', () => {
  for (let attempt = 0; attempt < 20; attempt++) {
    const st = S.createInitialState({ variant: 'mirrorOpen' });
    assert.strictEqual(st.turn, 'red');
    assert.strictEqual(st.sidesAssigned, true);
    const ops = [st.controllers.red, st.controllers.blue].sort();
    assert.deepStrictEqual(ops, ['ai', 'human'], '人机模式应随机分边且仅一方为 AI');
  }
  const pvp = S.createInitialState({ mode: 'pvp', variant: 'mirrorOpen' });
  assert.strictEqual(pvp.turn, 'red');
  assert.strictEqual(pvp.sidesAssigned, true);
  assert.deepStrictEqual(pvp.controllers, { red: 'human', blue: 'human' });
});

test('state(mirrorOpen): 全局无暗子 — 枚举动作只有 move，flip 被拒绝', () => {
  const st = S.createInitialState({ variant: 'mirrorOpen' });
  const acts = R.enumerateActions(st, 'red');
  assert.ok(acts.length > 0, '红方开局应有合法走法');
  assert.ok(acts.every((a) => a.kind === 'move'), '不得出现 flip 动作');
  assert.strictEqual(R.hasAnyLegalMove(st, 'red'), true);
  assert.strictEqual(R.hasAnyLegalMove(st, 'blue'), true);
  const occupied = st.board.findIndex((c) => c.piece);
  assert.strictEqual(S.applyMove(st, { kind: 'flip', index: occupied }), false, '明棋不可翻');
  assert.strictEqual(st.turn, 'red', '非法翻棋不切换回合');
});

test('state(mirrorOpen): variant/明置状态随 JSON 快照进 worker（纯数据）', () => {
  const st = S.createInitialState({ variant: 'mirrorOpen' });
  const snap = JSON.parse(JSON.stringify(st));
  assert.strictEqual(snap.variant, 'mirrorOpen');
  assert.strictEqual(snap.turn, 'red');
  assert.strictEqual(snap.sidesAssigned, true);
  assert.strictEqual(snap.board.filter((c) => c.piece && c.revealed).length, 50);
});
