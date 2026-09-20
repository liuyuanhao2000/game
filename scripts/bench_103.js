// 军旗翻翻棋 — 新版 AI vs 1.0.3(最强老版) 强度基准（回归定位/验收用，不进 index.html）
// 用法:
//   node scripts/bench_103.js [newEnginePath] [hard|master] [N]
//   newEnginePath 默认 ../js/ai.js；可传 /tmp 变体（单特性回退的副本）做二分定位
//   先后手各半、种子化可复现。1.0.3 用其原生 PRESETS，新引擎用其自身 PRESETS（同档位）。
'use strict';
const path = require('path');
const G = __dirname + '/../js/';
require(G + 'constants.js');
require(G + 'board.js');
require(G + 'rules.js');
require(G + 'state.js');
const C = Junqi.constants, S = Junqi.state;

require(__dirname + '/ai_v103.js');
const engine103 = Junqi.ai;
const newPath = process.argv[2] || (G + 'ai.js');
require(newPath);
const engineNew = Junqi.ai;

const PRESET = process.argv[3] || 'hard';
const N = Number(process.argv[4]) || 12;
if (!engine103.PRESETS[PRESET] || !engineNew.PRESETS[PRESET]) {
  console.error('未知档位: ' + PRESET); process.exit(2);
}
const cfg103 = Object.assign({}, engine103.PRESETS[PRESET]);
const cfgNew = Object.assign({}, engineNew.PRESETS[PRESET]);

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function playGame(engineA, cfgA, engineB, cfgB, seed) {
  const origRandom = Math.random;
  Math.random = mulberry32(seed);
  const stat = { msA: 0, msB: 0, plies: 0, winner: null, playerSide: null };
  try {
    const st = S.createInitialState();
    let playerSideAssigned = false;
    while (!st.winner && stat.plies < 400) {
      const cur = st.sidesAssigned
        ? (st.turn === st.playerSide ? { e: engineA, c: cfgA } : { e: engineB, c: cfgB })
        : { e: engineA, c: cfgA }; // A 首翻
      const t0 = Date.now();
      const a = cur.e.chooseHard(st, st.sidesAssigned ? st.turn : C.SIDES[0], cur.c);
      const dt = Date.now() - t0;
      // 未定时阵营时行动方恒为 A（首翻）
      if (!st.sidesAssigned || st.turn === st.playerSide) stat.msA += dt; else stat.msB += dt;
      if (!a) break;
      if (!S.applyMove(st, a)) break;
      stat.plies++;
      if (!playerSideAssigned && st.sidesAssigned) { st.playerSide = st.lastMove.side; playerSideAssigned = true; }
    }
    stat.winner = st.winner;
    stat.playerSide = st.playerSide;
    // 终局子力差（new 方视角）：和棋/截断局远多于决胜局，子力差是更高功效的强度信号
    const newSide = (st.playerSide && newFirstGlobal) ? st.playerSide
      : st.playerSide ? C.opposite(st.playerSide) : null;
    if (newSide) {
      let diff = 0;
      for (const cell of st.board) {
        if (!cell.piece || !cell.revealed) continue;
        const v = C.PIECE_VALUE[cell.piece.type] || 0;
        diff += (cell.piece.side === newSide ? v : -v);
      }
      stat.matDiff = diff; // >0 = 新版终局子力领先
    }
  } finally {
    Math.random = origRandom;
  }
  return stat;
}
let newFirstGlobal = true; // playGame 内计算终局子力差视角用（每局开头设置）

let winsNew = 0, wins103 = 0, draws = 0, capped = 0, pliesTotal = 0;
let msNew = 0, ms103 = 0;
let matSum = 0, matSq = 0, matN = 0;
for (let i = 0; i < N; i++) {
  const newFirst = i % 2 === 0;
  newFirstGlobal = newFirst;
  const s = playGame(newFirst ? engineNew : engine103, newFirst ? cfgNew : cfg103,
                     newFirst ? engine103 : engineNew, newFirst ? cfg103 : cfgNew, 7000 + i);
  const msN = newFirst ? s.msA : s.msB, msO = newFirst ? s.msB : s.msA;
  msNew += msN; ms103 += msO;
  pliesTotal += s.plies;
  let w = null;
  if (s.winner === 'draw') { draws++; w = '和'; }
  else if (s.winner && s.winner === s.playerSide) w = newFirst ? 'NEW' : 'V103';
  else if (s.winner) w = newFirst ? 'V103' : 'NEW';
  else capped++;
  if (w === 'NEW') winsNew++;
  else if (w === 'V103') wins103++;
  if (typeof s.matDiff === 'number') { matSum += s.matDiff; matSq += s.matDiff * s.matDiff; matN++; }
  console.log(`#${i + 1} seed=${7000 + i} ${s.plies}步 ${w || '满步截断'}` +
    (typeof s.matDiff === 'number' ? ` 终局子力差(${w === 'V103' ? '-' : '+'})${Math.abs(s.matDiff)}` : ''));
}
const decided = winsNew + wins103;
console.log(`\n===== 新版 vs 1.0.3（${PRESET}，${N} 局）=====`);
console.log(`胜负: 新版 ${winsNew} / 1.0.3 ${wins103} / 和 ${draws} / 截断 ${capped}` +
  (decided ? `  → 新版胜率(不计和/截断) ${(100 * winsNew / decided).toFixed(1)}%` : ''));
if (matN > 1) {
  const mean = matSum / matN, se = Math.sqrt((matSq - matSum * matSum / matN) / (matN - 1) / matN);
  console.log(`终局已翻子力差（新版视角）: 均值 ${mean.toFixed(1)} ± ${se.toFixed(1)}（n=${matN}；|均值|>2×SE 即有统计差异）`);
}
console.log(`总耗时: 新版 ${(msNew / 1000).toFixed(0)}s（场均/局 ${(msNew / N / 1000).toFixed(1)}s）/ 1.0.3 ${(ms103 / 1000).toFixed(0)}s` +
  `；场均步数 ${(pliesTotal / N).toFixed(0)}`);
