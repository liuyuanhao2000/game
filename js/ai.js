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
    // 扣除已被吃/移除的子（它们既不在棋盘、也不是暗子）
    if (state.captured) {
      for (const k in state.captured) rem[k] -= state.captured[k];
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
  // 评估单个动作的即时分数（从 side 视角）；threat 为整局决策只算一次的威胁图
  function scoreActionMedium(state, side, action, threat, totalUnrevealed) {
    if (action.kind === 'flip') {
      // 翻棋价值随暗子数衰减：开局(≥45 暗子)≈7 仍积极，中局≈4.8，残局≈3.4
      let base = 3 + 4 * Math.min(1, totalUnrevealed / 45);
      // 有己方大子正被威胁：先处理威胁，翻棋让路
      if (threat && threat.loss.some((l, i) => {
        const c = state.board[i];
        return l >= 45 && c.piece && c.revealed && c.piece.side === side &&
          C.IMMOBILE.indexOf(c.piece.type) === -1;
      })) base -= 2;
      return base + (Math.random() - 0.5) * 2;
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
      } else if (res.to === null) {
        // 同归（或炸弹）
        s += valueOf(d.type) - valueOf(p.type);
      } else {
        // 攻击者死（撞雷等）
        s -= valueOf(p.type) * 1.2;
      }
      // 炸弹节制：别拿炸弹换小子（旗与司令/军长/师长≥60 除外）
      if (p.type === 'bomb' && d.type !== 'flag' && valueOf(d.type) < 60) {
        s -= (60 - valueOf(d.type)) * 0.6;
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
    // ★撤离收益：被威胁的子任何走法都 +D(from)，使"逃命"能与别处的小捕获竞争
    // （D(from) 是子内常量偏移，不改变"往哪逃"——那由 D_to 与行营奖励决定）
    if (threat) s += dangerAt(threat, from);
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
    const tmpState = { board: snap, rows: state.rows, cols: state.cols,
      minesLost: state.minesLost, captured: state.captured };
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
            } else if (res.to === null) {
              danger = Math.max(danger, valueOf(piece.type) - valueOf(cell.piece.type));
            }
          }
        }
      }
    }
    return danger;
  }

  // ---- 原位威胁扫描（medium 的撤离收益与 evaluate 的威胁扣分共用）----
  // 在**当前局面、不挪子**的前提下，扫 side 之敌方的全部已翻子的合法走法，
  // 累计 side 方每个占格若被攻击的最大交换损失。
  // 只读 revealed（不作弊）；行营免疫由 legalMoves 天然排除。
  // 语义：仅用于"原位威胁"。落点危险 D_to 必须继续用 exposureDanger（它建模让位后的铁路贯穿，此处会低估）。
  // 返回 { loss: number[60], attacker: (string|null)[60], enemyMoves: number }
  function threatMapOf(state, side) {
    const enemy = C.opposite(side);
    const loss = new Array(C.CELL_COUNT).fill(0);
    const attacker = new Array(C.CELL_COUNT).fill(null);
    let enemyMoves = 0;
    for (let i = 0; i < state.board.length; i++) {
      const cell = state.board[i];
      if (!cell.piece || !cell.revealed || cell.piece.side !== enemy) continue;
      const ms = R.legalMoves(state, i);
      enemyMoves += ms.length;
      for (const m of ms) {
        const t = state.board[m.to];
        if (!t.piece || t.piece.side !== side) continue; // 空格走法 / 非攻击我方
        const res = R.resolveBattle(cell.piece, t.piece);
        let l;
        if (res.to && res.to.piece && res.to.piece.side === side) {
          l = 0; // 敌攻击者死、我子存活 → 无损失
        } else if (res.to === null) {
          l = Math.max(0, valueOf(t.piece.type) - valueOf(cell.piece.type)); // 同归：净损失
        } else {
          l = valueOf(t.piece.type); // 我子被吃
        }
        if (l > loss[m.to]) { loss[m.to] = l; attacker[m.to] = cell.piece.type; }
      }
    }
    return { loss, attacker, enemyMoves };
  }

  // O(1) 查表：threat 下 index 格的原位威胁值
  function dangerAt(threat, index) { return threat.loss[index]; }

  function chooseMedium(state, side) {
    const actions = enumerateActions(state, side);
    if (!actions.length) return null;
    const threat = threatMapOf(state, side); // 整局决策只算一次，供撤离收益查表
    let totalUnrevealed = 0;
    for (let i = 0; i < state.board.length; i++) {
      const c = state.board[i];
      if (c.piece && !c.revealed) totalUnrevealed++;
    }
    let best = null, bestS = -Infinity;
    for (const a of actions) {
      const s = scoreActionMedium(state, side, a, threat, totalUnrevealed);
      if (s > bestS) { bestS = s; best = a; }
    }
    return best;
  }

  // ---- 困难：有限深度 expectimax + 概率 ----
  const NODE_BUDGET = 4000;
  const TIME_BUDGET_MS = 800;
  let _nodes = 0, _deadline = 0;

  function BudgetExceeded() {}
  function checkBudget() {
    if (!_deadline) return; // 不在搜索中（如外部直接调 evaluate）→ 不设限
    _nodes++;
    if (_nodes > NODE_BUDGET || Date.now() > _deadline) throw new BudgetExceeded();
  }

  // 威胁扣分权重（分层；工兵在敌方尚有雷时按拔雷资产抬高）
  function threatWeight(type, enemyMinesLeft) {
    if (type === 'engineer' && enemyMinesLeft > 0) return 0.5;
    const v = valueOf(type);
    if (v >= 60) return 0.6;   // 司令/军长/师长
    if (v >= 30) return 0.35;  // 旅长/团长/炸弹
    return 0.15;               // 营长/连长/排长
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
    // 威胁扣分：threatMapOf 单遍零拷贝扫描（替换旧版"每个大子一次 exposureDanger 深拷贝"，约 3× 提速、覆盖放宽到全部可动子）
    const threat = threatMapOf(state, side);
    const enemyMinesLeft = state.minesLost ? (C.MINES_PER_SIDE - state.minesLost[enemy]) : C.MINES_PER_SIDE;
    const { rem, totalUnrevealed } = remainingDistribution(state);
    for (let i = 0; i < state.board.length; i++) {
      const cell = state.board[i];
      if (!cell.piece) continue;
      if (cell.revealed) {
        const sign = cell.piece.side === side ? 1 : -1;
        score += sign * valueOf(cell.piece.type);
        // 己方受威胁的可动子（非行营、非雷/旗）按分层权重扣分
        if (cell.piece.side === side && B.terrainAt(i) !== 'camp' &&
            C.IMMOBILE.indexOf(cell.piece.type) === -1) {
          const l = dangerAt(threat, i);
          if (l > 0) score -= l * threatWeight(cell.piece.type, enemyMinesLeft);
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
    // ---- 机动性 + 工兵拔雷：己方已翻可动子单遍 legalMoves（副产物复用）----
    let ownMoves = 0, engineerClears = 0;
    for (let i = 0; i < state.board.length; i++) {
      const cell = state.board[i];
      if (!cell.piece || !cell.revealed || cell.piece.side !== side) continue;
      if (C.IMMOBILE.indexOf(cell.piece.type) !== -1) continue;
      const ms = R.legalMoves(state, i);
      ownMoves += ms.length;
      if (cell.piece.type === 'engineer' && enemyMinesLeft > 0) {
        for (const m of ms) {
          const t = state.board[m.to];
          if (t.piece && t.piece.side === enemy && t.piece.type === 'mine') { engineerClears++; break; }
        }
      }
    }
    score += 0.5 * (ownMoves - threat.enemyMoves);
    score += engineerClears * 6;

    // ---- 军旗防御：仅当己方地雷已被拔（军旗开始 exposed）才触发；只认已翻己旗（不读暗子，不作弊）----
    if (state.minesLost && state.minesLost[side] > 0) {
      let flagIdx = -1;
      for (let i = 0; i < state.board.length; i++) {
        const c = state.board[i];
        if (c.piece && c.revealed && c.piece.type === 'flag' && c.piece.side === side) { flagIdx = i; break; }
      }
      if (flagIdx >= 0) {
        const [fr, fc] = B.rc(flagIdx);
        let near = 0, guards = 0;
        for (let i = 0; i < state.board.length; i++) {
          const c = state.board[i];
          if (!c.piece || !c.revealed || C.IMMOBILE.indexOf(c.piece.type) !== -1) continue;
          const [pr, pc] = B.rc(i);
          const dist = Math.abs(pr - fr) + Math.abs(pc - fc);
          if (c.piece.side === enemy) near += Math.max(0, 5 - dist); // 敌子越近越危险
          else if (dist <= 1) guards++;                              // 己方贴身护卫
        }
        score -= state.minesLost[side] * 1.5 * near;
        score += Math.min(6, guards * 2);
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
      captured: Object.assign({}, state.captured || {}),
      onChange: null,
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
      const info = STATE.applyBattle(s, from, to);
      if (info.flagCaptured) s.winner = p.side;
      s.staleCount = 0;
    } else {
      s.board[to] = { piece: p, revealed: true };
      s.board[from] = { piece: null, revealed: false };
      s.staleCount += 1;
    }
    s.turn = C.opposite(s.turn);
    if (!s.winner) s.winner = R.checkWinner(s);
  }

  // ---- 走法排序（提升剪枝效率与预算内深度完成度）----
  // threat 非空=根节点精确排序（含逃离桶）；null=深节点廉价静态排序（禁止跑 threatMapOf，否则每节点 ×25 扫爆预算）
  function actionKey(state, side, action, threat) {
    if (action.kind === 'flip') return 50000;
    const from = action.from, to = action.to;
    const p = state.board[from].piece;
    const tcell = state.board[to];
    if (tcell.piece) {
      const res = R.resolveBattle(p, tcell.piece);
      if (res.flagCaptured) return 1000000;                                    // 夺旗置顶
      if (res.to && res.to.piece === p) {                                      // 攻击者存活（含工兵拔雷）：MVV-LVA
        return 200000 + valueOf(tcell.piece.type) * 16 - valueOf(p.type);
      }
      if (res.to === null) return 100000 + valueOf(tcell.piece.type) - valueOf(p.type); // 同归：按交换差
      return valueOf(tcell.piece.type) - valueOf(p.type) * 2;                  // 攻击者阵亡（撞强/撞雷）：垫底
    }
    // 安静走法：被威胁子的逃离优先
    if (threat) {
      const d = dangerAt(threat, from);
      if (d > 0) return 150000 + d + (B.terrainAt(to) === 'camp' ? 1000 : 0);
    }
    let k = 10000;
    if (B.terrainAt(to) === 'camp') k += 2;
    else if (B.terrainAt(to) === 'railway') k += 1;
    return k;
  }

  function orderActions(state, side, actions, threat) {
    if (actions.length < 2) return actions;
    return actions
      .map((a) => ({ a, k: actionKey(state, side, a, threat) }))
      .sort((x, y) => y.k - x.k)
      .map((x) => x.a);
  }

  // expectimax + alpha-beta：max/min 节点按窗口剪枝；flip 动作产生 chance 节点
  function expectimax(state, side, depth, alpha = -Infinity, beta = Infinity) {
    checkBudget();
    if (state.winner) {
      if (state.winner === 'draw') return 0;
      return state.winner === side ? 100000 : -100000;
    }
    if (depth <= 0) return evaluate(state, side);

    const actions = orderActions(state, state.turn, enumerateActions(state, state.turn), null);
    if (!actions.length) {
      return state.turn === side ? -100000 : 100000; // 无棋可走=负
    }

    const mover = state.turn;
    let best;
    if (mover === side) {
      best = -Infinity;
      for (const a of actions) {
        const v = actionValue(state, a, side, depth, alpha, beta);
        if (v > best) best = v;
        if (best > alpha) alpha = best;
        if (alpha >= beta) break; // 剪枝
      }
    } else {
      best = Infinity;
      for (const a of actions) {
        const v = actionValue(state, a, side, depth, alpha, beta);
        if (v < best) best = v;
        if (best < beta) beta = best;
        if (alpha >= beta) break; // 剪枝
      }
    }
    return best;
  }

  // 单个动作的期望值：move 为确定（传窗口），flip 为 chance（按剩余分布 top-K 采样，全窗口取精确期望）
  function actionValue(state, action, side, depth, alpha = -Infinity, beta = Infinity) {
    checkBudget();
    if (action.kind === 'move') {
      const s = clone(state);
      applyOnClone(s, action);
      return expectimax(s, side, depth - 1, alpha, beta);
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
      // chance 子树强制全窗口：截断值参与加权平均会有偏
      exp += p * expectimax(s, side, depth - 1, -Infinity, Infinity);
    }
    // 归一化（top-K 未覆盖部分用当前估值近似）
    if (weightSum < 1) {
      exp += (1 - weightSum) * evaluate(state, side);
    } else {
      exp = exp / weightSum; // 归一化
    }
    return exp;
  }

  const MAX_DEPTH = 8;

  function chooseHard(state, side) {
    _nodes = 0; _deadline = Date.now() + TIME_BUDGET_MS;
    try {
      const actions = enumerateActions(state, side);
      if (!actions.length) return null;
      const threat = threatMapOf(state, side);
      let ordered = orderActions(state, side, actions, threat); // 根节点精确排序
      let bestSoFar = ordered[0]; // 兜底＝静态最优着：任何情况下都有确定走法，不再回退 medium
      let lastIterMs = 0;
      for (let depth = 1; depth <= MAX_DEPTH; depth++) {
        // 软停：预计本层跑不完剩余时间就不开新深度
        if (lastIterMs > 0 && Date.now() + lastIterMs * 3 > _deadline) break;
        const t0 = Date.now();
        let best = null, bestV = -Infinity;
        const scores = [];
        try {
          for (const a of ordered) {
            const v = actionValue(state, a, side, depth, bestV, Infinity); // 根窗口：(当前最优, +∞)
            scores.push({ a, v });
            if (v > bestV) { bestV = v; best = a; }
          }
          bestSoFar = best; // ★ 只有完整跑完的深度才提交
          ordered = scores.sort((x, y) => y.v - x.v).map((x) => x.a); // best-first 喂下一层
          lastIterMs = Date.now() - t0;
        } catch (e) {
          if (e instanceof BudgetExceeded) return bestSoFar; // ★ 半途中断 → 返回上一层最优根着
          throw e;
        }
      }
      return bestSoFar;
    } catch (e) {
      if (e instanceof BudgetExceeded) return null; // 理论不可达（内层已捕获）
      return chooseMedium(state, side); // 非预算异常的终极兜底
    } finally {
      _deadline = 0; // 搜索结束：解除预算闸，后续直接调 evaluate 不再受限
    }
  }

  function chooseMove(state, difficulty, side) {
    if (difficulty === C.DIFFICULTY.EASY) return chooseEasy(state, side);
    if (difficulty === C.DIFFICULTY.MEDIUM) return chooseMedium(state, side);
    return chooseHard(state, side);
  }

  NS.Junqi.ai = {
    chooseMove, enumerateActions, evaluate, remainingDistribution,
    threatMapOf, dangerAt, threatWeight,
  };
})();
