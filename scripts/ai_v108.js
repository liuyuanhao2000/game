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

  // ---- 位置项静态查找表（模块加载时算一次；evaluate 热路径只做下标/成员查询）----
  // 注意：翻翻棋开局 50 子全盘随机布子，没有"己方半场"，军旗位置未知——
  // 因此位置项均为方向无关形式：行营=免疫+八向机动枢纽，穿河点=过河咽喉，价值对双方对称。
  const CAMP_LIST = [];                          // [{ idx, ring }] ring=行营接触格（正交∪对角去重）
  for (let i = 0; i < C.CELL_COUNT; i++) {
    if (B.terrainAt(i) !== 'camp') continue;
    const ringSet = new Set();
    for (const n of B.orthNeighbors(i)) ringSet.add(n);
    for (const n of B.diagNeighbors(i)) ringSet.add(n);
    CAMP_LIST.push({ idx: i, ring: Array.from(ringSet) });
  }
  // 楚河穿河点：row5↔6 仅 C1/C3/C5（RIVER_COLS）可过
  const GATES = [B.idx(5, 0), B.idx(5, 2), B.idx(5, 4), B.idx(6, 0), B.idx(6, 2), B.idx(6, 4)];
  const GATE_SET = new Set(GATES);
  const GATE_RING = {};                          // 穿河点 -> 正交邻居（楚河已过滤）
  for (const g of GATES) GATE_RING[g] = B.orthNeighbors(g);

  // 位置项权重（A/B 调参与回退：单项置 0 即关闭；相对 PIECE_VALUE 定标——吃个排长=12 分，位置单项 ~1-2 分）
  // 权重经 A/B 校准：初版（campBig=3.5 等）导致蹲营和棋率上升与对上一版胜率回退，整体减半
  const POS_W = {
    campBig: 1.5,      // 己方大子(≥45)占行营：免疫+八向枢纽
    campSmall: 0.5,    // 己方小子占行营：占位价值低
    campEnemy: -2,     // 敌占行营（对称设计）
    umbrella: 0.8,     // 敌占营时己子贴身伞控（每子，每营封顶 3）
    umbrellaNear: 0.4, // 己子邻接空营（下一手可入营，每营封顶 1）
    gateOwn: 1.5,      // 己方可动子占穿河点
    gateEnemy: -1.5,   // 敌占穿河点（我方过河咽喉受控；暗雷/旗挡门同样阻断，计入）
    gatePress: 0.4,    // 己子贴身敌占穿河点（每点封顶 1）
  };
  const UMBRELLA_CAP = 3;

  // 防蹲营刷分：行营免疫+正分可能诱发"蹲营拖和棋"，位置项随无吃无翻进度衰减（下限 0.4）
  function tempoOf(state) {
    const t = 1 - (state.staleCount || 0) / C.STALE_LIMIT;
    return t > 0.4 ? t : 0.4;
  }

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
      // 位置偏好：翻棋格邻接己方大子 → 减分（翻出敌司令/炸弹贴脸大子是最坏情形）；铁路/穿河点 → 加分
      for (const n of B.orthNeighbors(action.index)) {
        const c = state.board[n];
        if (c.piece && c.revealed && c.piece.side === side && valueOf(c.piece.type) >= 45) {
          base -= 2.5;
          break;
        }
      }
      if (B.terrainAt(action.index) === 'railway' || GATE_SET.has(action.index)) base += 0.8;
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

  // ---- 单遍活动扫描（威胁图 + 己方机动/工兵拔雷合并，legalMoves 调用次数较两遍扫描减半）----
  // 在**当前局面、不挪子**的前提下，扫双方全部已翻子的合法走法：
  // - 敌方：累计 side 方每个占格被攻击的最大交换损失（loss/attacker）与敌方总走法数
  // - 己方：累计机动走法数与工兵拔雷机会
  // 只读 revealed（不作弊）；行营免疫由 legalMoves 天然排除。
  // 语义：仅用于"原位威胁"。落点危险 D_to 必须继续用 exposureDanger（它建模让位后的铁路贯穿，此处会低估）。
  function scanActivity(state, side) {
    const enemy = C.opposite(side);
    const loss = new Array(C.CELL_COUNT).fill(0);
    const attacker = new Array(C.CELL_COUNT).fill(null);
    let enemyMoves = 0, ownMoves = 0, engineerClears = 0;
    const enemyMinesLeft = state.minesLost ? (C.MINES_PER_SIDE - state.minesLost[enemy]) : C.MINES_PER_SIDE;
    for (let i = 0; i < state.board.length; i++) {
      const cell = state.board[i];
      if (!cell.piece || !cell.revealed) continue;
      const isEnemy = cell.piece.side === enemy;
      if (!isEnemy && cell.piece.side !== side) continue;
      if (!isEnemy && C.IMMOBILE.indexOf(cell.piece.type) !== -1) continue; // 己方雷/旗不动，免调 legalMoves
      const ms = R.legalMoves(state, i);
      if (isEnemy) {
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
      } else {
        ownMoves += ms.length;
        if (cell.piece.type === 'engineer' && enemyMinesLeft > 0) {
          for (const m of ms) {
            const t = state.board[m.to];
            if (t.piece && t.piece.side === enemy && t.piece.type === 'mine') { engineerClears++; break; }
          }
        }
      }
    }
    return { loss, attacker, enemyMoves, ownMoves, engineerClears };
  }

  // 兼容入口（medium 与测试使用）：仅威胁图部分
  function threatMapOf(state, side) {
    const a = scanActivity(state, side);
    return { loss: a.loss, attacker: a.attacker, enemyMoves: a.enemyMoves };
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

  // ---- 困难/大师：有限深度 expectimax + 概率 ----
  // 难度预置：master = 更深预算 + 叶子静态交换搜索(quiescence) + 翻棋采样加宽
  const PRESETS = {
    // 设计基线：1.0.3 是实战验证"最强人机体验"的版本。v1.0.6 起回退其后被真人对战证伪的"优化"
    // （鞅暗子估值、FLIP_PREF 翻棋位置偏好、占营优先根修正——自弈 A/B 不差，但真人体验为负：
    //  翻棋过多/蹲营被动），仅保留客观正收益的基础设施（make/unmake 节点率、scanActivity 合并扫描、
    //  更高节点预算）。
    // openingCamp（v1.0.7）：开局占营根修正——开局窗口内最优着为翻棋且可入空营时改入营，
    // 严格限定开局（暗子≥25）+占营饱和（<3），中后期与基线一致。
    // positional：位置项保持关闭（30 局 A/B 负收益：伞控诱导"围营跳舞"）；机制经 evaluate(opts.positional) 保留供单测。
    hard:   { time: 800,  nodes: 6000,  maxDepth: 8,  flipK: 3, flipPMin: 0,    quiesce: true, qdepth: 4, qDelta: 20, positional: false, openingCamp: true, flipCollapse: false, flipCollapseDepth: 2, makeUnmake: true },
    master: { time: 4500, nodes: 35000, maxDepth: 12, flipK: 5, flipPMin: 0.06, quiesce: true, qdepth: 4, qDelta: 20, positional: false, openingCamp: true, flipCollapse: false, flipCollapseDepth: 2, makeUnmake: true },
  };
  const ASPIRATION = 40; // 迭代加深 aspiration 半宽（围绕上轮值开窗，失败则全窗口重搜）
  let _cfg = PRESETS.hard; // 当前搜索配置（chooseHard 入口设置，finally 复位为 hard 语义）
  let _nodes = 0, _deadline = 0, _lastDepth = 0; // _lastDepth：最近一次搜索完成的迭代深度（观测用）
  let _killers = [];       // killer moves：按剩余深度索引，每层 ≤2 个触发截断的安静走法

  function BudgetExceeded() {}
  function checkBudget() {
    if (!_deadline) return; // 不在搜索中（如外部直接调 evaluate）→ 不设限
    _nodes++;
    if (_nodes > _cfg.nodes || Date.now() > _deadline) throw new BudgetExceeded();
  }

  // 威胁扣分权重（分层；工兵在敌方尚有雷时按拔雷资产抬高）
  function threatWeight(type, enemyMinesLeft) {
    if (type === 'engineer' && enemyMinesLeft > 0) return 0.5;
    const v = valueOf(type);
    if (v >= 60) return 0.6;   // 司令/军长/师长
    if (v >= 30) return 0.35;  // 旅长/团长/炸弹
    return 0.15;               // 营长/连长/排长
  }

  // 廉价基线估值：拔雷进度 + 子力 + 暗子期望（无 legalMoves 扫描；供主搜索 delta 剪枝复用）
  function evaluateBase(state, side) {
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
      // 军旗不计材料：军旗是终局目标（夺旗=±100000 终局分）。若按 PIECE_VALUE 计 1000，
      // "吃掉敌方司令→敌旗翻开"会被估成敌材料 +1000 的大亏，AI 将系统性回避击杀敌方司令。
      // 亮旗是纯信息变化（配合 rush/军旗防御项生效），材料估值必须为零。
      if (cell.piece.type === 'flag') continue;
      if (cell.revealed) {
        score += (cell.piece.side === side ? 1 : -1) * valueOf(cell.piece.type);
      } else if (totalUnrevealed > 0) {
        // 未翻子：按剩余分布算期望（归属未知，简化对半归属两方）
        // 1.0.3 实战验证过的方案：归属 ±0.5 + 0.5 不确定折扣（净 0.25 权重）——
        // 终局估值以已翻子力为主，翻棋的"实现波动"更大，AI 攻守判断更接近实战强手的风格。
        // 注：曾改为鞅设计（±1 无折扣，防"翻棋刷分"），A/B 自弈不差，但真人对战体验变差（被动），回退。
        let ev = 0;
        for (const key in rem) {
          const p = rem[key] / totalUnrevealed;
          const [type, s2] = key.split(':');
          if (type === 'flag') continue; // 军旗不入期望（与上面"不计材料"保持一致）
          ev += p * valueOf(type) * (s2 === side ? 0.5 : -0.5);
        }
        score += ev * 0.5; // 不确定折扣
      }
    }
    return score;
  }

  // 估值（从 side 视角）：基线 + 威胁扣分 + 机动性 + 工兵拔雷 + 位置项（占营/伞控/穿河点）
  // opts.positional 可显式覆盖默认（单测在预置默认关闭时仍可直测位置项机制）
  function evaluate(state, side, opts) {
    checkBudget();
    let score = evaluateBase(state, side);
    const enemy = C.opposite(side);
    const enemyMinesLeft = state.minesLost ? (C.MINES_PER_SIDE - state.minesLost[enemy]) : C.MINES_PER_SIDE;
    // 威胁扣分：scanActivity 单遍零拷贝扫描（威胁图+机动性合并，legalMoves 调用较两遍扫描减半）
    const act = scanActivity(state, side);
    // ---- 单遍逐格循环：威胁扣分 + 占营/穿河点占用计数（位置项主环）----
    const positional = opts ? opts.positional !== false : _cfg.positional !== false;
    const tempo = positional ? tempoOf(state) : 0;
    let campBig = 0, campSmall = 0, campEnemy = 0, gateOwnN = 0, gateEnemyN = 0;
    const board = state.board;
    for (let i = 0; i < board.length; i++) {
      const cell = board[i];
      if (!cell.piece || !cell.revealed) continue;
      const mine = cell.piece.side === side;
      const terrain = B.terrainAt(i);
      if (mine) {
        if (terrain !== 'camp' && C.IMMOBILE.indexOf(cell.piece.type) === -1) {
          const l = act.loss[i]; // 己方受威胁的可动子按分层权重扣分
          if (l > 0) score -= l * threatWeight(cell.piece.type, enemyMinesLeft);
        }
        if (terrain === 'camp') {
          if (valueOf(cell.piece.type) >= 45) campBig++; else campSmall++;
        } else if (GATE_SET.has(i) && C.IMMOBILE.indexOf(cell.piece.type) === -1) {
          gateOwnN++;
        }
      } else {
        if (terrain === 'camp') campEnemy++;       // 营内必为可动子（营格初始为空，雷/旗不可移入）
        else if (GATE_SET.has(i)) gateEnemyN++;    // 暗雷/旗挡穿河点同样阻断，计入
      }
    }
    if (positional) {
      score += tempo * (POS_W.campBig * campBig + POS_W.campSmall * campSmall +
        POS_W.campEnemy * campEnemy + POS_W.gateOwn * gateOwnN + POS_W.gateEnemy * gateEnemyN);
      // ---- 伞控/入营预备（每营 O(8)）----
      for (const camp of CAMP_LIST) {
        const occupant = board[camp.idx].piece;
        if (occupant && occupant.side === enemy) {
          let u = 0; // 敌占营不可攻击，只能贴身伞控/封锁
          for (const n of camp.ring) {
            const c = board[n];
            if (c.piece && c.revealed && c.piece.side === side &&
                C.IMMOBILE.indexOf(c.piece.type) === -1) u++;
          }
          score += tempo * POS_W.umbrella * Math.min(UMBRELLA_CAP, u);
        } else if (!occupant) {
          for (const n of camp.ring) { // 空营：己子邻接=下一手可入营，每营封顶 1
            const c = board[n];
            if (c.piece && c.revealed && c.piece.side === side &&
                C.IMMOBILE.indexOf(c.piece.type) === -1) {
              score += tempo * POS_W.umbrellaNear;
              break;
            }
          }
        }
      }
      // ---- 穿河点贴身压制 ----
      for (const g of GATES) {
        const occ = board[g].piece;
        if (occ && occ.side === enemy) {
          for (const n of GATE_RING[g]) {
            const c = board[n];
            if (c.piece && c.revealed && c.piece.side === side &&
                C.IMMOBILE.indexOf(c.piece.type) === -1) {
              score += tempo * POS_W.gatePress;
              break;
            }
          }
        }
      }
    }
    score += 0.5 * (act.ownMoves - act.enemyMoves);
    score += act.engineerClears * 6;

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
    // ---- 进攻项 rush（双档共享，诚实）：敌雷拔光且敌旗已翻 → 己方可动子近敌旗加分 ----
    if (state.minesLost && state.minesLost[enemy] >= C.MINES_PER_SIDE) {
      let eFlagIdx = -1;
      for (let i = 0; i < state.board.length; i++) {
        const c = state.board[i];
        if (c.piece && c.revealed && c.piece.type === 'flag' && c.piece.side === enemy) { eFlagIdx = i; break; }
      }
      if (eFlagIdx >= 0) {
        const [efr, efc] = B.rc(eFlagIdx);
        let rush = 0;
        for (let i = 0; i < state.board.length; i++) {
          const c = state.board[i];
          if (!c.piece || !c.revealed || c.piece.side !== side) continue;
          if (C.IMMOBILE.indexOf(c.piece.type) !== -1) continue;
          const [pr, pc] = B.rc(i);
          rush += Math.max(0, 6 - (Math.abs(pr - efr) + Math.abs(pc - efc))) * 1.5;
        }
        score += Math.min(12, rush);
      }
    }
    return score;
  }

  // 克隆状态（深拷贝 board，丢弃 onChange）
  function clone(state) {
    return {
      board: state.board.map((c) => ({ piece: c.piece ? { ...c.piece } : null, revealed: c.revealed })),
      rows: state.rows, cols: state.cols,
      turn: state.turn, controllers: { red: (state.controllers || {}).red || null, blue: (state.controllers || {}).blue || null },
      sidesAssigned: state.sidesAssigned, winner: state.winner, staleCount: state.staleCount,
      minesLost: { red: state.minesLost.red, blue: state.minesLost.blue },
      captured: Object.assign({}, state.captured || {}),
      onChange: null,
    };
  }

  // ---- make/unmake：原位应用/撤销动作（替代每节点深拷贝，预期 1.5~2× 节点率）----
  // applyAction 返回 undo 记录；undoAction 按记录原位恢复。
  // 约束：不得污染调用方状态（撤销后必须与调用前逐位一致——快照一致性测试依赖 boardSig）。
  function applyAction(state, action) {
    const undo = {
      prevTurn: state.turn, prevStale: state.staleCount, prevWinner: state.winner,
      prevMinesRed: state.minesLost.red, prevMinesBlue: state.minesLost.blue,
      prevSidesAssigned: state.sidesAssigned, prevControllers: null,
      flipCell: null, fromCell: null, toCell: null, prevCaptured: null, revealedFlagIdx: null,
    };
    if (action.kind === 'flip') {
      const cell = state.board[action.index];
      undo.flipCell = cell;
      cell.revealed = true;
      if (!state.sidesAssigned) {
        // 首翻定阵营：替换 controllers 对象（撤销时恢复原引用），不污染调用方
        undo.prevControllers = state.controllers;
        state.controllers = { red: state.controllers.red, blue: state.controllers.blue };
        state.controllers[cell.piece.side] = 'human';
        state.controllers[C.opposite(cell.piece.side)] = 'ai';
        state.sidesAssigned = true;
        state.turn = C.opposite(cell.piece.side);
      } else {
        state.turn = C.opposite(state.turn);
      }
      state.staleCount = 0;
      state.winner = R.checkWinner(state);
      return undo;
    }
    const from = action.from, to = action.to;
    const fcell = state.board[from], tcell = state.board[to];
    const p = fcell.piece;
    if (tcell.piece) {
      // 军旗保护（legalMoves 已过滤，此处防御）
      if (tcell.piece.type === 'flag' && state.minesLost[tcell.piece.side] < C.MINES_PER_SIDE) return undo;
      undo.fromCell = fcell;
      undo.toCell = tcell;
      undo.prevCaptured = state.captured ? Object.assign({}, state.captured) : null; // applyBattle 会 bump captured，整对象备份
      const info = STATE.applyBattle(state, from, to);
      if (info.flagCaptured) state.winner = p.side;
      // 司令阵亡亮旗：applyBattle 可能额外翻开军旗格（from/to 之外的第三格），撤销时须复位
      if (info.revealedFlags && info.revealedFlags.length) undo.revealedFlagIdx = info.revealedFlags;
      state.staleCount = 0;
    } else {
      undo.fromCell = fcell;
      undo.toCell = tcell;
      state.board[to] = { piece: p, revealed: true };
      state.board[from] = { piece: null, revealed: false };
      state.staleCount += 1;
    }
    state.turn = C.opposite(state.turn);
    if (!state.winner) state.winner = R.checkWinner(state);
    return undo;
  }

  function undoAction(state, action, undo) {
    state.turn = undo.prevTurn;
    state.staleCount = undo.prevStale;
    state.winner = undo.prevWinner;
    state.minesLost.red = undo.prevMinesRed;
    state.minesLost.blue = undo.prevMinesBlue;
    state.sidesAssigned = undo.prevSidesAssigned;
    if (undo.prevControllers) state.controllers = undo.prevControllers;
    if (action.kind === 'flip') {
      undo.flipCell.revealed = false;
      return;
    }
    if (undo.fromCell) {
      state.board[action.from] = undo.fromCell; // 回填原 cell 对象（applyBattle 是替换式写法）
      state.board[action.to] = undo.toCell;
    }
    if (undo.revealedFlagIdx) {
      for (const i of undo.revealedFlagIdx) state.board[i].revealed = false;
    }
    if (undo.prevCaptured) state.captured = undo.prevCaptured;
  }

  // 在克隆上应用动作（不触发 notify；cfg.makeUnmake=false 的回退路径仍在用）
  function applyOnClone(state, action) {
    const s = state; // already a clone
    if (s.winner) return;
    if (action.kind === 'flip') {
      const cell = s.board[action.index];
      cell.revealed = true;
      if (!s.sidesAssigned) {
        // AI 只在人机模式行动：翻出色归人类，另一色归 AI
        s.controllers = s.controllers || { red: null, blue: null };
        s.controllers[cell.piece.side] = 'human';
        s.controllers[C.opposite(cell.piece.side)] = 'ai';
        s.sidesAssigned = true; s.turn = C.opposite(cell.piece.side);
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
  // killers：本层记录的截断走法，命中者排在吃子/逃离之后、flip/安静走法之前
  function actionKey(state, side, action, threat, killers) {
    if (action.kind === 'flip') return 50000; // 1.0.3 方案：翻棋恒 50000（位置偏好曾致真人对战被动，回退）
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
    // killer 命中：仅次于吃子/逃离
    // （history heuristic 实测负收益已移除：跨迭代累积的截断分污染 aspiration 重搜的根排序，
    //  且 hard 档浅深度下收益本就有限——ab_test.js historyOrder 1:5）
    if (killers && killers.some((k) => k.from === from && k.to === to)) return 90000;
    let k = 10000;
    if (B.terrainAt(to) === 'camp') k += 2;   // 1.0.3 排序权重（曾加到 40/8 诱发过强占营倾向，回退）
    else if (B.terrainAt(to) === 'railway') k += 1;
    return k;
  }

  function orderActions(state, side, actions, threat, killers) {
    if (actions.length < 2) return actions;
    return actions
      .map((a) => ({ a, k: actionKey(state, side, a, threat, killers) }))
      .sort((x, y) => y.k - x.k)
      .map((x) => x.a);
  }

  // 当前行棋方的吃子走法（quiesce 专用）：只留有希望的捕获——
  // 夺旗 / 攻击者存活 / 同归且目标价值≥攻击者。无望牺牲不进搜索（对手永远可 stand-pat，sound）。
  function captureActions(state) {
    const mover = state.turn;
    const out = [];
    for (let i = 0; i < state.board.length; i++) {
      const cell = state.board[i];
      if (!cell.piece || !cell.revealed || cell.piece.side !== mover) continue;
      if (C.IMMOBILE.indexOf(cell.piece.type) !== -1) continue;
      for (const m of R.legalMoves(state, i)) {
        const t = state.board[m.to];
        if (!t.piece) continue; // 仅吃子（legalMoves 已保证是已翻敌子）
        const res = R.resolveBattle(cell.piece, t.piece);
        if (res.flagCaptured) { out.push(m); continue; }
        const survives = res.to && res.to.piece === cell.piece;
        const trade = res.to === null;
        if (!survives && !(trade && valueOf(t.piece.type) >= valueOf(cell.piece.type))) continue;
        out.push(m);
      }
    }
    return orderActions(state, mover, out, null); // MVV-LVA 序
  }

  // 叶子静态交换搜索（master）：在叶子展开吃子链，消除水平线效应（贪吃→下一手被反吃）。
  // stand-pat 基线 + 只展开 captureActions + delta 剪枝；winner 先于 stand-pat；
  // 禁 try/catch（BudgetExceeded 须穿透到 chooseHard 内层 catch 走 bestSoFar 语义）。
  function quiesce(state, side, alpha, beta, qleft) {
    checkBudget();
    if (state.winner) {
      if (state.winner === 'draw') return 0;
      return state.winner === side ? 100000 : -100000;
    }
    const stand = evaluate(state, side);
    if (qleft <= 0) return stand;
    if (state.turn === side) {
      // max 分支
      if (stand >= beta) return stand;
      let best = stand;
      if (stand > alpha) alpha = stand;
      for (const m of captureActions(state)) {
        if (stand + valueOf(state.board[m.to].piece.type) + _cfg.qDelta < alpha) continue; // delta 剪枝
        let v;
        if (_cfg.makeUnmake === false) {
          const s = clone(state);
          applyOnClone(s, m);
          v = quiesce(s, side, alpha, beta, qleft - 1);
        } else {
          // try/finally：BudgetExceeded 穿透时也必须撤销（原位搜索的状态完整性保证）
          const undo = applyAction(state, m);
          try {
            v = quiesce(state, side, alpha, beta, qleft - 1);
          } finally {
            undoAction(state, m, undo);
          }
        }
        if (v > best) best = v;
        if (best > alpha) alpha = best;
        if (alpha >= beta) break;
      }
      return best;
    }
    // min 分支（对手走）：镜像
    if (stand <= alpha) return stand;
    let best = stand;
    if (stand < beta) beta = stand;
    for (const m of captureActions(state)) {
      if (stand - valueOf(state.board[m.to].piece.type) - _cfg.qDelta > beta) continue; // delta 剪枝
      let v;
      if (_cfg.makeUnmake === false) {
        const s = clone(state);
        applyOnClone(s, m);
        v = quiesce(s, side, alpha, beta, qleft - 1);
      } else {
        const undo = applyAction(state, m);
        try {
          v = quiesce(state, side, alpha, beta, qleft - 1);
        } finally {
          undoAction(state, m, undo);
        }
      }
      if (v < best) best = v;
      if (best < beta) beta = best;
      if (alpha >= beta) break;
    }
    return best;
  }

  // expectimax + alpha-beta：max/min 节点按窗口剪枝；flip 动作产生 chance 节点
  // inChance：flip chance 子树内全窗口（无偏期望），且叶子不开 quiesce（全窗口下剪枝失效，成本爆炸）
  function expectimax(state, side, depth, alpha = -Infinity, beta = Infinity, inChance = false) {
    checkBudget();
    if (state.winner) {
      if (state.winner === 'draw') return 0;
      return state.winner === side ? 100000 : -100000;
    }
    if (depth <= 0) {
      return (_cfg.quiesce && !inChance) ? quiesce(state, side, alpha, beta, _cfg.qdepth) : evaluate(state, side);
    }

    const actions = orderActions(state, state.turn, enumerateActions(state, state.turn), null, _killers[depth]);
    if (!actions.length) {
      return state.turn === side ? -100000 : 100000; // 无棋可走=负
    }

    const mover = state.turn;
    let best;
    let cutoff = null; // 触发截断的走法 → 候选 killer
    if (mover === side) {
      best = -Infinity;
      for (const a of actions) {
        const v = actionValue(state, a, side, depth, alpha, beta, inChance);
        if (v > best) best = v;
        if (best > alpha) alpha = best;
        if (alpha >= beta) { cutoff = a; break; } // 剪枝
      }
    } else {
      best = Infinity;
      for (const a of actions) {
        const v = actionValue(state, a, side, depth, alpha, beta, inChance);
        if (v < best) best = v;
        if (best < beta) beta = best;
        if (alpha >= beta) { cutoff = a; break; } // 剪枝
      }
    }
    // 安静走法触发截断 → 记 killer（吃子已有 MVV-LVA，无需）
    if (cutoff && cutoff.kind === 'move' && !state.board[cutoff.to].piece) recordKiller(depth, cutoff);
    return best;
  }

  // 翻棋期权廉价估计：翻子≈获得一份"信息+子力期望"的期权，随暗子数增加、随困局进度衰减。
  // 只需与真实翻棋期望同量级（±2 分内），用于浅层 flip/move 竞争定价，不参与深层搜索。
  function flipOptionValue(state) {
    let n = 0;
    for (let i = 0; i < state.board.length; i++) {
      const c = state.board[i];
      if (c.piece && !c.revealed) n++;
    }
    if (!n) return 0;
    return Math.min(3, 0.5 + n * 0.06) * tempoOf(state);
  }

  // 单个动作的期望值：move 为确定（传窗口），flip 为 chance（按剩余分布 top-K 采样，全窗口取精确期望）
  function actionValue(state, action, side, depth, alpha = -Infinity, beta = Infinity, inChance = false) {
    checkBudget();
    if (action.kind === 'move') {
      if (_cfg.makeUnmake === false) {
        const s = clone(state);
        applyOnClone(s, action);
        return expectimax(s, side, depth - 1, alpha, beta, inChance);
      }
      const undo = applyAction(state, action);
      try {
        return expectimax(state, side, depth - 1, alpha, beta, inChance);
      } finally {
        undoAction(state, action, undo); // BudgetExceeded 穿透时也必须撤销
      }
    }
    // flip -> chance 节点
    // 浅层收缩（flipCollapse）：翻棋 chance 采样是最贵的节点（K 路 × 全窗口 × 无 quiesce），
    // depth ≤ flipCollapseDepth 时改用"静态估值 + 翻棋期权"廉价近似，释放预算给更深的 move 子树。
    // 有损启发（benchmark 验收把关；cfg.flipCollapse=false 可回退）。
    if (_cfg.flipCollapse && depth <= (_cfg.flipCollapseDepth || 2)) {
      return evaluate(state, side) + flipOptionValue(state);
    }
    const { rem, totalUnrevealed } = remainingDistribution(state);
    if (totalUnrevealed <= 0) return evaluate(state, side);
    // 取 top-K 概率结果
    const probs = [];
    for (const key in rem) {
      if (rem[key] > 0) probs.push({ key, p: rem[key] / totalUnrevealed });
    }
    probs.sort((a, b) => b.p - a.p);
    // 自适应采样宽度：仅在概率集中（p≥flipPMin 的个数）时加宽，下限 3。
    // hard 的 flipK=3/flipPMin=0 使本式恒等于现状（K=min(3,len)）；master 只在残局子树便宜时扩到 4–5。
    let countGE = 0;
    if (_cfg.flipPMin > 0) { for (const pr of probs) if (pr.p >= _cfg.flipPMin) countGE++; }
    const K = Math.min(_cfg.flipK, probs.length, Math.max(3, countGE));
    let exp = 0, weightSum = 0;
    for (let k = 0; k < K; k++) {
      const { key, p } = probs[k];
      weightSum += p;
      const [type, side2] = key.split(':');
      // 原位模拟翻开该格为 (type, side2)，递归后逐字段恢复（该 cell 是替换式槽位，这里只改字段并复原）
      const cell = state.board[action.index];
      const prevPiece = cell.piece, prevRevealed = cell.revealed;
      const prevTurn = state.turn, prevStale = state.staleCount, prevWinner = state.winner;
      cell.revealed = true;
      cell.piece = { type, rank: C.PIECES[type].rank, side: side2 };
      state.staleCount = 0;
      state.turn = C.opposite(state.turn);
      state.winner = R.checkWinner(state);
      try {
        // chance 子树强制全窗口：截断值参与加权平均会有偏；inChance=true 且叶子不开 quiesce
        exp += p * expectimax(state, side, depth - 1, -Infinity, Infinity, true);
      } finally {
        cell.piece = prevPiece;
        cell.revealed = prevRevealed;
        state.turn = prevTurn;
        state.staleCount = prevStale;
        state.winner = prevWinner;
      }
    }
    // 归一化（top-K 未覆盖部分用当前估值近似）
    if (weightSum < 1) {
      exp += (1 - weightSum) * evaluate(state, side);
    } else {
      exp = exp / weightSum; // 归一化
    }
    return exp;
  }

  // 根搜索：按窗口评估根走法（兄弟间窗口 (max(bestV,alpha), beta)，fail-high 截断剩余）
  function searchRoot(state, side, actions, depth, alpha, beta) {
    let best = null, bestV = -Infinity;
    const scores = [];
    for (const a of actions) {
      const v = actionValue(state, a, side, depth, bestV > alpha ? bestV : alpha, beta);
      scores.push({ a, v });
      if (v > bestV) { bestV = v; best = a; }
      if (bestV >= beta) break; // fail-high：剩余根着截断（外层按失败重搜规则修正）
    }
    return { best, bestV, scores };
  }

  // 记录 killer：触发截断的安静走法（吃子已有 MVV-LVA 排序，不需要）
  function recordKiller(depth, move) {
    const slot = (_killers[depth] = _killers[depth] || []);
    if (slot.some((k) => k.from === move.from && k.to === move.to)) return;
    slot.unshift({ from: move.from, to: move.to });
    if (slot.length > 2) slot.length = 2;
  }

  // ---- 开局占营根修正（v1.0.7）：开局翻棋阶段优先抢占空行营 ----
  // 语义：仅当 (a)搜索最优着为翻棋 (b)仍处开局（暗子≥OPENING_UNREVEALED_MIN）
  // (c)己方占营数未饱和（<CAMP_SAT）(d)存在"己子入空营"走法 时，以入营着替代翻棋。
  // 守卫：入营挪位不得造成己方大子(≥45)被即时攻击的净新增（threatMapOf 前后对比）。
  // 设计边界（v1.0.5 教训）：无界版本的占营修正在中后期同样压制翻棋，实测真人体验为负
  // （蹲营被动）——本版严格限定在开局窗口，中后期决策与 1.0.3 基线完全一致。
  const OPENING_UNREVEALED_MIN = 25; // 暗子仍 ≥25 视为开局（约前 1/3 进程，25 次翻棋量）
  const CAMP_SAT = 3;                // 己方已占行营数达到饱和值后不再强制占营

  function openingCampOverride(state, side, best, actions, enabled = _cfg.openingCamp) {
    if (!enabled || !best || best.kind !== 'flip') return null;
    let unrevealed = 0, ownCamps = 0;
    for (let i = 0; i < state.board.length; i++) {
      const c = state.board[i];
      if (!c.piece) continue;
      if (!c.revealed) unrevealed++;
      else if (c.piece.side === side && B.terrainAt(i) === 'camp') ownCamps++;
    }
    if (unrevealed < OPENING_UNREVEALED_MIN || ownCamps >= CAMP_SAT) return null;
    const candidates = [];
    for (const a of actions) {
      if (a.kind === 'move' && B.terrainAt(a.to) === 'camp' && !state.board[a.to].piece) {
        candidates.push(a);
      }
    }
    if (!candidates.length) return null;
    const maxBigLoss = (st, threat) => {
      let m = 0;
      for (let i = 0; i < st.board.length; i++) {
        const l = threat.loss[i];
        if (l < 45) continue;
        const c = st.board[i];
        if (c.piece && c.revealed && c.piece.side === side &&
            C.IMMOBILE.indexOf(c.piece.type) === -1) m = Math.max(m, l);
      }
      return m;
    };
    const threat0 = threatMapOf(state, side);
    const cur = maxBigLoss(state, threat0);
    // 候选排序：被威胁子入营（逃命+地形兼得）优先，其次子力大者（行营免疫对大子价值更高）
    candidates.sort((a, b) => {
      const da = dangerAt(threat0, a.from), db = dangerAt(threat0, b.from);
      if (da !== db) return db - da;
      return valueOf(state.board[b.from].piece.type) - valueOf(state.board[a.from].piece.type);
    });
    for (const a of candidates) {
      const s = clone(state);
      applyOnClone(s, a);
      if (maxBigLoss(s, threatMapOf(s, side)) <= cur) return a;
    }
    return null;
  }

  function chooseHard(state, side, cfg = PRESETS.hard) {
    _cfg = cfg;
    _nodes = 0; _deadline = Date.now() + cfg.time; _lastDepth = 0;
    _killers = [];
    try {
      const actions = enumerateActions(state, side);
      if (!actions.length) return null;
      // 收尾：开局占营根修正（开局最优着为翻棋且可入营时改入营），两个出口共用
      const finish = (best) => openingCampOverride(state, side, best, actions) || best;
      const threat = threatMapOf(state, side);
      let ordered = orderActions(state, side, actions, threat); // 根节点精确排序
      let bestSoFar = ordered[0]; // 兜底＝静态最优着：任何情况下都有确定走法，不再回退 medium
      let lastIterMs = 0;
      let lastBest = null; // 上一迭代根值 → aspiration 窗口中心
      for (let depth = 1; depth <= cfg.maxDepth; depth++) {
        // 软停：预计本层跑不完剩余时间就不开新深度
        if (lastIterMs > 0 && Date.now() + lastIterMs * 3 > _deadline) break;
        const t0 = Date.now();
        // aspiration：首轮全窗口；其后围绕上轮值 ±ASPIRATION 开窗，失败则全窗口重搜
        const full = lastBest === null;
        const alpha0 = full ? -Infinity : lastBest - ASPIRATION;
        const beta0 = full ? Infinity : lastBest + ASPIRATION;
        try {
          let res = searchRoot(state, side, ordered, depth, alpha0, beta0);
          if (!full && (res.bestV <= alpha0 || res.bestV >= beta0)) {
            // 窗口失败：有预算则全窗口重搜；否则本层不提交、结束迭代
            if (Date.now() + 50 >= _deadline) break;
            res = searchRoot(state, side, ordered, depth, -Infinity, Infinity);
          }
          bestSoFar = res.best; // ★ 只有完整跑完（或重搜完成）的深度才提交
          _lastDepth = depth;
          lastBest = res.bestV;
          ordered = res.scores.sort((x, y) => y.v - x.v).map((x) => x.a); // best-first 喂下一层
          lastIterMs = Date.now() - t0;
        } catch (e) {
          if (e instanceof BudgetExceeded) return finish(bestSoFar); // ★ 半途中断 → 返回上一层最优根着
          throw e;
        }
      }
      return finish(bestSoFar);
    } catch (e) {
      if (e instanceof BudgetExceeded) return null; // 理论不可达（内层已捕获）
      return chooseMedium(state, side); // 非预算异常的终极兜底
    } finally {
      _deadline = 0;          // 搜索结束：解除预算闸，后续直接调 evaluate 不再受限
      _cfg = PRESETS.hard;    // 复位为 hard 语义（搜索外裸调 evaluate/quiesce 行为稳定）
    }
  }

  function chooseMove(state, difficulty, side) {
    if (difficulty === C.DIFFICULTY.EASY) return chooseEasy(state, side);
    if (difficulty === C.DIFFICULTY.MEDIUM) return chooseMedium(state, side);
    if (difficulty === C.DIFFICULTY.MASTER) return chooseHard(state, side, PRESETS.master);
    return chooseHard(state, side);
  }

  NS.Junqi.ai = {
    chooseMove, chooseHard, enumerateActions, evaluate, remainingDistribution,
    threatMapOf, dangerAt, threatWeight, PRESETS, quiesce, POS_W, openingCampOverride,
    lastDepth: () => _lastDepth,
  };
})();
