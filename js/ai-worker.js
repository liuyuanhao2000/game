// 军旗翻翻棋 — AI 思考 Worker（后台线程）
// 协议：主线程 postMessage({ type:'think', id, state, difficulty, side })
//       Worker 回传   postMessage({ type:'result', id, action })
// state 为纯数据快照（无 onChange 等函数）；AI 函数只读状态、内部 clone 后变更，可安全驱动。
// 相对路径 importScripts 按本文件自身 URL（js/）解析；五个模块无 window 时挂 globalThis，Worker 内直接可用。
'use strict';
importScripts('constants.js', 'board.js', 'rules.js', 'state.js', 'ai.js');

self.onmessage = (e) => {
  const msg = e.data || {};
  if (msg.type !== 'think') return;
  const action = Junqi.ai.chooseMove(msg.state, msg.difficulty, msg.side);
  self.postMessage({ type: 'result', id: msg.id, action: action });
};
