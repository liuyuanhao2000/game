// 军旗翻翻棋 — AI（三档：简单/普通/困难）
// 只依赖 rules 的合法走法生成；难度通过参数注入。
// 不"作弊"：只读已翻子的 side，未翻子用剩余分布概率估算。
;(function () {
  const NS = (typeof window !== 'undefined') ? window : globalThis;
  NS.Junqi = NS.Junqi || {};
  const C = NS.Junqi.constants;
  const B = NS.Junqi.board;
  const R = NS.Junqi.rules;
  const STATE = NS.Junqi.state;

  // ---- 公共：枚举 side 方全部合法动作 ----
  function enumerateActions(state, side) {
    return R.enumerateActions(state, side);
  }

  // 剩余未翻子分布：已知已翻出的子，从每方 25 子总集里扣除
  function remainingDistribution(state) {
    // remaining[type][side] = 该 type+side 还剩多少未出现
    const rem = {};
    for (const side of C.SIDES) {
      for (const type in C.PIECES) rem[type + ':' + side] = C.PIECES[type].count;
    }
    let totalUnrevealed = 0;
    for (let i = 0; i < state.board.length; i++) {
      const cell = state.board[i];
      if (cell.piece && !cell.revealed) {
        totalUnrevealed++;
      } else if (cell.piece && cell.revealed) {
        rem[cell.piece.type + ':' + cell.piece.side] -= 1;
      }
    }
    return { rem, totalUnrevealed };
  }

  // 棋子价值
  function valueOf(type) { return C.PIECE_VALUE[type] || 0; }

  // ---- 简单：随机 ----
  function chooseEasy(state, side) {
    const actions = enumerateActions(state, side);
    if (!actions.length) return null;
    return actions[Math.floor(Math.random() * actions.length)];
  }

  // ---- 普通：贪心启发式 + 1-ply 安全 ----
  // 评估单个动作的即时分数（从 side 视角）
  function scoreActionMedium(state, side, action) {
    if (action.kind === 'flip') {
      // 翻棋信息价值；己方大子已暴露多时则略降（避免继续暴露）
      return 6 + (Math.random() - 0.5) * 2;
    }
    // move
    const from = action.from, to = action.to;
    const p = state.board[from].piece;
    const tcell = state.board[to];
    let s = 0;
    if (tcell.piece) {
      // 攻击
      const d = tcell.piece;
      const res = R.resolveBattle(p, d);
      if (res.flagCaptured) return 100000; // 吃旗直接胜
      if (res.to && res.to.piece && res.to.piece.type === p.type) {
        // 攻击者存活
        s += valueOf(d.type);
      } else if (res.to === null && res.from === null) {
        // 同归（或炸弹）
        s += valueOf(d.type) - valueOf(p.type);
      } else {
        // 攻击者死（撞雷等）
        s -= valueOf(p.type) * 1.2;
      }
    } else {
      // 空走：机动性 + 上铁路奖励 + 进入空行营（安全）小奖励
      if (B.terrainAt(to) === 'railway') s += 1;
      if (B.terrainAt(to) === 'camp') s += 3;
      s += 0.5;
    }
    // 1-ply 安全：落点是否被对方更强子吃到
    const danger = exposureDanger(state, side, from, to, p);
    s -= danger;
    // 暴露己方大子（离开行营）的惩罚
    if (B.terrainAt(from) === 'camp' && valueOf(p.type) >= 45) s -= 4;
    return s + (Math.random() - 0.5) * 0.5;
  }

  // 落点 to 上 piece（来自 fromIdx）被对方下一手吃掉的危险度
  function exposureDanger(state, side, fromIdx, to, piece) {
    if (B.terrainAt(to) === 'camp') return 0; // 行营安全
    const enemy = C.opposite(side);
    // 临时把 piece 放到 to，扫对方合法走法是否含攻击 to
    const snap = state.board.map((c) => ({ piece: c.piece ? { ...c.piece } : null, revealed: c.revealed }));
    const tmpState = { board: snap, rows: state.rows, cols: state.cols };
    snap[fromIdx] = { piece: null, revealed: false }; // 源点清空
    snap[to] = { piece: { ...piece }, revealed: true };
    let danger = 0;
    for (let i = 0; i < snap.length; i++) {
      const cell = snap[i];
      if (cell.piece && cell.revealed && cell.piece.side === enemy) {
        const ms = R.legalMoves(tmpState, i);
        for (const m of ms) {
          if (m.to === to) {
            // 对方能吃到 to；评估交换
            const res = R.resolveBattle(cell.piece, piece);
            if (res.to && res.to.piece && res.to.piece.side === enemy) {
              danger = Math.max(danger, valueOf(piece.type)); // 我子被吃
            } else if (res.to === null && res.from === null) {
              danger = Math.max(danger, valueOf(piece.type) - valueOf(cell.piece.type));
            }
          }
        }
      }
    }
    return danger;
  }

  function chooseMedium(state, side) {
    const actions = enumerateActions(state, side);
    if (!actions.length) return null;
    let best = null, bestS = -Infinity;
    for (const a of actions) {
      const s = scoreActionMedium(state, side, a);
      if (s > bestS) { bestS = s; best = a; }
    }
    return best;
  }

  // ---- 困难：有限深度 expectimax + 概率 ----
  const NODE_BUDGET = 4000;
  const TIME_BUDGET_MS = 800;
  let _nodes = 0, _deadline = 0, _budgetHit = false;

  function BudgetExceeded() {}
  function checkBudget() {
    _nodes++;
    if (_nodes > NODE_BUDGET || Date.now() > _deadline) { _budgetHit = true; throw new BudgetExceeded(); }
  }

  // 估值（从 side 视角）
  function evaluate(state, side) {
    checkBudget();
    let score = 0;
    const enemy = C.opposite(side);
    // 拔雷进度：拔对方雷=向胜利推进（+），己方雷被拔=己方军旗更暴露（−）
    if (state.minesLost) {
      score += (state.minesLost[enemy] - state.minesLost[side]) * 20;
    }
    const { rem, totalUnrevealed } = remainingDistribution(state);
    for (let i = 0; i < state.board.length; i++) {
      const cell = state.board[i];
      if (!cell.piece) continue;
      if (cell.revealed) {
        const sign = cell.piece.side === side ? 1 : -1;
        score += sign * valueOf(cell.piece.type);
        // 暴露风险：己方大子在非行营且可达则扣分
        if (cell.piece.side === side && B.terrainAt(i) !== 'camp' && valueOf(cell.piece.type) >= 45) {
          score -= exposureDanger(state, side, i, i, cell.piece) * 0.5;
        }
      } else {
        // 未翻子：按剩余分布算期望（归属未知，简化对半归属两方）
        // 期望价值 = sum_type P(type) * value(type)，归属对半
        if (totalUnrevealed > 0) {
          let ev = 0;
          for (const key in rem) {
            const p = rem[key] / totalUnrevealed;
            const [type, s2] = key.split(':');
            ev += p * valueOf(type) * (s2 === side ? 0.5 : -0.5);
          }
          score += ev * 0.5; // 不确定折扣
        }
      }
    }
    return score;
  }

  // 克隆状态（深拷贝 board，丢弃 onChange）
  function clone(state) {
    return {
      board: state.board.map((c) => ({ piece: c.piece ? { ...c.piece } : null, revealed: c.revealed })),
      rows: state.rows, cols: state.cols,
      turn: state.turn, playerSide: state.playerSide, aiSide: state.aiSide,
      sidesAssigned: state.sidesAssigned, winner: state.winner, staleCount: state.staleCount,
      minesLost: { red: state.minesLost.red, blue: state.minesLost.blue },
      history: state.history.slice(), onChange: null,
    };
  }

  // 在克隆上应用动作（不触发 notify）
  function applyOnClone(state, action) {
    const s = state; // already a clone
    if (s.winner) return;
    if (action.kind === 'flip') {
      const cell = s.board[action.index];
      cell.revealed = true;
      if (!s.sidesAssigned) {
        s.playerSide = cell.piece.side; s.aiSide = C.opposite(s.playerSide);
        s.sidesAssigned = true; s.turn = s.aiSide;
      } else { s.turn = C.opposite(s.turn); }
      s.staleCount = 0;
      s.winner = R.checkWinner(s);
      return;
    }
    const from = action.from, to = action.to;
    const fcell = s.board[from], tcell = s.board[to];
    const p = fcell.piece;
    if (tcell.piece) {
      // 军旗保护（legalMoves 已过滤，此处防御）
      if (tcell.piece.type === 'flag' && s.minesLost[tcell.piece.side] < C.MINES_PER_SIDE) return;
      const defender = tcell.piece;
      const res = R.resolveBattle(p, defender);
      s.board[from] = { piece: null, revealed: false };
      s.board[to] = { piece: res.to ? res.to.piece : null, revealed: res.to ? res.to.revealed : false };
      if (defender.type === 'mine' &&
          !(res.to && res.to.piece && res.to.piece.type === 'mine')) {
        s.minesLost[defender.side] += 1;
      }
      if (res.flagCaptured) s.winner = p.side;
      s.staleCount = 0;
    } else {
      s.board[to] = { piece: p, revealed: true };
      s.board[from] = { piece: null, revealed: false };
      s.staleCount += 1;
    }
    s.turn = C.opposite(s.turn);
    if (!s.winner) s.winner = R.checkWinner(s);
  }

  // expectimax：max 节点（side 方选择），flip 动作产生 chance 节点
  function expectimax(state, side, depth) {
    checkBudget();
    if (state.winner) {
      if (state.winner === 'draw') return 0;
      return state.winner === side ? 100000 : -100000;
    }
    if (depth <= 0) return evaluate(state, side);

    const actions = enumerateActions(state, state.turn);
    if (!actions.length) {
      return state.turn === side ? -100000 : 100000; // 无棋可走=负
    }

    const mover = state.turn;
    let best;
    if (mover === side) {
      best = -Infinity;
      for (const a of actions) {
        const v = actionValue(state, a, side, depth);
        if (v > best) best = v;
      }
    } else {
      best = Infinity;
      for (const a of actions) {
        const v = actionValue(state, a, side, depth);
        if (v < best) best = v;
      }
    }
    return best;
  }

  // 单个动作的期望值：move 为确定，flip 为 chance（按剩余分布 top-K 采样）
  function actionValue(state, action, side, depth) {
    checkBudget();
    if (action.kind === 'move') {
      const s = clone(state);
      applyOnClone(s, action);
      return expectimax(s, side, depth - 1);
    }
    // flip -> chance 节点
    const { rem, totalUnrevealed } = remainingDistribution(state);
    if (totalUnrevealed <= 0) return evaluate(state, side);
    // 取 top-K 概率结果
    const probs = [];
    for (const key in rem) {
      if (rem[key] > 0) probs.push({ key, p: rem[key] / totalUnrevealed });
    }
    probs.sort((a, b) => b.p - a.p);
    const K = Math.min(3, probs.length);
    let exp = 0, weightSum = 0;
    for (let k = 0; k < K; k++) {
      const { key, p } = probs[k];
      weightSum += p;
      const [type, side2] = key.split(':');
      const s = clone(state);
      // 模拟翻开该格为 (type, side2)
      s.board[action.index].revealed = true;
      s.board[action.index].piece = { type, rank: C.PIECES[type].rank, side: side2 };
      s.staleCount = 0;
      s.turn = C.opposite(s.turn);
      s.winner = R.checkWinner(s);
      exp += p * expectimax(s, side, depth - 1);
    }
    // 归一化（top-K 未覆盖部分用当前估值近似）
    if (weightSum < 1) {
      exp += (1 - weightSum) * evaluate(state, side);
    } else {
      exp = exp / weightSum; // 归一化
    }
    return exp;
  }

  function chooseHard(state, side) {
    _nodes = 0; _deadline = Date.now() + TIME_BUDGET_MS; _budgetHit = false;
    try {
      const actions = enumerateActions(state, side);
      if (!actions.length) return null;
      const DEPTH = 2;
      let best = null, bestV = -Infinity;
      for (const a of actions) {
        const v = actionValue(state, a, side, DEPTH);
        if (v > bestV) { bestV = v; best = a; }
      }
      return best;
    } catch (e) {
      if (e instanceof BudgetExceeded) {
        return chooseMedium(state, side); // 回退普通档
      }
      throw e;
    }
  }

  function chooseMove(state, difficulty, side) {
    if (difficulty === C.DIFFICULTY.EASY) return chooseEasy(state, side);
    if (difficulty === C.DIFFICULTY.MEDIUM) return chooseMedium(state, side);
    return chooseHard(state, side);
  }

  NS.Junqi.ai = {
    chooseMove, enumerateActions, evaluate, remainingDistribution,
  };
})();
