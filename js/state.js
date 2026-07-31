// 军旗翻翻棋 — 游戏状态（唯一真源）
// 持有 board/turn/playerSide/winner/staleCount，暴露 applyMove 等变更方法。
// 不直接碰 DOM；通过 onChange 回调通知 ui。
;(function () {
  const NS = (typeof window !== 'undefined') ? window : globalThis;
  NS.Junqi = NS.Junqi || {};
  const C = NS.Junqi.constants;
  const B = NS.Junqi.board;
  const R = NS.Junqi.rules;

  // 生成 50 子（每方 25）并随机铺在 60 格中的 50 格，背面朝下
  function buildPieces() {
    const list = [];
    for (const side of C.SIDES) {
      for (const type in C.PIECES) {
        const n = C.PIECES[type].count;
        for (let i = 0; i < n; i++) list.push({ type, rank: C.PIECES[type].rank, side });
      }
    }
    return list; // 50
  }

  function shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  function createInitialState() {
    const board = new Array(C.CELL_COUNT);
    for (let i = 0; i < C.CELL_COUNT; i++) board[i] = { piece: null, revealed: false };
    // 随机摆放 50 子；行营格不放棋子（10 个行营格保持空）
    const nonCampSlots = shuffle(
      [...Array(C.CELL_COUNT).keys()].filter((i) => B.terrainAt(i) !== 'camp')
    );
    const pieces = shuffle(buildPieces());
    for (let i = 0; i < pieces.length; i++) {
      board[nonCampSlots[i]] = { piece: pieces[i], revealed: false };
    }
    return {
      board,
      rows: C.ROWS, cols: C.COLS,
      turn: null,                // 首次翻棋前为 null；人类先行翻棋
      playerSide: null,          // 首次翻棋确定
      aiSide: null,
      sidesAssigned: false,
      winner: null,
      staleCount: 0,
      minesLost: { red: 0, blue: 0 }, // 每方已损失地雷数；拔满 3 才可吃其军旗
      captured: {},            // 已被吃/移除的子：'type:side' -> 数量（供 AI 剩余分布扣减）
      lastMove: null,           // 最近一步描述（供 UI 标记/提示），null 表示无
      onChange: null,           // 回调
    };
  }

  function notify(state) {
    if (typeof state.onChange === 'function') state.onChange(state);
  }

  function bump(map, k) { map[k] = (map[k] || 0) + 1; }

  // 结算一次交战并落盘（state 与 AI 克隆通用的共享逻辑）。
  // 返回 { flagCaptured, outcome, defender }。
  // 前置：from 为已翻可动子、to 为已翻敌子；合法性/轮次由调用方保证。
  function applyBattle(state, from, to) {
    const p = state.board[from].piece;
    const defender = state.board[to].piece;
    const res = R.resolveBattle(p, defender);
    // 落盘
    state.board[from] = { piece: null, revealed: false };
    state.board[to] = { piece: res.to ? res.to.piece : null, revealed: res.to ? res.to.revealed : false };
    // 地雷被拔除（工兵挖雷或炸弹引爆）则记损失
    if (defender.type === 'mine' && !(res.to && res.to.piece && res.to.piece.type === 'mine')) {
      state.minesLost[defender.side] += 1;
    }
    // 记录被移除的子（攻击者阵亡 / 防守者被吃），供 AI 剩余分布扣减
    state.captured = state.captured || {};
    if (!(res.to && res.to.piece === p)) bump(state.captured, p.type + ':' + p.side);
    if (!(res.to && res.to.piece === defender)) bump(state.captured, defender.type + ':' + defender.side);
    // 交战结果：win=攻击者胜、lose=攻击者亡、both=同归、flag=夺旗
    let outcome;
    if (res.flagCaptured) outcome = 'flag';
    else if (!res.to || !res.to.piece) outcome = 'both';
    else if (res.to.piece === p) outcome = 'win';
    else outcome = 'lose';
    return { flagCaptured: res.flagCaptured, outcome, defender };
  }

  // 应用一个动作。返回 true 表示成功应用（即使触发胜负也算成功）。
  function applyMove(state, action) {
    if (state.winner) return false;

    if (action.kind === 'flip') {
      const i = action.index;
      if (!Number.isInteger(i) || i < 0 || i >= C.CELL_COUNT) return false;
      const cell = state.board[i];
      if (!cell.piece || cell.revealed) return false;
      cell.revealed = true;
      // 首次翻棋定阵营
      if (!state.sidesAssigned) {
        state.playerSide = cell.piece.side;
        state.aiSide = C.opposite(state.playerSide);
        state.sidesAssigned = true;
        state.turn = state.aiSide; // 翻棋者（人类）回合结束，轮到 AI
      } else {
        state.turn = C.opposite(state.turn);
      }
      state.staleCount = 0; // 翻棋重置困局计数
      state.lastMove = { kind: 'flip', index: action.index, side: cell.piece.side, type: cell.piece.type };
      state.winner = R.checkWinner(state);
      notify(state);
      return true;
    }

    if (action.kind === 'move') {
      const from = action.from, to = action.to;
      // 边界/形状校验：越界或非法索引直接拒绝（避免抛错）
      if (!Number.isInteger(from) || !Number.isInteger(to)) return false;
      if (from < 0 || from >= C.CELL_COUNT || to < 0 || to >= C.CELL_COUNT) return false;
      if (from === to) return false;
      const fcell = state.board[from];
      const tcell = state.board[to];
      if (!fcell.piece || !fcell.revealed) return false;
      // 轮次校验：只能移动轮到方的子
      if (state.turn && fcell.piece.side !== state.turn) return false;
      // 可达性校验：to 必须在该子的合法走法内（地形/距离/行营免疫/军旗保护均已含）
      if (!R.legalMoves(state, from).some((m) => m.to === to)) return false;
      if (C.IMMOBILE.indexOf(fcell.piece.type) !== -1) return false;
      const p = fcell.piece;

      if (tcell.piece) {
        // 交战（须已翻敌子；行营免疫已在 legalMoves 过滤，此处再防御）
        if (!tcell.revealed) return false;
        if (tcell.piece.side === p.side) return false;
        if (B.terrainAt(to) === 'camp') return false;
        // 军旗保护：对方地雷未拔满前不可吃旗
        if (tcell.piece.type === 'flag' &&
            state.minesLost[tcell.piece.side] < C.MINES_PER_SIDE) return false;
        const info = applyBattle(state, from, to);
        if (info.flagCaptured) state.winner = p.side;
        state.staleCount = 0; // 吃子重置
        state.lastMove = { kind: 'move', from, to, side: p.side, type: p.type,
          battle: { side: info.defender.side, type: info.defender.type, outcome: info.outcome } };
      } else {
        // 走到空格
        state.board[to] = { piece: p, revealed: true };
        state.board[from] = { piece: null, revealed: false };
        state.staleCount += 1; // 无吃无翻的走子递增
        state.lastMove = { kind: 'move', from, to, side: p.side, type: p.type, battle: null };
      }
      state.turn = C.opposite(state.turn);
      if (!state.winner) state.winner = R.checkWinner(state);
      notify(state);
      return true;
    }
    return false;
  }

  NS.Junqi.state = {
    createInitialState, applyMove, applyBattle,
  };
})();
