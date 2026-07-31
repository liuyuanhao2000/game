// 军旗翻翻棋 — 规则核心（纯函数，不碰 DOM，可单测、可被 AI 复用）
// 索引约定：index = row*5 + col，row∈[0,11]，col∈[0,4]
// cell = { piece: {type,rank,side}|null, revealed: bool }
// state.board: cell[60]
;(function () {
  const NS = (typeof window !== 'undefined') ? window : globalThis;
  NS.Junqi = NS.Junqi || {};
  const B = NS.Junqi.board;
  const C = NS.Junqi.constants;

  // ---- 交战结算 ----
  // 输入攻击者与防守者 piece 对象，返回 { from: cell结果, to: cell结果, flagCaptured: bool }
  // from = 攻击者原格结果（移动后通常为空），to = 防守者格结果
  function resolveBattle(attacker, defender) {
    const a = attacker, d = defender;
    // 炸弹：任一方为炸弹则同归于尽
    if (a.type === 'bomb' || d.type === 'bomb') {
      // 炸弹炸军旗：军旗被毁 → 旗方判负（攻击方胜）
      if (d.type === 'flag') return { from: null, to: null, flagCaptured: true };
      return { from: null, to: null, flagCaptured: false };
    }
    // 防守为地雷（攻击者不会是地雷/军旗，二者不可移动）
    if (d.type === 'mine') {
      if (a.type === 'engineer') {
        // 工兵挖雷：工兵存活占格，雷除
        return { from: null, to: { piece: a, revealed: true }, flagCaptured: false };
      }
      // 非工兵撞雷：攻击者死，雷留
      return { from: null, to: { piece: d, revealed: true }, flagCaptured: false };
    }
    // 防守为军旗：攻击者存活占格，旗除 → 胜
    if (d.type === 'flag') {
      return { from: null, to: { piece: a, revealed: true }, flagCaptured: true };
    }
    // 等级比较
    if (a.rank > d.rank) {
      return { from: null, to: { piece: a, revealed: true }, flagCaptured: false };
    }
    if (a.rank < d.rank) {
      return { from: null, to: { piece: d, revealed: true }, flagCaptured: false };
    }
    // 同级同归
    return { from: null, to: null, flagCaptured: false };
  }

  // ---- 合法走法生成 ----
  // 返回该格棋子可执行的所有 {kind:'move', from, to}
  // 调用方负责：该格须有已翻己方子、非雷/旗
  function legalMoves(state, index) {
    const cell = state.board[index];
    if (!cell.piece || !cell.revealed) return [];
    if (C.IMMOBILE.indexOf(cell.piece.type) !== -1) return []; // 地雷/军旗不可动
    const p = cell.piece;
    const out = {};
    const add = (to) => {
      if (to === index) return;
      if (out[to] !== undefined) return;
      const tcell = state.board[to];
      if (tcell.piece) {
        // 攻击：须已翻敌子，且目标非占营
        if (!tcell.revealed) return; // 未翻不可攻
        if (tcell.piece.side === p.side) return; // 己子阻挡
        if (B.terrainAt(to) === 'camp') return; // 行营免疫
        // 军旗保护：对方地雷未全部拔掉前，不可攻击其军旗
        if (tcell.piece.type === 'flag' &&
            (state.minesLost ? state.minesLost[tcell.piece.side] : 0) < C.MINES_PER_SIDE) {
          return;
        }
        // 合法攻击
      } else {
        // 空格：空行营可进、空铁路/普通均可
      }
      out[to] = { kind: 'move', from: index, to };
    };

    // 1) 正交 1 步
    for (const n of B.orthNeighbors(index)) add(n);

    // 2) 梅花斜路 1 步
    for (const n of B.diagNeighbors(index)) add(n);

    // 3) 铁路移动
    if (B.terrainAt(index) === 'railway') {
      const isEng = (p.type === 'engineer');
      const reach = isEng ? bfsRailwayReach(state, index) : straightRailwayReach(state, index);
      for (const r of reach) {
        if (r === index) continue;
        add(r); // 铁路滑行落点。离轨须独立一步：从当前格离轨由上面「正交 1 步」覆盖
      }
    }

    return Object.keys(out).map((k) => out[k]);
  }

  // 非工兵铁路直线扫描：4 方向沿连续铁路格走，遇非铁路/越界/楚河断/占用格则停
  function straightRailwayReach(state, index) {
    const reach = [];
    const seen = new Set();
    const dirs = [[0, 1], [0, -1], [1, 0], [-1, 0]];
    const [r0, c0] = B.rc(index);
    for (const [dr, dc] of dirs) {
      let r = r0 + dr, c = c0 + dc;
      while (r >= 0 && r < B.ROWS && c >= 0 && c < B.COLS) {
        const cur = B.idx(r - dr, c - dc); // 当前起点
        const nxt = B.idx(r, c);
        if (!B.isAdjacent(cur, nxt)) break;        // 楚河断或非正交相邻
        if (B.terrainAt(nxt) !== 'railway') break; // 离开铁路
        if (!seen.has(nxt)) { seen.add(nxt); reach.push(nxt); }
        if (state.board[nxt].piece) break;          // 占用格：本身可达(攻击)，但不能再过
        r += dr; c += dc;
      }
    }
    return reach;
  }

  // 工兵铁路 BFS：可转弯，沿 railNeighbors；空格才继续入队，占用格作为可达目标但不入队
  function bfsRailwayReach(state, index) {
    const visited = new Set([index]);
    const queue = [index];
    const reach = [];
    while (queue.length) {
      const cur = queue.shift();
      for (const n of B.railNeighbors(cur)) {
        if (visited.has(n)) continue;
        visited.add(n);
        reach.push(n); // 可达目标（攻击或落子）
        if (!state.board[n].piece) queue.push(n); // 空格可继续穿过
      }
    }
    return reach;
  }

  // ---- 是否有任意合法行动 ----
  // side 方有未翻格可翻 或 任一己方已翻子有 legalMoves
  function hasAnyLegalMove(state, side) {
    // 有未翻格则可翻
    for (let i = 0; i < state.board.length; i++) {
      if (state.board[i].piece && !state.board[i].revealed) return true;
    }
    // 任一己方已翻子可动
    for (let i = 0; i < state.board.length; i++) {
      const cell = state.board[i];
      if (cell.piece && cell.revealed && cell.piece.side === side) {
        if (legalMoves(state, i).length > 0) return true;
      }
    }
    return false;
  }

  // 枚举 side 方全部合法动作（flip + move），供 AI 使用
  function enumerateActions(state, side) {
    const actions = [];
    for (let i = 0; i < state.board.length; i++) {
      const cell = state.board[i];
      if (cell.piece && !cell.revealed) {
        actions.push({ kind: 'flip', index: i });
      }
    }
    for (let i = 0; i < state.board.length; i++) {
      const cell = state.board[i];
      if (cell.piece && cell.revealed && cell.piece.side === side) {
        const ms = legalMoves(state, i);
        for (const m of ms) actions.push(m);
      }
    }
    return actions;
  }

  // ---- 胜负判定（由 state.applyMove 调用）----
  // 返回 null | 'red' | 'blue' | 'draw'（不覆盖已设的旗被吃胜）
  function checkWinner(state) {
    if (state.winner) return state.winner;
    // 当前轮到的一方无合法行动 → 对方胜（优先于和棋：无路可走即负）
    const mover = state.turn;
    if (!hasAnyLegalMove(state, mover)) {
      return C.opposite(mover);
    }
    if (state.staleCount >= C.STALE_LIMIT) return 'draw';
    return null;
  }

  NS.Junqi.rules = {
    resolveBattle, legalMoves,
    straightRailwayReach, bfsRailwayReach,
    hasAnyLegalMove, enumerateActions, checkWinner,
  };
})();
