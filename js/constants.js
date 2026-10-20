// 军旗翻翻棋 — 常量定义
// 纯数据模块，无运行时行为。所有模块共用。
// 加载方式：普通 <script>，挂到全局 Junqi 命名空间（浏览器=window，Node=globalThis）。
;(function () {
  const NS = (typeof window !== 'undefined') ? window : globalThis;
  NS.Junqi = NS.Junqi || {};

  const VERSION = '1.4.0'; // 与 package.json 保持一致（tests/version.test.js 会校验）；界面版本号由此渲染

  const ROWS = 12;
  const COLS = 5;
  const CELL_COUNT = ROWS * COLS; // 60

  // 棋子类型表：type -> { rank, count }
  // rank: 司令9 ... 工兵1；地雷/炸弹/军旗为特殊（rank 用 0 标记，交战逻辑单独处理）
  const PIECES = {
    commander: { name: '司令', rank: 9, count: 1 },
    general:   { name: '军长', rank: 8, count: 1 },
    division:  { name: '师长', rank: 7, count: 2 },
    brigade:   { name: '旅长', rank: 6, count: 2 },
    regiment:  { name: '团长', rank: 5, count: 2 },
    battalion: { name: '营长', rank: 4, count: 2 },
    company:   { name: '连长', rank: 3, count: 3 },
    platoon:   { name: '排长', rank: 2, count: 3 },
    engineer:  { name: '工兵', rank: 1, count: 3 }, // 可挖雷、铁路上可转弯
    bomb:      { name: '炸弹', rank: 0, count: 2, special: true },
    mine:      { name: '地雷', rank: 0, count: 3, special: true }, // 不可移动
    flag:      { name: '军旗', rank: 0, count: 1, special: true }, // 不可移动，被吃即败
  };

  // 每方棋子总数（应为 25）
  const PIECES_PER_SIDE = Object.values(PIECES).reduce((s, p) => s + p.count, 0);
  // 每方地雷数：需拔掉对方全部地雷后才能吃军旗
  const MINES_PER_SIDE = PIECES.mine.count;

  // 不可移动的棋子类型
  const IMMOBILE = ['mine', 'flag'];

  // AI 难度枚举
  const DIFFICULTY = { EASY: 'easy', MEDIUM: 'medium', HARD: 'hard', MASTER: 'master' };

  // ---- 玩法（娱乐模式扩展位）----
  // variant 与 mode('ai'|'pvp') 正交：经典模式规则恒定；娱乐模式目前有军衔升级与镜像明棋。
  // 娱乐·军衔升级：战斗后存活方（非特殊子）自动升一级军衔（司令封顶）；
  // 工兵走特殊路径：吃子（含排雷）后成为超级工兵，战力 = 1 + 吃子数，移动方式不变、保留排雷能力。
  // 娱乐·镜像明棋：开局随机一份布局并跨楚河镜像给双方，所有棋子明置，全局无翻棋。
  const VARIANTS = { CLASSIC: 'classic', RANK_UP: 'rankUp', MIRROR_OPEN: 'mirrorOpen' };

  // 军衔阶梯：rank 数值 → 名称（工兵1 … 司令9）；升级/显示/AI 估值共用
  const RANK_MAX = 9; // 普通棋子升级封顶（司令不再升）
  const RANK_NAMES = { 1: '工兵', 2: '排长', 3: '连长', 4: '营长', 5: '团长', 6: '旅长', 7: '师长', 8: '军长', 9: '司令' };

  const SIDE_NAME = { red: '红方', blue: '蓝方' };

  // 棋子显示名（含升级态）：
  // - 工兵吃过子（captures>0）→ 超级工兵
  // - 普通子 rank 高于基础值 → 按军衔阶梯显示新军衔名（如排长升到连长即显示"连长"）
  // - 其余（含特殊子、未升级子、经典模式）→ 原类型名，与旧行为一致
  function pieceName(piece) {
    if (!piece) return '';
    if (piece.type === 'engineer' && (piece.captures || 0) > 0) return '超级工兵';
    const base = PIECES[piece.type];
    if (base && piece.rank && piece.rank !== base.rank && RANK_NAMES[piece.rank]) return RANK_NAMES[piece.rank];
    return base ? base.name : '';
  }

  // 升级播报文案（toast 用）：prm = { side, type, fromRank, rank, captures }
  function promotionText(prm) {
    if (!prm) return '';
    const who = SIDE_NAME[prm.side] || '';
    if (prm.type === 'engineer') {
      return prm.captures <= 1
        ? '⬆ ' + who + '工兵 升级为 超级工兵 · 战力 ' + prm.rank
        : '⬆ ' + who + '超级工兵 战力 +1 → ' + prm.rank;
    }
    return '⬆ ' + who + (RANK_NAMES[prm.fromRank] || '棋子') + ' 升级为 ' + (RANK_NAMES[prm.rank] || '更高军衔');
  }

  // 困局兜底：连续 STALE_ROUNDS 回合无吃子且无翻棋则判和
  // 一回合 = 双方各走一步 = 2 个单方动作(ply)；staleCount 以 ply 计数
  const STALE_ROUNDS = 40;
  const STALE_LIMIT = STALE_ROUNDS * 2; // 80 ply = 40 回合

  // 楚河：跨 R6↔R7（row 5↔6）允许的列（0-based：C1=0, C3=2, C5=4）
  const RIVER_COLS = [0, 2, 4];
  const RIVER_TOP_ROW = 5; // R6（0-based row 5）
  const RIVER_BOT_ROW = 6; // R7（0-based row 6）

  // 棋子价值表（AI 估值用；工兵因可挖雷而抬高，军旗极高）
  const PIECE_VALUE = {
    commander: 100,
    general: 80,
    division: 60,
    brigade: 45,
    regiment: 35,
    battalion: 25,
    company: 18,
    platoon: 12,
    engineer: 22, // 含挖雷价值
    bomb: 35,
    mine: 28, // 战略关键：拔雷才能吃旗，价值抬高
    flag: 1000,
  };

  // 军衔价值阶梯（AI 估值用）：rank → 价值，由 PIECE_VALUE 反查生成，与之恒同步。
  // 娱乐模式下升级子按当前 rank 在此表取值（见 ai.js valueOfPiece）。
  const RANK_VALUE = {};
  for (const t in PIECES) {
    if (PIECES[t].rank >= 1) RANK_VALUE[PIECES[t].rank] = PIECE_VALUE[t];
  }

  // 阵营
  const SIDES = ['red', 'blue'];

  function opposite(side) {
    return side === 'red' ? 'blue' : 'red';
  }

  NS.Junqi.constants = {
    VERSION, ROWS, COLS, CELL_COUNT,
    PIECES, PIECES_PER_SIDE, MINES_PER_SIDE, IMMOBILE,
    DIFFICULTY, STALE_ROUNDS, STALE_LIMIT,
    VARIANTS, RANK_MAX, RANK_NAMES, SIDE_NAME, pieceName, promotionText,
    RIVER_COLS, RIVER_TOP_ROW, RIVER_BOT_ROW,
    PIECE_VALUE, RANK_VALUE, SIDES, opposite,
  };
})();
