// 军旗翻翻棋 — 游戏状态（唯一真源）
// 持有 board/turn/controllers/winner/staleCount，暴露 applyMove 等变更方法。
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

  // 镜像明棋发牌：跨楚河镜像对 (r,c) ↔ (11-r,c) 共 25 对（行营恒空）。
  // 每对随机选一格给红方，蓝方占镜像格；红方 25 枚棋子洗牌后落位，镜像格放同类型蓝子。
  // 结果：50 个非行营格全部有子（25 红 + 25 蓝），全部明置、无暗子。
  function fillMirrorBoard(board) {
    const redSlots = [];
    for (let i = 0; i < C.CELL_COUNT; i++) {
      if (B.terrainAt(i) === 'camp') continue;
      const m = B.mirrorIndex(i);
      if (i >= m) continue; // 每个镜像对只处理一次（上半行索引恒小于下半镜像行）
      redSlots.push(Math.random() < 0.5 ? i : m);
    }
    const redPieces = shuffle(buildPieces().filter((p) => p.side === 'red'));
    for (let k = 0; k < redSlots.length; k++) {
      const i = redSlots[k];
      const m = B.mirrorIndex(i);
      const p = redPieces[k];
      board[i] = { piece: p, revealed: true };
      board[m] = { piece: { type: p.type, rank: p.rank, side: 'blue' }, revealed: true };
    }
  }

  function createInitialState(opts) {
    const mode = (opts && opts.mode) || 'ai'; // 'ai'=人机 | 'pvp'=双人同屏
    const variant = (opts && opts.variant) || C.VARIANTS.CLASSIC; // 经典 | 娱乐·军衔升级 | 娱乐·镜像明棋
    const board = new Array(C.CELL_COUNT);
    for (let i = 0; i < C.CELL_COUNT; i++) board[i] = { piece: null, revealed: false };
    let turn = null, sidesAssigned = false, controllers = { red: null, blue: null };
    if (variant === C.VARIANTS.MIRROR_OPEN) {
      // 明棋镜像：全体已翻，无首翻定边；红方恒先行。
      // 人机模式随机分边（若人执蓝，AI 红方在 main.start 后自动走第一步）。
      fillMirrorBoard(board);
      turn = 'red';
      sidesAssigned = true;
      if (mode === 'pvp') {
        controllers = { red: 'human', blue: 'human' };
      } else {
        const humanSide = Math.random() < 0.5 ? 'red' : 'blue';
        controllers[humanSide] = 'human';
        controllers[C.opposite(humanSide)] = 'ai';
      }
    } else {
      // 随机摆放 50 子；行营格不放棋子（10 个行营格保持空）
      const nonCampSlots = shuffle(
        [...Array(C.CELL_COUNT).keys()].filter((i) => B.terrainAt(i) !== 'camp')
      );
      const pieces = shuffle(buildPieces());
      for (let i = 0; i < pieces.length; i++) {
        board[nonCampSlots[i]] = { piece: pieces[i], revealed: false };
      }
    }
    return {
      board,
      rows: C.ROWS, cols: C.COLS,
      mode,                      // 对局模式，供 UI/调度分支
      variant,                   // 玩法（经典/军衔升级/镜像明棋），供 applyBattle/AI/UI 分支；随 JSON 快照进 worker
      turn,                      // 经典首次翻棋前为 null；镜像明棋恒为 'red'
      controllers,               // 每方操作者：'human'|'ai'；经典首翻确定，镜像开局即定
      sidesAssigned,
      winner: null,
      staleCount: 0,
      minesLost: { red: 0, blue: 0 }, // 每方已损失地雷数；拔满 3 才可吃其军旗
      captured: {},            // 已被吃/移除的子：'type:side' -> 数量（供 AI 剩余分布扣减）
      lastMove: null,           // 最近一步描述（供 UI 标记/提示），null 表示无
      prevMove: { red: null, blue: null }, // 各方上一步 move 的 {from,to}（翻棋清空；供 AI 反向走子检测）
      onChange: null,           // 回调
    };
  }

  function notify(state) {
    if (typeof state.onChange === 'function') state.onChange(state);
  }

  function bump(map, k) { map[k] = (map[k] || 0) + 1; }

  // 结算一次交战并落盘（state 与 AI 克隆通用的共享逻辑）。
  // 返回 { flagCaptured, outcome, defender, revealedFlags, promotion }。
  // promotion（仅娱乐·军衔升级玩法）：{ side, type, fromRank, rank, captures } | null。
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
    // 司令阵亡亮军旗（经典规则）：某方司令死亡 → 该方军旗自动翻开（位置对双方公开）。
    // 司令对司令同归则双方军旗同时翻开；军旗已被吃/已翻开则无事发生。
    const revealedFlags = [];
    const pDied = p.type === 'commander' && !(res.to && res.to.piece === p);
    const dDied = defender.type === 'commander' && !(res.to && res.to.piece === defender);
    if (pDied || dDied) {
      const sides = [];
      if (pDied) sides.push(p.side);
      if (dDied && defender.side !== p.side) sides.push(defender.side);
      for (const s of sides) {
        for (let i = 0; i < state.board.length; i++) {
          const c = state.board[i];
          if (c.piece && c.piece.type === 'flag' && c.piece.side === s && !c.revealed) {
            c.revealed = true;
            revealedFlags.push(i);
          }
        }
      }
    }
    // ---- 娱乐·军衔升级玩法：战斗后存活方（非特殊子）自动升级 ----
    // 攻防都触发：res.to.piece 即存活方（攻方反杀或守方吃掉来袭子）；同归于尽（to=null）不升。
    // 必须放在上面所有 `res.to.piece === p/defender` 引用判定之后，且以**克隆替换**落地：
    // AI make/unmake 依赖"applyBattle 是替换式写法"（undoAction 回填原 cell 对象），
    // 原地改 rank 会让升级泄漏到搜索的其他分支（ai.js 快照一致性契约）。
    let promotion = null;
    const surv = res.to && res.to.piece;
    if (state.variant === C.VARIANTS.RANK_UP && surv && !C.PIECES[surv.type].special) {
      let np = null;
      if (surv.type === 'engineer') {
        // 工兵 → 超级工兵：每吃一子（含排雷）战力 +1；type 不变（保留排雷/铁路转弯与记牌口径）
        const captures = (surv.captures || 0) + 1;
        np = Object.assign({}, surv, { captures, rank: 1 + captures });
      } else if (surv.rank < C.RANK_MAX) {
        np = Object.assign({}, surv, { rank: surv.rank + 1 }); // 升一级；司令封顶不升
      }
      if (np) {
        state.board[to].piece = np; // board[to] 已在上方以 res.to 落盘，这里只替换棋子对象
        promotion = { side: np.side, type: np.type, fromRank: surv.rank, rank: np.rank, captures: np.captures || 0 };
      }
    }
    return { flagCaptured: res.flagCaptured, outcome, defender, revealedFlags, promotion };
  }

  // 应用一个动作。返回 true 表示成功应用（即使触发胜负也算成功）。
  function applyMove(state, action) {
    if (state.winner) return false;

    if (action.kind === 'flip') {
      const actor = state.turn; // 行动者（回合切换前捕获）——供 prevMove 清空
      const i = action.index;
      if (!Number.isInteger(i) || i < 0 || i >= C.CELL_COUNT) return false;
      const cell = state.board[i];
      if (!cell.piece || cell.revealed) return false;
      cell.revealed = true;
      // 首次翻棋定阵营：翻出的颜色归翻棋者
      if (!state.sidesAssigned) {
        const first = cell.piece.side, other = C.opposite(first);
        if (state.mode === 'pvp') {
          // 双人同屏：双方都是人类，先翻者执翻出的颜色
          state.controllers[first] = 'human';
          state.controllers[other] = 'human';
        } else {
          // 人机：翻出色归人，另一色归 AI
          state.controllers[first] = 'human';
          state.controllers[other] = 'ai';
        }
        state.sidesAssigned = true;
        state.turn = other; // 翻棋者回合结束，轮到对方
      } else {
        state.turn = C.opposite(state.turn);
      }
      state.staleCount = 0; // 翻棋重置困局计数
      // 翻棋不可被走子"反向"，且隔了一手翻棋的回位不算横跳 → 清空行动者的 prevMove。
      // 行动者须在回合切换前捕获（此处 turn 已切到对手）；不能用 lastMove.side——
      // 那是被翻子的颜色而非行动者；未定阵营首翻时 actor=null 跳过，此后按正式回合覆盖
      if (actor) state.prevMove = Object.assign({}, state.prevMove, { [actor]: null });
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
        // rank/captures 记录的是交战前（升级前）的数值：升级结果单独放 battle.promotion，
        // 供 UI 播报"排长 升级为 连长"/"超级工兵 战力 +1"。经典玩法下 promotion 恒为 null。
        state.lastMove = { kind: 'move', from, to, side: p.side, type: p.type,
          rank: p.rank, captures: p.captures || 0,
          battle: { side: info.defender.side, type: info.defender.type,
                    rank: info.defender.rank, captures: info.defender.captures || 0,
                    outcome: info.outcome, revealedFlags: info.revealedFlags,
                    promotion: info.promotion || null } }; // 司令阵亡亮旗：本次自动翻开的军旗格
      } else {
        // 走到空格
        state.board[to] = { piece: p, revealed: true };
        state.board[from] = { piece: null, revealed: false };
        state.staleCount += 1; // 无吃无翻的走子递增
        state.lastMove = { kind: 'move', from, to, side: p.side, type: p.type, battle: null };
      }
      // 记录行动者上一步 move（供 AI 反向走子检测；p.side 即行动者）
      state.prevMove = Object.assign({}, state.prevMove, { [p.side]: { from, to } });
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
