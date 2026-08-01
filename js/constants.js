// 军旗翻翻棋 — 常量定义
// 纯数据模块，无运行时行为。所有模块共用。
// 加载方式：普通 <script>，挂到全局 Junqi 命名空间（浏览器=window，Node=globalThis）。
;(function () {
  const NS = (typeof window !== 'undefined') ? window : globalThis;
  NS.Junqi = NS.Junqi || {};

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

  // 阵营
  const SIDES = ['red', 'blue'];

  function opposite(side) {
    return side === 'red' ? 'blue' : 'red';
  }

  NS.Junqi.constants = {
    ROWS, COLS, CELL_COUNT,
    PIECES, PIECES_PER_SIDE, MINES_PER_SIDE, IMMOBILE,
    DIFFICULTY, STALE_ROUNDS, STALE_LIMIT,
    RIVER_COLS, RIVER_TOP_ROW, RIVER_BOT_ROW,
    PIECE_VALUE, SIDES, opposite,
  };
})();
