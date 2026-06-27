// 军旗翻翻棋 — 入口/粘合层
// 人类提交动作 → state 更新 → 若轮到 AI 调 ai.chooseMove → 再更新 → 渲染。
;(function () {
  const NS = (typeof window !== 'undefined') ? window : globalThis;
  NS.Junqi = NS.Junqi || {};
  const C = NS.Junqi.constants;
  const B = NS.Junqi.board;
  const R = NS.Junqi.rules;
  const STATE = NS.Junqi.state;
  const AI = NS.Junqi.ai;
  const UI = NS.Junqi.ui;

  let state = null;
  let difficulty = C.DIFFICULTY.MEDIUM;
  let aiTimer = null;

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

    // 若已选中己方已翻子，且 i 是合法落点 → 移动
    if (state._sel !== undefined && state._sel !== null) {
      const targets = state._targets || {};
      if (targets[i]) {
        const from = state._sel;
        clearSel();
        commitAction({ kind: 'move', from, to: i });
        return;
      }
    }

    // 选中己方已翻、可移动的子
    if (cell.piece && cell.revealed && cell.piece.side === state.playerSide) {
      if (C.IMMOBILE.indexOf(cell.piece.type) !== -1) {
        UI.toast('该棋子（' + C.PIECES[cell.piece.type].name + '）不可移动');
        clearSel();
        return;
      }
      const moves = R.legalMoves(state, i);
      if (moves.length === 0) { UI.toast('该棋子无合法走法'); clearSel(); UI.render(state); return; }
      state._sel = i;
      state._targets = {};
      for (const m of moves) state._targets[m.to] = true;
      UI.setSelection(i, moves);
      UI.render(state);
      return;
    }

    // 也可翻棋（即使有子可动也允许）
    if (cell.piece && !cell.revealed) {
      clearSel();
      commitAction({ kind: 'flip', index: i });
      return;
    }

    // 点空格或敌方未翻/其它 → 清除选中
    clearSel();
    UI.render(state);
  }

  function clearSel() {
    if (!state) return;
    state._sel = null;
    state._targets = null;
    UI.clearSelection();
  }

  function commitAction(action) {
    STATE.applyMove(state, action);
    clearSel();
    UI.render(state);
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
    if (!action) {
      // 无合法走法 → 判负（checkWinner 会在 applyMove 中处理，但这里直接判定）
      state.winner = state.playerSide;
      UI.render(state);
      return;
    }
    STATE.applyMove(state, action);
    UI.render(state);
    // 若 AI 翻棋后仍轮到 AI（不会发生，回合已切换）——无需继续
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
  function boot() {
    if (window.Junqi && Junqi.main) Junqi.main.start();
    else setTimeout(boot, 50);
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
}
