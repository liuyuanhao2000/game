// 军旗翻翻棋 — AI 自弈基准（开发用，不进 index.html）
// 新 hard vs 旧 hard（scripts/ai_old.js），N 局先后手各半，种子化可复现。
// 运行：node scripts/ai_benchmark.js [N]
// 指标：胜率、avg/max 每步毫秒、场均"己方≥45 大子被吃/送死"次数。
'use strict';
const G = __dirname + '/../js/';
require(G + 'constants.js');
require(G + 'board.js');
require(G + 'rules.js');
require(G + 'state.js');
const C = Junqi.constants, R = Junqi.rules, S = Junqi.state;
require(__dirname + '/ai_old.js');       // 先加载旧版
const oldAI = Junqi.ai;
require(G + 'ai.js');                    // 再加载新版（覆盖 Junqi.ai）
const newAI = Junqi.ai;

const N = Number(process.argv[2]) || 60;
const HARD = C.DIFFICULTY.HARD;
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
// - freeCap：mover 白吃了对方一枚大子(≥BIG)（对方"坐视被吃"——本次加强的核心问题）
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

function playGame(engineA, engineB, seed) {
  const origRandom = Math.random;
  Math.random = mulberry32(seed);
  const stat = { msA: [], msB: [], giftA: 0, giftB: 0, freeCapA: 0, freeCapB: 0, winner: null, plies: 0 };
  try {
    const st = S.createInitialState();
    while (!st.winner && stat.plies < 400) {
      // 未定阵营：engineA 先翻（playerSide 由首次翻棋决定，之后 A=playerSide、B=aiSide）
      const engine = st.sidesAssigned ? (st.turn === st.playerSide ? engineA : engineB) : engineA;
      const who = engine === engineA ? 'A' : 'B';
      const t0 = Date.now();
      const a = engine.chooseMove(st, HARD, st.sidesAssigned ? st.turn : C.SIDES[0]);
      const dt = Date.now() - t0;
      (who === 'A' ? stat.msA : stat.msB).push(dt);
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

let winsNew = 0, winsOld = 0, draws = 0;
const msNew = [], msOld = [];
let freeCapNew = 0, freeCapOld = 0, giftNew = 0, giftOld = 0, pliesTotal = 0;

for (let i = 0; i < N; i++) {
  const newFirst = i % 2 === 0; // 先后手各半
  const engineA = newFirst ? newAI : oldAI;
  const engineB = newFirst ? oldAI : newAI;
  const s = playGame(engineA, engineB, 1000 + i);
  const msN = newFirst ? s.msA : s.msB, msO = newFirst ? s.msB : s.msA;
  msNew.push(...msN); msOld.push(...msO);
  const fcN = newFirst ? s.freeCapA : s.freeCapB, fcO = newFirst ? s.freeCapB : s.freeCapA;
  const gN = newFirst ? s.giftA : s.giftB, gO = newFirst ? s.giftB : s.giftA;
  freeCapNew += fcN; freeCapOld += fcO; giftNew += gN; giftOld += gO;
  pliesTotal += s.plies;
  let w = null;
  if (s.winner === 'draw') { draws++; w = 'draw'; }
  else if (s.winner === s.playerSide) w = 'A';
  else if (s.winner) w = 'B';
  if (w === 'A') (newFirst ? winsNew++ : winsOld++);
  else if (w === 'B') (newFirst ? winsOld++ : winsNew++);
  const tag = w === 'draw' ? '和' : ((w === 'A') === newFirst ? '新胜' : '旧胜');
  console.log(`#${i + 1} seed=${1000 + i} ${newFirst ? '新先手' : '旧先手'} ${s.plies}步 ${tag}` +
    ` 新avg=${avg(msN).toFixed(0)}ms 旧avg=${avg(msO).toFixed(0)}ms 大子被白吃 新${fcN}/旧${fcO} 送死 新${gN}/旧${gO}`);
}

const decided = winsNew + winsOld;
console.log('\n========== 汇总（新 hard vs 旧 hard）==========');
console.log(`局数: ${N}（先后手各半）  总步数: ${pliesTotal}（场均 ${(pliesTotal / N).toFixed(0)}）`);
console.log(`胜负: 新 ${winsNew} 胜 / 旧 ${winsOld} 胜 / 和 ${draws}` +
  (decided ? `  → 新胜率(不计和) ${(100 * winsNew / decided).toFixed(1)}%` : ''));
console.log(`每步耗时: 新 avg ${avg(msNew).toFixed(0)}ms / max ${max(msNew)}ms；旧 avg ${avg(msOld).toFixed(0)}ms / max ${max(msOld)}ms`);
console.log(`大子(≥${BIG})被白吃（对方吃我大子且攻击者存活）: 新 场均 ${(freeCapNew / N).toFixed(2)} / 旧 场均 ${(freeCapOld / N).toFixed(2)}`);
console.log(`大子主动送死（仅参考）: 新 场均 ${(giftNew / N).toFixed(2)} / 旧 场均 ${(giftOld / N).toFixed(2)}`);
console.log('\n验收: 新胜率(不计和) ≥45%（目标 ≥55%）；新 avg ≤900ms、max ≤1100ms；大子被白吃场均不高于旧版。');
const pass = (!decided || winsNew / decided >= 0.45) && avg(msNew) <= 900 && max(msNew) <= 1100 && freeCapNew <= freeCapOld;
console.log(pass ? 'RESULT: PASS ✅' : 'RESULT: 未达标 ❌（按方案在给定权重范围内调参后重跑）');
process.exit(pass ? 0 : 1);
