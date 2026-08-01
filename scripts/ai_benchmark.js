// 军旗翻翻棋 — AI 自弈基准（开发用，不进 index.html）
// 模式：
//   node scripts/ai_benchmark.js [N]            → legacy：新 hard vs 最旧 hard（ai_old.js）
//   node scripts/ai_benchmark.js prev [N]       → 新 hard vs 上一版 hard（ai_prev.js），验收"quiesce 下放不退化"
//   node scripts/ai_benchmark.js master [N]     → 新 master vs 新 hard，验收"大师强于困难"
//   node scripts/ai_benchmark.js prevmaster [N] → 新 master vs 上一版 master，验收"大师本轮变强"
// 均先后手各半、种子化可复现。
// 指标：胜率、avg/max 每步毫秒、场均完成迭代深度、场均"大子被白吃/送死"。
'use strict';
const G = __dirname + '/../js/';
require(G + 'constants.js');
require(G + 'board.js');
require(G + 'rules.js');
require(G + 'state.js');
const C = Junqi.constants, R = Junqi.rules, S = Junqi.state;
require(__dirname + '/ai_old.js');       // 最旧版（master 强化前）
const oldAI = Junqi.ai;
require(__dirname + '/ai_prev.js');      // 上一版（本轮再强化前）
const prevAI = Junqi.ai;
require(G + 'ai.js');                    // 本轮新版（覆盖 Junqi.ai）
const newAI = Junqi.ai;

const MODE = isNaN(Number(process.argv[2])) ? (process.argv[2] || 'legacy') : 'legacy';
const MODES = {
  legacy:     { X: { name: 'hard新',   engine: newAI,  diff: C.DIFFICULTY.HARD   }, Y: { name: 'hard最旧', engine: oldAI,  diff: C.DIFFICULTY.HARD   } },
  prev:       { X: { name: 'hard新',   engine: newAI,  diff: C.DIFFICULTY.HARD   }, Y: { name: 'hard上一版', engine: prevAI, diff: C.DIFFICULTY.HARD   } },
  master:     { X: { name: 'master新', engine: newAI,  diff: C.DIFFICULTY.MASTER }, Y: { name: 'hard新',   engine: newAI,  diff: C.DIFFICULTY.HARD   } },
  prevmaster: { X: { name: 'master新', engine: newAI,  diff: C.DIFFICULTY.MASTER }, Y: { name: 'master上一版', engine: prevAI, diff: C.DIFFICULTY.MASTER } },
};
if (!MODES[MODE]) { console.error('未知模式: ' + MODE + '（可用：legacy/prev/master/prevmaster）'); process.exit(2); }
const N = Number(MODE === 'legacy' ? process.argv[2] : process.argv[3]) || { legacy: 60, prev: 30, master: 30, prevmaster: 40 }[MODE];
// 对战双方：X=被验收方，Y=对照方
const X = MODES[MODE].X, Y = MODES[MODE].Y;
const BIG = 45; // 大子阈值（旅长及以上）

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// 统计一次交战的两类大子损失：
// - gift：mover 拿自己的大子(≥BIG)去撞死/亏换（主动送死）
// - freeCap：mover 白吃了对方一枚大子(≥BIG)（对方"坐视被吃"）
function battleLosses(lm) {
  if (!lm || lm.kind !== 'move' || !lm.battle) return { gift: 0, freeCap: 0 };
  const vMover = C.PIECE_VALUE[lm.type] || 0;
  const vDef = C.PIECE_VALUE[lm.battle.type] || 0;
  const o = lm.battle.outcome; // win=攻击者胜 lose=攻击者亡 both=同归 flag=夺旗
  let gift = 0, freeCap = 0;
  if (vMover >= BIG && (o === 'lose' || (o === 'both' && vDef < vMover))) gift = 1;
  if (vDef >= BIG && o === 'win') freeCap = 1;
  return { gift, freeCap };
}

function playGame(sideA, sideB, seed) {
  const origRandom = Math.random;
  Math.random = mulberry32(seed);
  const stat = { msA: [], msB: [], depthA: [], depthB: [], giftA: 0, giftB: 0, freeCapA: 0, freeCapB: 0, winner: null, plies: 0 };
  try {
    const st = S.createInitialState();
    while (!st.winner && stat.plies < 400) {
      // 未定阵营：A 先翻（playerSide 由首次翻棋决定，之后 A=playerSide、B=aiSide）
      const cur = st.sidesAssigned ? (st.turn === st.playerSide ? sideA : sideB) : sideA;
      const isA = cur === sideA;
      const t0 = Date.now();
      const a = cur.engine.chooseMove(st, cur.diff, st.sidesAssigned ? st.turn : C.SIDES[0]);
      const dt = Date.now() - t0;
      (isA ? stat.msA : stat.msB).push(dt);
      if (cur.engine === newAI && typeof newAI.lastDepth === 'function') {
        (isA ? stat.depthA : stat.depthB).push(newAI.lastDepth());
      }
      if (!a) break;
      if (!S.applyMove(st, a)) break;
      stat.plies++;
      if (st.lastMove) {
        const moverIsA = st.lastMove.side === st.playerSide;
        const { gift, freeCap } = battleLosses(st.lastMove);
        if (moverIsA) { stat.giftA += gift; stat.freeCapB += freeCap; } // 被白吃的是防守方（对手）
        else { stat.giftB += gift; stat.freeCapA += freeCap; }
      }
    }
    stat.winner = st.winner;
    stat.playerSide = st.playerSide;
  } finally {
    Math.random = origRandom;
  }
  return stat;
}

const avg = (xs) => xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0;
const max = (xs) => xs.length ? Math.max(...xs) : 0;

let winsX = 0, winsY = 0, draws = 0, capped = 0;
const msX = [], msY = [], depthX = [], depthY = [];
let freeCapX = 0, freeCapY = 0, giftX = 0, giftY = 0, pliesTotal = 0;

for (let i = 0; i < N; i++) {
  const xFirst = i % 2 === 0; // 先后手各半
  const sideA = xFirst ? X : Y;
  const sideB = xFirst ? Y : X;
  const s = playGame(sideA, sideB, 1000 + i);
  const msXi = xFirst ? s.msA : s.msB, msYi = xFirst ? s.msB : s.msA;
  const dXi = xFirst ? s.depthA : s.depthB, dYi = xFirst ? s.depthB : s.depthA;
  msX.push(...msXi); msY.push(...msYi); depthX.push(...dXi); depthY.push(...dYi);
  const fcX = xFirst ? s.freeCapA : s.freeCapB, fcY = xFirst ? s.freeCapB : s.freeCapA;
  const gX = xFirst ? s.giftA : s.giftB, gY = xFirst ? s.giftB : s.giftA;
  freeCapX += fcX; freeCapY += fcY; giftX += gX; giftY += gY;
  pliesTotal += s.plies;
  let w = null;
  if (s.winner === 'draw') { draws++; w = 'draw'; }
  else if (s.winner === s.playerSide) w = 'A';
  else if (s.winner) w = 'B';
  else capped++; // 打满步数上限仍无胜负（不计入胜负与胜率分母）
  if (w === 'A') (xFirst ? winsX++ : winsY++);
  else if (w === 'B') (xFirst ? winsY++ : winsX++);
  const tag = w === 'draw' ? '和' : w === null ? '满' + s.plies + '步截断' : ((w === 'A') === xFirst ? X.name + '胜' : Y.name + '胜');
  console.log(`#${i + 1} seed=${1000 + i} ${xFirst ? X.name + '先手' : Y.name + '先手'} ${s.plies}步 ${tag}` +
    ` ${X.name}avg=${avg(msXi).toFixed(0)}ms ${Y.name}avg=${avg(msYi).toFixed(0)}ms 被白吃 ${X.name}${fcX}/${Y.name}${fcY}`);
}

const decided = winsX + winsY;
const wr = decided ? winsX / decided : 0;
console.log(`\n========== 汇总（${X.name} vs ${Y.name}）==========`);
console.log(`局数: ${N}（先后手各半）  总步数: ${pliesTotal}（场均 ${(pliesTotal / N).toFixed(0)}）`);
console.log(`胜负: ${X.name} ${winsX} 胜 / ${Y.name} ${winsY} 胜 / 和 ${draws} / 打满截断 ${capped}（合计 ${winsX + winsY + draws + capped}）` +
  (decided ? `  → ${X.name} 胜率(不计和与截断) ${(100 * wr).toFixed(1)}%` : ''));
console.log(`每步耗时: ${X.name} avg ${avg(msX).toFixed(0)}ms / max ${max(msX)}ms；${Y.name} avg ${avg(msY).toFixed(0)}ms / max ${max(msY)}ms`);
if (depthX.length) console.log(`场均完成迭代深度: ${X.name} ${avg(depthX).toFixed(1)}；${Y.name}${depthY.length ? ' ' + avg(depthY).toFixed(1) : '（旧版无此统计）'}`);
console.log(`大子(≥${BIG})被白吃: ${X.name} 场均 ${(freeCapX / N).toFixed(2)} / ${Y.name} 场均 ${(freeCapY / N).toFixed(2)}`);
console.log(`大子主动送死（仅参考）: ${X.name} 场均 ${(giftX / N).toFixed(2)} / ${Y.name} 场均 ${(giftY / N).toFixed(2)}`);

// 验收阈值（按模式）。capTol：「大子被白吃」对比的噪声容差——
// master vs hard 是跨风格对阵（master 主动进攻、交换更多），该指标差异 ±0.2 内属样本噪声，给 0.15 容差；
// 同族 A/B（legacy/prev/prevmaster）严格 ≤。
const THRESH = {
  legacy:     { minWR: 0.45, maxAvg: 900,  maxPeak: 1100, capTol: 0 },
  prev:       { minWR: 0.50, maxAvg: 900,  maxPeak: 1100, capTol: 0 }, // hard 下放 quiesce 后不回退
  master:     { minWR: 0.55, maxAvg: 1500, maxPeak: 3200, capTol: 0.15 },
  prevmaster: { minWR: 0.55, maxAvg: 1500, maxPeak: 3200, capTol: 0 },
}[MODE];
const minWR = THRESH.minWR, maxAvg = THRESH.maxAvg, maxPeak = THRESH.maxPeak;
console.log(`\n验收[${MODE}]: ${X.name} 胜率(不计和) ≥${minWR * 100}%；avg ≤${maxAvg}ms、max ≤${maxPeak}ms；大子被白吃场均 ≤ ${Y.name} + ${THRESH.capTol}。`);
const pass = (!decided || wr >= minWR) && avg(msX) <= maxAvg && max(msX) <= maxPeak && freeCapX <= freeCapY + THRESH.capTol;
console.log(pass ? 'RESULT: PASS ✅' : 'RESULT: 未达标 ❌（按方案调参顺序 ASPIRATION→qDelta→time/nodes 调整后重跑）');
process.exit(pass ? 0 : 1);
