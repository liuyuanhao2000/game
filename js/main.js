// 军旗翻翻棋 — 入口/粘合层
// 人类提交动作 → state 更新 → 若轮到 AI 调 ai.chooseMove → 再更新 → 渲染。
;(function () {
  const NS = (typeof window !== 'undefined') ? window : globalThis;
  NS.Junqi = NS.Junqi || {};
  const C = NS.Junqi.constants;
  const R = NS.Junqi.rules;
  const STATE = NS.Junqi.state;
  const AI = NS.Junqi.ai;
  const UI = NS.Junqi.ui;

  let state = null;
  let difficulty = C.DIFFICULTY.MEDIUM;
  let aiTimer = null;
  // UI 瞬态（选中/落点）不挂在游戏状态上，保持 state 纯粹、可序列化
  let selIndex = null;
  let selTargets = null;

  function start() {
    state = STATE.createInitialState();
    state.onChange = () => UI.render(state);
    UI.init({
      board: document.getElementById('board'),
      hud: document.getElementById('hud'),
      status: document.getElementById('status'),
      mines: document.getElementById('mines'),
      lastmove: document.getElementById('lastmove'),
      onSelect: onCellClick,
    });
    UI.clearSelection();
    UI.render(state);
  }

  function setDifficulty(d) { difficulty = d; }

  function reset() {
    if (aiTimer) { clearTimeout(aiTimer); aiTimer = null; }
    start();
  }

  function isPlayerTurn() {
    if (state.winner) return false;
    if (!state.sidesAssigned) return true; // 开局翻棋由人类执行
    return state.turn === state.playerSide;
  }

  function onCellClick(i) {
    if (state.winner) return;

    // 开局：未定阵营，点击任意未翻子→翻棋
    if (!state.sidesAssigned) {
      const cell = state.board[i];
      if (!cell.piece || cell.revealed) { UI.toast('请点击背面朝下的棋子翻开'); return; }
      commitAction({ kind: 'flip', index: i });
      return;
    }

    if (!isPlayerTurn()) { UI.toast('等待 AI 行动'); return; }

    const cell = state.board[i];
    const hadSel = selIndex !== null;

    // 若已选中己方已翻子，且 i 是合法落点 → 移动
    if (hadSel) {
      const targets = selTargets || {};
      if (targets[i]) {
        commitAction({ kind: 'move', from: selIndex, to: i });
        return;
      }
      // 再次点击已选中的子 → 取消选中
      if (selIndex === i) {
        clearSel();
        UI.render(state);
        return;
      }
    }

    // 选中己方已翻、可移动的子
    if (cell.piece && cell.revealed && cell.piece.side === state.playerSide) {
      if (C.IMMOBILE.indexOf(cell.piece.type) !== -1) {
        UI.toast('该棋子（' + C.PIECES[cell.piece.type].name + '）不可移动');
        clearSel();
        UI.render(state);
        return;
      }
      const moves = R.legalMoves(state, i);
      if (moves.length === 0) { UI.toast('该棋子无合法走法'); clearSel(); UI.render(state); return; }
      selIndex = i;
      selTargets = {};
      for (const m of moves) selTargets[m.to] = true;
      UI.setSelection(i, moves);
      UI.render(state);
      return;
    }

    // 也可翻棋（即使有子可动也允许）
    if (cell.piece && !cell.revealed) {
      commitAction({ kind: 'flip', index: i });
      return;
    }

    // 有选中时点到「非法目标」（空地 / 不可攻的敌子）→ 格子闪红反馈，而非静默
    if (hadSel) {
      const isEnemy = cell.piece && cell.revealed && cell.piece.side !== state.playerSide;
      if (!cell.piece || isEnemy) UI.flashInvalid(i);
    }
    clearSel();
    UI.render(state);
  }

  function clearSel() {
    selIndex = null;
    selTargets = null;
    UI.clearSelection();
  }

  function commitAction(action) {
    // 先清选中高亮：applyMove 成功后 onChange 会恰好渲染一次，
    // 若此处再渲染一次会打断入场动画；提前清掉即可让那一次渲染不带选框。
    clearSel();
    const ok = STATE.applyMove(state, action);
    if (!ok) {
      // 状态层拒绝（轮次/可达性）：反馈并重绘以清除选框
      if (action.to != null) UI.flashInvalid(action.to);
      UI.render(state);
      UI.toast('非法操作，已忽略');
      return;
    }
    scheduleAI();
  }

  function scheduleAI() {
    if (aiTimer) clearTimeout(aiTimer);
    if (state.winner) return;
    if (state.sidesAssigned && state.turn === state.aiSide) {
      aiTimer = setTimeout(runAI, 450); // 给 UI 一点喘息，便于看清上一步
    }
  }

  function runAI() {
    if (state.winner) return;
    if (!state.sidesAssigned) return; // AI 不会先行翻棋
    const action = AI.chooseMove(state, difficulty, state.aiSide);
    // 理论不可达：若 AI 方无合法走法，上一步 applyMove 的 checkWinner 已判负，
    // scheduleAI 在 winner 非空时不会调度；此处仅防御性返回。
    if (!action) return;
    STATE.applyMove(state, action);
    // 渲染由 state.onChange 触发（恰好一次），避免二次渲染打断动画
  }

  // 暴露调试接口
  NS.Junqi.main = {
    start, setDifficulty, reset,
    getState: () => state,
    legalMoves: (i) => state ? R.legalMoves(state, i) : [],
  };
})();

// DOM ready 启动（脚本按序加载，DOMContentLoaded 后所有依赖就绪）
if (typeof document !== 'undefined') {
  let bootTries = 0;
  function boot() {
    if (window.Junqi && Junqi.main) { Junqi.main.start(); return; }
    if (++bootTries > 100) { console.error('[Junqi] 依赖加载失败，无法启动'); return; } // 约 5s 上限，避免无限轮询
    setTimeout(boot, 50);
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
}
