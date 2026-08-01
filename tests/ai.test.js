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

// ---- 确定性局面辅助（空格手摆：暗子=0、无 flip、无 chance 噪声）----
function emptyState(turn) {
  const st = S.createInitialState();
  for (let i = 0; i < st.board.length; i++) st.board[i] = { piece: null, revealed: false };
  st.sidesAssigned = true;
  st.playerSide = 'red'; st.aiSide = 'blue';
  st.turn = turn;
  return st;
}
function place(st, r, c, type, side, revealed = true) {
  st.board[idx(r, c)] = { piece: { type, rank: C.PIECES[type].rank, side }, revealed };
}
// side 方所有已翻子的攻击目标集合（只取占格目标=可攻击格；空格落点不算"攻击集"）
function attackSet(st, side) {
  const s = new Set();
  for (let i = 0; i < st.board.length; i++) {
    const c = st.board[i];
    if (c.piece && c.revealed && c.piece.side === side) {
      for (const m of R.legalMoves(st, i)) if (st.board[m.to].piece) s.add(m.to);
    }
  }
  return s;
}

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

// ============ T6：threatMapOf 原位威胁扫描 ============
test('ai: threatMapOf measures in-place threat and camp immunity', () => {
  // 红司令 (2,0) 威胁蓝军长 (3,0)（同在 col0 铁路，相邻）
  const st = emptyState('blue');
  place(st, 2, 0, 'commander', 'red');
  place(st, 3, 0, 'general', 'blue');
  const th = AI.threatMapOf(st, 'blue');
  assert.strictEqual(th.loss[idx(3, 0)], 80, '蓝军长被红司令吃 → 损失 valueOf(general)=80');
  assert.strictEqual(th.attacker[idx(3, 0)], 'commander');
  assert.ok(th.enemyMoves > 0, '敌方走法数应为正');
  // 行营免疫：蓝子进 (2,1) 行营后无威胁
  const st2 = emptyState('blue');
  place(st2, 2, 0, 'commander', 'red');
  place(st2, 2, 1, 'general', 'blue'); // [2,1] 是行营
  const th2 = AI.threatMapOf(st2, 'blue');
  assert.strictEqual(th2.loss[idx(2, 1)], 0, '行营内不可被攻击 → 威胁为 0');
});

test('ai: threatMapOf exchange values (同归与攻击者死)', () => {
  // 红炸弹 (1,1) 与蓝军长 (1,0) 相邻 → 同归：损失 = 80 - 35 = 45
  const st = emptyState('blue');
  place(st, 1, 1, 'bomb', 'red');
  place(st, 1, 0, 'general', 'blue');
  const th = AI.threatMapOf(st, 'blue');
  assert.strictEqual(th.loss[idx(1, 0)], 45, '炸弹同归：valueOf(军长)-valueOf(炸弹)=45');
  // 红排长 (5,2) 撞蓝司令 (5,3)：攻击者死 → 我方无损失 0
  const st2 = emptyState('blue');
  place(st2, 5, 2, 'platoon', 'red');
  place(st2, 5, 3, 'commander', 'blue');
  const th2 = AI.threatMapOf(st2, 'blue');
  assert.strictEqual(th2.loss[idx(5, 3)], 0, '敌方攻击者必死 → 我方损失 0');
});

// ============ T1：medium 被威胁大子逃入相邻行营 ============
test('ai: medium flees threatened big piece into a camp (T1)', () => {
  const st = emptyState('blue');
  place(st, 3, 0, 'general', 'blue');    // 蓝军长被威胁
  place(st, 2, 0, 'commander', 'red');   // 红司令正下方威胁 (3,0)（col0 铁路相邻）
  place(st, 8, 2, 'platoon', 'blue');    // 诱饵：蓝排长（行营子）可吃红工兵 +22
  place(st, 8, 3, 'engineer', 'red');
  const a = AI.chooseMove(st, C.DIFFICULTY.MEDIUM, 'blue');
  assert.ok(a && a.kind === 'move', 'should choose a move');
  assert.strictEqual(a.from, idx(3, 0), '必须移动被威胁的军长，而非坐视（修复前会去吃诱饵）');
  // (3,0) 斜邻两个行营 (2,1)/(4,1) 同分，任一皆正确
  assert.ok([idx(2, 1), idx(4, 1)].includes(a.to),
    '军长应逃入相邻行营（免疫），实际 to=' + a.to);
});

// ============ T2：hard 被威胁大子逃入相邻行营（搜索重构回归锁）============
test('ai: hard flees threatened big piece into a camp (T2)', () => {
  const st = emptyState('blue');
  place(st, 3, 0, 'general', 'blue');
  place(st, 2, 0, 'commander', 'red');
  place(st, 8, 2, 'platoon', 'blue');
  place(st, 8, 3, 'engineer', 'red');
  const t0 = Date.now();
  const a = AI.chooseMove(st, C.DIFFICULTY.HARD, 'blue');
  assert.ok(Date.now() - t0 < 10000, 'hard 应远快于 10s');
  assert.ok(a && a.kind === 'move' && a.from === idx(3, 0), 'hard 必须移动被威胁的军长');
  assert.ok([idx(2, 1), idx(4, 1)].includes(a.to), 'hard 逃入行营，实际 to=' + (a && a.to));
});

// ============ T5：evaluate 威胁项（提权 + 覆盖全部可动子）============
// 控制变量手法：己方子同格，只换威胁源位置（近=有威胁 / 远=无威胁），机动性差互相抵消
test('ai: evaluate threat term — weighted & covers all movable pieces (T5)', () => {
  // 大子：蓝军长同位 (3,0)，威胁源 (2,0) vs 无威胁 (2,3) → 差 ≈ 80×0.6 = 48（旧版仅 80×0.5 = 40）
  const a1 = emptyState('blue'); place(a1, 3, 0, 'general', 'blue'); place(a1, 2, 0, 'commander', 'red');
  const b1 = emptyState('blue'); place(b1, 3, 0, 'general', 'blue'); place(b1, 2, 3, 'commander', 'red');
  const d1 = AI.evaluate(b1, 'blue') - AI.evaluate(a1, 'blue');
  assert.ok(d1 > 40, '大子威胁扣分应提至 ≈48，实际 ' + d1.toFixed(1));
  // 分层权重（白盒）：覆盖小子与工兵拔雷资产
  assert.strictEqual(AI.threatWeight('general', 3), 0.6, '大子 0.6');
  assert.strictEqual(AI.threatWeight('platoon', 3), 0.15, '小子也覆盖（旧版 <45 不扣分）');
  assert.strictEqual(AI.threatWeight('engineer', 3), 0.5, '敌方有雷时工兵按拔雷资产抬高');
  assert.strictEqual(AI.threatWeight('engineer', 0), 0.15, '敌雷拔光后工兵回落小子权重');
});

// ============ evaluate 机动性 / 军旗防御 / 工兵拔雷 ============
test('ai: evaluate mobility — more legal moves scores higher', () => {
  // 同是无敌无威胁：蓝排长居铁路枢纽 (5,2) 走法多 vs 角落 (0,0) 走法少
  const a = emptyState('blue'); place(a, 5, 2, 'platoon', 'blue');
  const b = emptyState('blue'); place(b, 0, 0, 'platoon', 'blue');
  const d = AI.evaluate(a, 'blue') - AI.evaluate(b, 'blue');
  assert.ok(d > 1, '机动性高应加分，实际 ' + d.toFixed(2));
});

test('ai: evaluate flag defense — enemy near own flag penalized once mines lost', () => {
  // 蓝旗已翻 (11,2)：红子贴旗 (10,2) vs 红子远处 (0,0)
  const a = emptyState('blue'); place(a, 11, 2, 'flag', 'blue'); place(a, 10, 2, 'platoon', 'red');
  const b = emptyState('blue'); place(b, 11, 2, 'flag', 'blue'); place(b, 0, 0, 'platoon', 'red');
  a.minesLost.blue = 1; b.minesLost.blue = 1;
  const d = AI.evaluate(b, 'blue') - AI.evaluate(a, 'blue');
  assert.ok(d > 3, '雷破后敌子逼近己旗应被惩罚，实际 ' + d.toFixed(2));
  // 同一对局面但雷未破：防御项不触发 → 惩罚应显著变小（差值即纯防御项贡献）
  const a0 = emptyState('blue'); place(a0, 11, 2, 'flag', 'blue'); place(a0, 10, 2, 'platoon', 'red');
  const b0 = emptyState('blue'); place(b0, 11, 2, 'flag', 'blue'); place(b0, 0, 0, 'platoon', 'red');
  const d0 = AI.evaluate(b0, 'blue') - AI.evaluate(a0, 'blue');
  assert.ok(d - d0 > 3, '惩罚应来自防御项（雷破比雷未破多扣 ≥3），实际差 ' + (d - d0).toFixed(2));
});

test('ai: evaluate engineer mine-clearing incentive', () => {
  // 蓝工兵能立即吃红已翻雷 (1,1) vs 雷在远处 (3,3) 吃不到
  const a = emptyState('blue'); place(a, 1, 0, 'engineer', 'blue'); place(a, 1, 1, 'mine', 'red');
  const b = emptyState('blue'); place(b, 1, 0, 'engineer', 'blue'); place(b, 3, 3, 'mine', 'red');
  const d = AI.evaluate(a, 'blue') - AI.evaluate(b, 'blue');
  assert.ok(d > 3, '工兵能立即拔雷应加分，实际 ' + d.toFixed(2));
});

// ============ T3：medium 不主动送大子给更强者（铁路贯穿威胁）============
test('ai: medium moves threatened general to safety instead of bait capture (T3)', () => {
  const st = emptyState('blue');
  place(st, 5, 2, 'general', 'blue');    // 蓝军长：被红司令沿 R5 铁路贯穿威胁
  place(st, 5, 4, 'commander', 'red');
  place(st, 8, 2, 'company', 'blue');    // 诱饵：蓝连长（行营子）可吃红工兵 +22
  place(st, 8, 3, 'engineer', 'red');
  const redAttacks = attackSet(st, 'red');
  const a = AI.chooseMove(st, C.DIFFICULTY.MEDIUM, 'blue');
  assert.ok(a && a.kind === 'move' && a.from === idx(5, 2),
    '必须移动被威胁的军长（修复前会去吃诱饵），got ' + JSON.stringify(a));
  assert.ok(!redAttacks.has(a.to), '落点须安全（不在红方攻击集内），to=' + a.to);
});

// ============ T4：工兵有拔雷机会就去吃雷（medium + hard）============
test('ai: engineer takes revealed mine when available (T4)', () => {
  const st = emptyState('blue');
  place(st, 10, 0, 'engineer', 'blue');
  place(st, 10, 1, 'mine', 'red');   // 已翻地雷，工兵可立即挖
  place(st, 11, 4, 'flag', 'red');
  const m = AI.chooseMove(st, C.DIFFICULTY.MEDIUM, 'blue');
  assert.ok(m && m.kind === 'move' && m.from === idx(10, 0) && m.to === idx(10, 1),
    'medium 工兵应挖雷，got ' + JSON.stringify(m));
  const h = AI.chooseMove(st, C.DIFFICULTY.HARD, 'blue');
  assert.ok(h && h.kind === 'move' && h.from === idx(10, 0) && h.to === idx(10, 1),
    'hard 工兵应挖雷，got ' + JSON.stringify(h));
});

// ============ 大师档（master）============
test('ai: DIFFICULTY.MASTER exists and returns legal move', () => {
  assert.strictEqual(C.DIFFICULTY.MASTER, 'master');
  const st = midgameState();
  const t0 = Date.now();
  const a = AI.chooseMove(st, C.DIFFICULTY.MASTER, 'blue');
  assert.ok(Date.now() - t0 < 15000, 'master 应远快于 15s');
  assert.ok(a, 'master should return an action');
  assert.ok(isLegal(a, st, 'blue'), 'master action must be legal');
});

// 局面 D：蓝连长(0,1) 可吃红排长(0,2)，但吃后被红营长(0,3) 反吃 → 蓝无棋判负
test('ai: quiesce sees recapture that evaluate misses (whitebox A)', () => {
  const d = emptyState('blue');
  place(d, 0, 1, 'company', 'blue');
  place(d, 0, 2, 'platoon', 'red');
  place(d, 0, 3, 'battalion', 'red');
  // 局面 P：蓝连长已吃排长（蓝在 (0,2)，红先）
  const p = emptyState('red');
  place(p, 0, 2, 'company', 'blue');
  place(p, 0, 3, 'battalion', 'red');
  // 裸 evaluate 只见子力与弱权重威胁 → 看不出败势
  assert.ok(AI.evaluate(p, 'blue') > -50, 'evaluate 不应看出败局，实际 ' + AI.evaluate(p, 'blue'));
  // quiesce 展开红营长反吃 → 蓝无合法行动 → 红胜
  const q = AI.quiesce(p, 'blue', -Infinity, Infinity, 4);
  assert.ok(q < -90000, 'quiesce 应看出必败，实际 ' + q);
  // qleft=0 严格等于裸 evaluate（stand-pat）
  assert.strictEqual(AI.quiesce(p, 'blue', -Infinity, Infinity, 0), AI.evaluate(p, 'blue'));
  // 局面 D 上 quiesce：拒绝贪吃陷阱（不吃则子力 -12 左右，吃了是 -100000）
  assert.ok(AI.quiesce(d, 'blue', -Infinity, Infinity, 4) > -50, 'quiesce 应拒绝诱吃');
});

test('ai: master avoids bait capture at depth 1, hard preset takes it (behavior B)', () => {
  const st = emptyState('blue');
  place(st, 0, 1, 'company', 'blue');
  place(st, 0, 2, 'platoon', 'red');
  place(st, 0, 3, 'battalion', 'red');
  // hard 预置 maxDepth=1：裸 evaluate 叶子 → 贪吃排长
  const hardA = AI.chooseHard(st, 'blue', Object.assign({}, AI.PRESETS.hard, { maxDepth: 1 }));
  assert.ok(hardA && hardA.kind === 'move' && hardA.to === idx(0, 2),
    'hard(maxDepth=1) 应贪吃排长，got ' + JSON.stringify(hardA));
  // master 预置 maxDepth=1：quiesce 在叶子看出反吃 → 避开诱吃
  const masterA = AI.chooseHard(st, 'blue', Object.assign({}, AI.PRESETS.master, { maxDepth: 1 }));
  assert.ok(masterA && masterA.kind === 'move' && masterA.from === idx(0, 1) && masterA.to !== idx(0, 2),
    'master(maxDepth=1) 应避开诱吃，got ' + JSON.stringify(masterA));
});

test('ai: master regression locks (逃营 / 工兵挖雷 / 明显白吃)', () => {
  // 1) 逃营（同 T2 局面）
  const st = emptyState('blue');
  place(st, 3, 0, 'general', 'blue');
  place(st, 2, 0, 'commander', 'red');
  place(st, 8, 2, 'platoon', 'blue');
  place(st, 8, 3, 'engineer', 'red');
  let t0 = Date.now();
  const a = AI.chooseMove(st, C.DIFFICULTY.MASTER, 'blue');
  assert.ok(Date.now() - t0 < 5000, 'master <5s');
  assert.ok(a && a.kind === 'move' && a.from === idx(3, 0) && [idx(2, 1), idx(4, 1)].includes(a.to),
    'master 军长应逃入行营，got ' + JSON.stringify(a));

  // 2) 工兵挖雷（同 T4 局面）
  const st2 = emptyState('blue');
  place(st2, 10, 0, 'engineer', 'blue');
  place(st2, 10, 1, 'mine', 'red');
  place(st2, 11, 4, 'flag', 'red');
  t0 = Date.now();
  const m = AI.chooseMove(st2, C.DIFFICULTY.MASTER, 'blue');
  assert.ok(Date.now() - t0 < 5000, 'master <5s');
  assert.ok(m && m.kind === 'move' && m.from === idx(10, 0) && m.to === idx(10, 1),
    'master 工兵应挖雷，got ' + JSON.stringify(m));

  // 3) 明显白吃
  const st3 = emptyState('blue');
  place(st3, 1, 0, 'commander', 'blue');
  place(st3, 1, 1, 'platoon', 'red');
  t0 = Date.now();
  const c = AI.chooseMove(st3, C.DIFFICULTY.MASTER, 'blue');
  assert.ok(Date.now() - t0 < 5000, 'master <5s');
  assert.ok(c && c.kind === 'move' && c.from === idx(1, 0) && c.to === idx(1, 1),
    'master 司令应吃白吃的排长，got ' + JSON.stringify(c));
});

test('ai: evaluate rush term — press toward enemy flag once its mines are cleared', () => {
  // 红雷拔光 + 红旗已翻 (11,2)：蓝营长贴旗 (10,2) vs 远处 (0,0)
  const near = emptyState('blue'); place(near, 11, 2, 'flag', 'red'); place(near, 10, 2, 'battalion', 'blue');
  const far = emptyState('blue'); place(far, 11, 2, 'flag', 'red'); place(far, 0, 0, 'battalion', 'blue');
  near.minesLost.red = 3; far.minesLost.red = 3;
  const d = AI.evaluate(near, 'blue') - AI.evaluate(far, 'blue');
  assert.ok(d > 3, '贴近敌旗应获 rush 加分，实际 ' + d.toFixed(2));
  // 对照：雷未拔光 → 不触发（差异仅来自机动项 <3）
  const n0 = emptyState('blue'); place(n0, 11, 2, 'flag', 'red'); place(n0, 10, 2, 'battalion', 'blue');
  const f0 = emptyState('blue'); place(f0, 11, 2, 'flag', 'red'); place(f0, 0, 0, 'battalion', 'blue');
  n0.minesLost.red = 2; f0.minesLost.red = 2;
  assert.ok(Math.abs(AI.evaluate(n0, 'blue') - AI.evaluate(f0, 'blue')) < 3, '雷未拔光不应触发');
  // 诚实性：暗旗（未翻）→ 不触发
  const nh = emptyState('blue'); place(nh, 11, 2, 'flag', 'red', false); place(nh, 10, 2, 'battalion', 'blue');
  const fh = emptyState('blue'); place(fh, 11, 2, 'flag', 'red', false); place(fh, 0, 0, 'battalion', 'blue');
  nh.minesLost.red = 3; fh.minesLost.red = 3;
  assert.ok(Math.abs(AI.evaluate(nh, 'blue') - AI.evaluate(fh, 'blue')) < 3, '暗旗不应泄露位置');
});
