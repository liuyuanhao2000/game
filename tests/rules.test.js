// 军旗翻翻棋 — rules 单元测试（Node node:test，零依赖）
// 运行：node --test tests/rules.test.js
const { test } = require('node:test');
const assert = require('node:assert');

// 加载模块（顺序：constants → board → rules）
require('../js/constants.js');
require('../js/board.js');
require('../js/rules.js');

const B = Junqi.board;
const C = Junqi.constants;
const R = Junqi.rules;
const idx = (r, co) => r * 5 + co;

// ---- 测试辅助 ----
function piece(type, side) {
  return { type, rank: C.PIECES[type].rank, side };
}
function cell(p, revealed) { return { piece: p, revealed: !!revealed }; }
function emptyCell() { return { piece: null, revealed: false }; }
// 构造空棋盘（全部空格）
function emptyBoard() {
  const board = new Array(60);
  for (let i = 0; i < 60; i++) board[i] = emptyCell();
  return board;
}
// 在指定格放置已翻子
function place(board, i, p, side, revealed = true) {
  board[i] = cell(piece(p, side), revealed);
}
function makeState(board, extra = {}) {
  return Object.assign({
    board, rows: 12, cols: 5,
    turn: 'red', playerSide: null, sidesAssigned: false,
    winner: null, staleCount: 0, minesLost: { red: 0, blue: 0 }, history: [],
  }, extra);
}
function moveSet(moves) {
  return new Set(moves.map((m) => m.to));
}

// ============ A. 地形 ============
test('terrain: 10 camps are camp', () => {
  const camps = [[2,1],[2,3],[3,2],[4,1],[4,3],[7,1],[7,3],[8,2],[9,1],[9,3]];
  for (const [r,c] of camps) assert.strictEqual(B.terrainAt(idx(r,c)), 'camp');
});
test('terrain: R2 all railway, R1/R12 all normal', () => {
  for (let c=0;c<5;c++){
    assert.strictEqual(B.terrainAt(idx(1,c)), 'railway');
    assert.strictEqual(B.terrainAt(idx(0,c)), 'normal');
    assert.strictEqual(B.terrainAt(idx(11,c)), 'normal');
  }
});
test('terrain: camp overrides railway row (R3C2 is camp not railway)', () => {
  assert.strictEqual(B.terrainAt(idx(2,1)), 'camp');
});
test('terrain: C1 vertical rail does not reach R1', () => {
  assert.strictEqual(B.terrainAt(idx(0,0)), 'normal');
});

// ============ B. 楚河邻接 ============
test('river: C2/C4 blocked across R6-R7', () => {
  assert.strictEqual(B.isAdjacent(idx(5,1), idx(6,1)), false); // C2
  assert.strictEqual(B.isAdjacent(idx(5,3), idx(6,3)), false); // C4
});
test('river: C1/C3/C5 open across R6-R7', () => {
  assert.strictEqual(B.isAdjacent(idx(5,0), idx(6,0)), true);  // C1
  assert.strictEqual(B.isAdjacent(idx(5,2), idx(6,2)), true);  // C3
  assert.strictEqual(B.isAdjacent(idx(5,4), idx(6,4)), true);  // C5
});
test('diag: plum edges', () => {
  assert.strictEqual(B.isDiagAdjacent(idx(2,1), idx(3,2)), true);
  assert.strictEqual(B.isDiagAdjacent(idx(2,1), idx(3,1)), false);
  assert.strictEqual(B.isDiagAdjacent(idx(3,2), idx(4,3)), true);
});

// ============ C. legalMoves 普通一步 + 楚河 ============
test('moves: river blocks downward crossing at C2 (R6C2 is railway cell)', () => {
  const b = emptyBoard();
  place(b, idx(5,1), 'company', 'red'); // R6C2 (railway row)
  const st = makeState(b);
  const ms = moveSet(R.legalMoves(st, idx(5,1)));
  // down across river to R7C2 must be blocked (both 1-step orth and straight scan)
  assert.ok(!ms.has(idx(6,1)), 'cannot cross river at C2');
  // horizontal railway moves along R6 still work
  assert.ok(ms.has(idx(5,0))); // left R6C1
  assert.ok(ms.has(idx(5,2))); // right R6C3
});
test('moves: normal 1-step no river at R5C3 (non-camp interior)', () => {
  const b = emptyBoard();
  place(b, idx(4,2), 'company', 'red'); // R5C3 normal interior, not camp
  const st = makeState(b);
  const ms = moveSet(R.legalMoves(st, idx(4,2)));
  assert.ok(ms.has(idx(3,2))); // up R4C3
  assert.ok(ms.has(idx(5,2))); // down R6C3
  assert.ok(ms.has(idx(4,1))); // left R5C2
  assert.ok(ms.has(idx(4,3))); // right R5C4
  assert.strictEqual(ms.size, 4);
});

// ============ D. 铁路直线多步 ============
test('moves: railway straight-line scan (旅长 at R2C1)', () => {
  const b = emptyBoard();
  place(b, idx(1,0), 'brigade', 'red'); // R2C1
  const st = makeState(b);
  const ms = moveSet(R.legalMoves(st, idx(1,0)));
  // right along R2: idx(1,1),(1,2),(1,3),(1,4)
  assert.ok(ms.has(idx(1,1)));
  assert.ok(ms.has(idx(1,4)));
  // down along C1: idx(2,0),(3,0),(4,0),(5,0)
  assert.ok(ms.has(idx(2,0)));
  assert.ok(ms.has(idx(5,0)));
  // up: idx(0,0) is normal (not railway) -> scan stops, but 1-step off-rail to idx(0,0) allowed via step-off?
  //   idx(0,0) is normal neighbor of idx(1,0): normal 1-step covers it
  assert.ok(ms.has(idx(0,0)));
});

// ============ E. 工兵 BFS 转弯 ============
test('moves: engineer BFS turning, river respected', () => {
  const b = emptyBoard();
  place(b, idx(1,0), 'engineer', 'red'); // R2C1
  const st = makeState(b);
  const ms = moveSet(R.legalMoves(st, idx(1,0)));
  // R6C2 (idx(5,1)) reachable via rail (turn through network)
  assert.ok(ms.has(idx(5,1)), 'engineer should reach R6C2 by turning');
  // R7C1 (idx(6,0)) reachable by crossing river at C1 (open)
  assert.ok(ms.has(idx(6,0)), 'engineer can cross river at C1');
  // R7C2 (idx(6,1)) reachable via detour: cross at C1 then walk R7 row
  // (river only blocks the DIRECT C2 crossing; detour via C1/C3/C5 is intended)
  assert.ok(ms.has(idx(6,1)), 'engineer reaches R7C2 via C1 detour');
  // engineer reaches far railway cell R11C5 (idx(10,4))
  assert.ok(ms.has(idx(10,4)), 'engineer reaches whole connected railway graph');
});

test('moves: non-engineer straight scan cannot cross river at C2', () => {
  const b = emptyBoard();
  place(b, idx(5,1), 'brigade', 'red'); // R6C2 (railway)
  const st = makeState(b);
  const ms = moveSet(R.legalMoves(st, idx(5,1)));
  // straight down to R7C2 blocked by river; must detour (non-engineer can't turn)
  assert.ok(!ms.has(idx(6,1)), 'non-engineer cannot cross river at C2 directly');
  // but can reach R7C2? no — would need turning through R6C1->R7C1->R7C2 (a turn, not straight)
  assert.ok(!ms.has(idx(6,1)));
  // can move along R6 row (straight): R6C1, R6C3, R6C4, R6C5
  assert.ok(ms.has(idx(5,0)));
  assert.ok(ms.has(idx(5,4)));
});

// ============ F. 行营免疫 ============
test('moves: occupied camp unattackable, empty camp enterable', () => {
  const b = emptyBoard();
  place(b, idx(2,0), 'company', 'red');   // R3C1 railway, adjacent to camp R3C2(idx(2,1))
  // camp occupied by revealed blue
  place(b, idx(2,1), 'platoon', 'blue');
  let st = makeState(b);
  let ms = moveSet(R.legalMoves(st, idx(2,0)));
  assert.ok(!ms.has(idx(2,1)), 'cannot attack into occupied camp');
  // camp empty -> enterable
  b[idx(2,1)] = emptyCell();
  st = makeState(b);
  ms = moveSet(R.legalMoves(st, idx(2,0)));
  assert.ok(ms.has(idx(2,1)), 'can enter empty camp');
});
test('moves: piece inside camp can move out', () => {
  const b = emptyBoard();
  place(b, idx(2,1), 'company', 'red'); // camp R3C2
  const st = makeState(b);
  const ms = moveSet(R.legalMoves(st, idx(2,1)));
  assert.ok(ms.has(idx(2,0))); // out to R3C1
  assert.ok(ms.has(idx(2,2))); // out to R3C3
});

// ============ G. 梅花斜路 ============
test('moves: plum diagonal outer->center empty', () => {
  const b = emptyBoard();
  place(b, idx(2,1), 'company', 'red'); // outer camp R3C2
  const st = makeState(b);
  const ms = moveSet(R.legalMoves(st, idx(2,1)));
  assert.ok(ms.has(idx(3,2)), 'diagonal to center camp R4C3');
});
test('moves: plum diagonal blocked when center camp occupied (camp immunity)', () => {
  const b = emptyBoard();
  place(b, idx(2,1), 'company', 'red');
  place(b, idx(3,2), 'platoon', 'blue'); // center camp occupied
  const st = makeState(b);
  const ms = moveSet(R.legalMoves(st, idx(2,1)));
  assert.ok(!ms.has(idx(3,2)), 'cannot diagonal-attack into occupied camp');
});
test('moves: no diagonal from non-camp cell', () => {
  const b = emptyBoard();
  place(b, idx(2,2), 'company', 'red'); // R3C3 normal
  const st = makeState(b);
  const ms = moveSet(R.legalMoves(st, idx(2,2)));
  // no diagonal moves at all (only orth 1-step + railway if applicable)
  for (const to of ms) {
    const [r,c] = B.rc(to);
    assert.ok(Math.abs(r-2)+Math.abs(c-2) === 1 || B.isRailway(to), 'no diagonal from non-camp');
  }
});

test('moves: camp piece moves 8 directions (4 orth + 4 diag)', () => {
  const b = emptyBoard();
  place(b, idx(3,2), 'company', 'red'); // center camp R4C3 (idx17)
  const st = makeState(b);
  const ms = moveSet(R.legalMoves(st, idx(3,2)));
  // 4 orth
  assert.ok(ms.has(idx(2,2))); // up
  assert.ok(ms.has(idx(4,2))); // down
  assert.ok(ms.has(idx(3,1))); // left
  assert.ok(ms.has(idx(3,3))); // right
  // 4 diag
  assert.ok(ms.has(idx(2,1))); // up-left (outer camp)
  assert.ok(ms.has(idx(2,3))); // up-right (outer camp)
  assert.ok(ms.has(idx(4,1))); // down-left (outer camp)
  assert.ok(ms.has(idx(4,3))); // down-right (outer camp)
  assert.strictEqual(ms.size, 8, 'camp piece should have 8 directional moves');
});

test('moves: outer camp piece gains diagonal moves beyond plum-X', () => {
  const b = emptyBoard();
  place(b, idx(2,1), 'company', 'red'); // outer camp R3C2
  const st = makeState(b);
  const ms = moveSet(R.legalMoves(st, idx(2,1)));
  // plum-X diagonal to center camp still present
  assert.ok(ms.has(idx(3,2)));
  // plus 3 other diagonal directions to non-camp cells
  assert.ok(ms.has(idx(1,0)), 'up-left to railway');
  assert.ok(ms.has(idx(1,2)), 'up-right to railway');
  assert.ok(ms.has(idx(3,0)), 'down-left to railway');
});

test('moves: plum diagonal is reversible (non-camp -> camp)', () => {
  // 从行营 [2,1] 可斜走左下到 [3,0]（非行营），且能从 [3,0] 斜走回 [2,1]
  const b1 = emptyBoard();
  place(b1, idx(2,1), 'company', 'red'); // 行营 R3C2
  const st1 = makeState(b1);
  const ms1 = moveSet(R.legalMoves(st1, idx(2,1)));
  assert.ok(ms1.has(idx(3,0)), 'camp -> down-left non-camp diagonal');

  const b2 = emptyBoard();
  place(b2, idx(3,0), 'company', 'red'); // 非行营格，但与行营 [2,1] 斜邻
  const st2 = makeState(b2);
  const ms2 = moveSet(R.legalMoves(st2, idx(3,0)));
  assert.ok(ms2.has(idx(2,1)), 'non-camp -> camp diagonal (reversible)');

  // 关键回归：即便 [2,0]（铁路换乘格）被占，斜路仍应直达行营 [2,1]
  const b3 = emptyBoard();
  place(b3, idx(3,0), 'company', 'red');
  place(b3, idx(2,0), 'platoon', 'blue'); // 堵住铁路→[2,1] 的换乘路径
  const st3 = makeState(b3);
  const ms3 = moveSet(R.legalMoves(st3, idx(3,0)));
  assert.ok(ms3.has(idx(2,1)), 'direct diagonal to camp even when rail disembark blocked');

  // 行营外的对角邻居只对「与行营斜邻」的方向有斜路，其它对角方向不应生出斜走
  // [3,0] 的对角邻居：[2,1](行营)、[4,1](行营) 合法；[2,-1]、[4,-1] 越界
  for (const to of ms2) {
    const [r, c] = B.rc(to);
    const diag = Math.abs(r - 3) === 1 && Math.abs(c) === 1;
    if (diag) assert.ok(B.terrainAt(to) === 'camp', 'non-camp diagonal only targets camps');
  }
});

// ============ H. 不可移动 ============
test('moves: mine and flag immobile', () => {
  const b = emptyBoard();
  place(b, idx(5,0), 'mine', 'red');
  place(b, idx(5,1), 'flag', 'red');
  const st = makeState(b);
  assert.strictEqual(R.legalMoves(st, idx(5,0)).length, 0);
  assert.strictEqual(R.legalMoves(st, idx(5,1)).length, 0);
});

test('moves: flag protected until 3 enemy mines gone', () => {
  const b = emptyBoard();
  place(b, idx(1,0), 'commander', 'red');   // 司令
  place(b, idx(1,1), 'flag', 'blue');        // 蓝旗已翻
  // 蓝方仅拔 2 雷 → 不可吃旗
  let st = makeState(b, { minesLost: { red: 0, blue: 2 } });
  let ms = moveSet(R.legalMoves(st, idx(1,0)));
  assert.ok(!ms.has(idx(1,1)), 'flag protected while mines remain');
  // 拔满 3 雷 → 可吃旗
  st = makeState(b, { minesLost: { red: 0, blue: 3 } });
  ms = moveSet(R.legalMoves(st, idx(1,0)));
  assert.ok(ms.has(idx(1,1)), 'flag attackable once all mines gone');
});

// ============ I. 阻挡与视线 ============
test('moves: own unrevealed piece blocks railway line', () => {
  const b = emptyBoard();
  place(b, idx(1,0), 'brigade', 'red');     // R2C1
  place(b, idx(1,2), 'company', 'red');     // R2C3 own, unrevealed? set revealed true (own)
  b[idx(1,2)].revealed = true;
  const st = makeState(b);
  const ms = moveSet(R.legalMoves(st, idx(1,0)));
  assert.ok(!ms.has(idx(1,2)), 'own piece blocks');
  assert.ok(!ms.has(idx(1,3)), 'beyond own piece blocked');
  assert.ok(ms.has(idx(1,1)), 'cell before blocker reachable');
});
test('moves: revealed enemy on railway is attack target and blocks beyond', () => {
  const b = emptyBoard();
  place(b, idx(1,0), 'brigade', 'red');      // 旅长 rank6
  place(b, idx(1,2), 'platoon', 'blue');     // 排长 rank2 revealed
  const st = makeState(b);
  const ms = moveSet(R.legalMoves(st, idx(1,0)));
  assert.ok(ms.has(idx(1,2)), 'can attack revealed enemy');
  assert.ok(!ms.has(idx(1,3)), 'cannot go past enemy');
});

// ============ J. resolveBattle 全分支 ============
function battle(att, def) { return R.resolveBattle(piece(att,'red'), piece(def,'blue')); }

test('battle: big eats small', () => {
  const r = battle('commander','general'); // 9 vs 8
  assert.strictEqual(r.to.piece.type, 'commander');
  assert.strictEqual(r.from, null);
  assert.strictEqual(r.flagCaptured, false);
});
test('battle: same rank both die', () => {
  const r = battle('division','division'); // 7 vs 7
  assert.strictEqual(r.to, null);
  assert.strictEqual(r.from, null);
});
test('battle: engineer defuses mine', () => {
  const r = battle('engineer','mine');
  assert.strictEqual(r.to.piece.type, 'engineer');
  assert.strictEqual(r.flagCaptured, false);
});
test('battle: non-engineer hits mine, mine stays', () => {
  const r = battle('company','mine');
  assert.strictEqual(r.to.piece.type, 'mine');
  assert.strictEqual(r.from, null);
});
test('battle: bomb vs anything both die', () => {
  const r = battle('bomb','general');
  assert.strictEqual(r.to, null);
  assert.strictEqual(r.from, null);
});
test('battle: bomb vs mine both die', () => {
  const r = battle('bomb','mine');
  assert.strictEqual(r.to, null);
  assert.strictEqual(r.from, null);
});
test('battle: capture flag', () => {
  const r = battle('commander','flag');
  assert.strictEqual(r.to.piece.type, 'commander');
  assert.strictEqual(r.flagCaptured, true);
});
test('battle: smaller attacker dies, defender stays', () => {
  const r = battle('engineer','commander'); // 1 vs 9
  assert.strictEqual(r.to.piece.type, 'commander');
  assert.strictEqual(r.from, null);
});
test('battle: bomb vs flag destroys flag (flagCaptured) -> flag owner loses', () => {
  const r = battle('bomb','flag');
  assert.strictEqual(r.from, null);
  assert.strictEqual(r.to, null, '炸弹与军旗同归于尽');
  assert.strictEqual(r.flagCaptured, true, '军旗被炸毁应判旗方负');
});

// ============ K. hasAnyLegalMove ============
test('hasAnyLegalMove: unrevealed cell counts as move', () => {
  const b = emptyBoard();
  place(b, idx(0,0), 'flag', 'blue');
  b[idx(0,0)].revealed = false; // unrevealed -> flippable
  const st = makeState(b, { turn: 'red' });
  assert.strictEqual(R.hasAnyLegalMove(st, 'red'), true);
});
test('hasAnyLegalMove: no pieces -> false', () => {
  const b = emptyBoard();
  const st = makeState(b, { turn: 'blue' });
  assert.strictEqual(R.hasAnyLegalMove(st, 'blue'), false);
});

// ============ L. 铁路离轨须独立一步（不得滑行后同步离轨）============
test('moves: railway slide cannot disembark in the same move', () => {
  const b = emptyBoard();
  place(b, idx(1,0), 'brigade', 'red'); // 旅长 R2C1（铁路）
  const st = makeState(b);
  const ms = moveSet(R.legalMoves(st, idx(1,0)));
  // 沿 R2 滑到 R2C4 后再离轨落到 R3C4 行营（idx(2,3)）——应为两步，非法
  assert.ok(!ms.has(idx(2,3)), 'cannot slide along rail then step off in one move');
  // 沿 C1 滑到 R6C1 后再离轨落到 R6C2（idx(5,1)，非铁路）——同样非法
  assert.ok(!ms.has(idx(5,1)), 'no same-move disembark from a reached rail cell');
  // 但从「当前格」离轨一步仍合法：R1C1（idx(0,0)，普通格）是 (1,0) 的正交邻居
  assert.ok(ms.has(idx(0,0)), 'stepping off the current rail cell is a normal 1-step move');
  // 铁路上的滑行落点仍然合法
  assert.ok(ms.has(idx(1,4)), 'can still slide along the railway');
});

// ============ M. checkWinner 优先级：无路可走 > 和棋 ============
test('checkWinner: no-moves loss takes priority over stale-draw', () => {
  const b = emptyBoard();
  place(b, idx(5,0), 'mine', 'blue'); // 蓝方仅剩一颗不可动的地雷（已翻）
  const st = makeState(b, { turn: 'blue', staleCount: C.STALE_LIMIT });
  // 即使困局计数到顶，蓝方无路可走应判蓝负（红胜），而非和棋
  assert.strictEqual(R.checkWinner(st), 'red');
});

console.log('rules tests loaded');
