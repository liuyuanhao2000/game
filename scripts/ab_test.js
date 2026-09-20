// 军旗翻翻棋 — AI 特性 A/B 自弈（开发用，不进 index.html）
// 用法: node scripts/ab_test.js <feature> [N]
//   feature: positional | flipCollapse | makeUnmake
//   A = 完整特性（hard 预置），B = 关闭该特性。先后手各半、种子化可复现。
//   双实例：同一份 js/ai.js 拷到两个临时路径分别 require（共享 C/B/R/STATE，各自独立闭包与 _cfg）。
'use strict';
const path = require('path'); const fs = require('fs'); const os = require('os');
const G = __dirname + '/../js/';
require(G + 'constants.js');
require(G + 'board.js');
require(G + 'rules.js');
require(G + 'state.js');
const C = Junqi.constants, S = Junqi.state;

const tmpA = path.join(os.tmpdir(), 'junqi_ab_A.js');
const tmpB = path.join(os.tmpdir(), 'junqi_ab_B.js');
fs.copyFileSync(G + 'ai.js', tmpA);
fs.copyFileSync(G + 'ai.js', tmpB);
require(tmpA); const engineA = Junqi.ai; // A：完整特性
require(tmpB); const engineB = Junqi.ai; // B：关闭目标特性

const FEATURE = process.argv[2];
const N = Number(process.argv[3]) || 8;
if (!FEATURE) { console.error('用法: node scripts/ab_test.js <positional|flipCollapse|deltaPrune|makeUnmake> [N]'); process.exit(2); }
const cfgA = Object.assign({}, engineA.PRESETS.hard);
const cfgB = Object.assign({}, engineB.PRESETS.hard, { [FEATURE]: false });

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const BIG = 45;
function battleLosses(lm) {
  if (!lm || lm.kind !== 'move' || !lm.battle) return { gift: 0, freeCap: 0 };
  const vMover = C.PIECE_VALUE[lm.type] || 0;
  const vDef = C.PIECE_VALUE[lm.battle.type] || 0;
  const o = lm.battle.outcome;
  let gift = 0, freeCap = 0;
  if (vMover >= BIG && (o === 'lose' || (o === 'both' && vDef < vMover))) gift = 1;
  if (vDef >= BIG && o === 'win') freeCap = 1;
  return { gift, freeCap };
}

// 楚河穿河点（与 ai.js 一致）：idx(5,0)(5,2)(5,4)(6,0)(6,2)(6,4)
const GATE_SET = new Set([25, 27, 29, 30, 32, 34]);

function playGame(engineX, engineY, cfgX, cfgY, seed) {
  const origRandom = Math.random;
  Math.random = mulberry32(seed);
  const stat = { giftX: 0, giftY: 0, freeCapX: 0, freeCapY: 0, winner: null, plies: 0,
    campX: [], campY: [], gateX: [], gateY: [] };
  // 位置行为采样（每 20 ply）：双方已翻子在行营/穿河点的占用数——验证位置项真实改变行为
  const samplePositional = (st) => {
    let campX = 0, campY = 0, gateX = 0, gateY = 0;
    for (let i = 0; i < st.board.length; i++) {
      const cell = st.board[i];
      if (!cell.piece || !cell.revealed) continue;
      const isX = cell.piece.side === st.playerSide;
      const t = Junqi.board.terrainAt(i);
      if (t === 'camp') { isX ? campX++ : campY++; }
      else if (GATE_SET.has(i)) { isX ? gateX++ : gateY++; }
    }
    stat.campX.push(campX); stat.campY.push(campY);
    stat.gateX.push(gateX); stat.gateY.push(gateY);
  };
  try {
    const st = S.createInitialState();
    let playerSideAssigned = false;
    while (!st.winner && stat.plies < 400) {
      const cur = st.sidesAssigned
        ? (st.turn === st.playerSide ? { engine: engineX, cfg: cfgX } : { engine: engineY, cfg: cfgY })
        : { engine: engineX, cfg: cfgX };
      const isX = cur.engine === engineX;
      const a = cur.engine.chooseHard(st, st.sidesAssigned ? st.turn : C.SIDES[0], cur.cfg);
      if (!a) break;
      if (!S.applyMove(st, a)) break;
      stat.plies++;
      if (!playerSideAssigned && st.sidesAssigned) { st.playerSide = st.lastMove.side; playerSideAssigned = true; }
      if (st.sidesAssigned && stat.plies % 20 === 0) samplePositional(st);
      if (st.lastMove) {
        const moverIsX = st.lastMove.side === st.playerSide;
        const { gift, freeCap } = battleLosses(st.lastMove);
        if (moverIsX) { stat.giftX += gift; stat.freeCapY += freeCap; }
        else { stat.giftY += gift; stat.freeCapX += freeCap; }
      }
    }
    stat.winner = st.winner;
    stat.playerSide = st.playerSide;
  } finally {
    Math.random = origRandom;
  }
  return stat;
}

let winsA = 0, winsB = 0, draws = 0, capped = 0, freeCapA = 0, freeCapB = 0, pliesTotal = 0;
let campA = 0, campB = 0, gateA = 0, gateB = 0, posSamples = 0;
for (let i = 0; i < N; i++) {
  const xFirst = i % 2 === 0;
  const s = playGame(engineA, engineB, cfgA, cfgB, 2000 + i); // A 恒为 X（A=完整特性）
  const fcA = s.freeCapX, fcB = s.freeCapY;
  freeCapA += fcA; freeCapB += fcB; pliesTotal += s.plies;
  campA += s.campX.reduce((a, b) => a + b, 0); campB += s.campY.reduce((a, b) => a + b, 0);
  gateA += s.gateX.reduce((a, b) => a + b, 0); gateB += s.gateY.reduce((a, b) => a + b, 0);
  posSamples += s.campX.length;
  let w = null;
  if (s.winner === 'draw') { draws++; w = '和'; }
  else if (s.winner === s.playerSide) w = 'A';
  else if (s.winner) w = 'B';
  else capped++;
  if (w === 'A') winsA++;
  else if (w === 'B') winsB++;
  console.log(`#${i + 1} seed=${2000 + i} ${s.plies}步 ${w === '和' ? '和' : w === 'A' ? 'A(全特性)胜' : w === 'B' ? 'B(关${FEATURE})胜' : '满步截断'} 被白吃 A${fcA}/B${fcB}`);
}
const decided = winsA + winsB;
console.log(`\n===== A/B：全特性 vs 关闭 ${FEATURE}（hard 预置，${N} 局）=====`);
console.log(`胜负: A ${winsA} / B ${winsB} / 和 ${draws} / 截断 ${capped}；` +
  (decided ? `A 胜率(不计和/截断) ${(100 * winsA / decided).toFixed(1)}%` : '无决胜局'));
console.log(`大子被白吃: A 场均 ${(freeCapA / N).toFixed(2)} / B 场均 ${(freeCapB / N).toFixed(2)}；场均步数 ${(pliesTotal / N).toFixed(0)}`);
if (posSamples) {
  console.log(`场均占行营数: A ${(campA / posSamples).toFixed(2)} / B ${(campB / posSamples).toFixed(2)}` +
    `；场均控穿河点: A ${(gateA / posSamples).toFixed(2)} / B ${(gateB / posSamples).toFixed(2)}`);
}
console.log(winsA > winsB ? '→ 该特性为正收益，保留' : winsA < winsB ? '→ 该特性为负收益，考虑关闭/调整' : '→ 无显著差异');
