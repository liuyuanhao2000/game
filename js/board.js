// 军旗翻翻棋 — 棋盘地形与邻接
// 纯数据 + 纯函数，不碰 DOM。供 rules/ui 共用。
// 所有移动种类的邻接判定统一经过本模块，楚河规则在 isAdjacent 中编码，自然继承到所有移动。
;(function () {
  const NS = (typeof window !== 'undefined') ? window : globalThis;
  NS.Junqi = NS.Junqi || {};
  const C = NS.Junqi.constants;

  const ROWS = C.ROWS, COLS = C.COLS;
  const idx = (r, c) => r * COLS + c;
  const rc = (i) => [Math.floor(i / COLS), i % COLS];

  // 地形类型
  // 行营梅花位（0-based row,col），对应 spec R3/R4/R5 上半 与 R8/R9/R10 下半：
  const CAMP_CELLS = [
    // 上半 (R3=row2, R4=row3, R5=row4)
    [2, 1], [2, 3], [3, 2], [4, 1], [4, 3],
    // 下半 (R8=row7, R9=row8, R10=row9) 镜像
    [7, 1], [7, 3], [8, 2], [9, 1], [9, 3],
  ];
  const CAMP_SET = new Set(CAMP_CELLS.map(([r, c]) => idx(r, c)));

  // 铁路横线行（0-based）：R2=1, R6=5, R7=6, R11=10
  const RAIL_ROWS = new Set([1, 5, 6, 10]);
  // 铁路竖线列（0-based）：C1=0, C5=4，贯通 row 1..10
  const RAIL_COLS = new Set([0, 4]);
  const RAIL_VERT_ROW_MIN = 1, RAIL_VERT_ROW_MAX = 10;

  // terrain 数组（60 项）：'normal' | 'railway' | 'camp'（camp 优先于 railway）
  const terrain = new Array(ROWS * COLS);
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const i = idx(r, c);
      if (CAMP_SET.has(i)) {
        terrain[i] = 'camp';
      } else if (RAIL_ROWS.has(r)) {
        terrain[i] = 'railway';
      } else if (RAIL_COLS.has(c) && r >= RAIL_VERT_ROW_MIN && r <= RAIL_VERT_ROW_MAX) {
        terrain[i] = 'railway';
      } else {
        terrain[i] = 'normal';
      }
    }
  }

  function terrainAt(i) { return terrain[i]; }

  // 楚河跨河判定：是否为跨 R6↔R7（row 5↔6）的纵向邻接
  function isRiverCrossing(ra, ca, rb, cb) {
    const crossing = (ra === C.RIVER_TOP_ROW && rb === C.RIVER_BOT_ROW) ||
                     (ra === C.RIVER_BOT_ROW && rb === C.RIVER_TOP_ROW);
    if (!crossing) return false;
    return C.RIVER_COLS.indexOf(ca) === -1; // 列不在 {0,2,4} 则被楚河阻断
  }

  // 基础正交邻接（普通1步、铁路扫描、工兵BFS 共用）
  // 返回 true 表示 a,b 正交相邻且未被楚河阻断
  function isAdjacent(a, b) {
    if (a === b) return false;
    const [ra, ca] = rc(a);
    const [rb, cb] = rc(b);
    const dr = Math.abs(ra - rb);
    const dc = Math.abs(ca - cb);
    if (dr + dc !== 1) return false; // 非正交相邻
    if (isRiverCrossing(ra, ca, rb, cb)) return false; // 楚河阻断 C2/C4
    return true;
  }

  // 行营八方向：行营内的棋子可向 4 个对角方向各走 1 步（叠加 4 正交 = 八方向）。
  // 对角邻接当且仅当：两格对角相邻（|dr|=1 且 |dc|=1）且至少一端为行营。
  function isDiagAdjacent(a, b) {
    if (a === b) return false;
    const [ra, ca] = rc(a);
    const [rb, cb] = rc(b);
    if (Math.abs(ra - rb) !== 1 || Math.abs(ca - cb) !== 1) return false; // 非对角相邻
    return terrain[a] === 'camp' || terrain[b] === 'camp';
  }

  // 预计算每个格的正交邻居（仅棋盘内、正交相邻，不含楚河阻断判定——调用方按需用 isAdjacent）
  const ORTH_NEIGHBORS = new Array(ROWS * COLS);
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const i = idx(r, c);
      const ns = [];
      if (r > 0) ns.push(idx(r - 1, c));
      if (r < ROWS - 1) ns.push(idx(r + 1, c));
      if (c > 0) ns.push(idx(r, c - 1));
      if (c < COLS - 1) ns.push(idx(r, c + 1));
      ORTH_NEIGHBORS[i] = ns;
    }
  }

  // 正交邻居（含楚河阻断过滤）
  function orthNeighbors(i) {
    return ORTH_NEIGHBORS[i].filter((n) => isAdjacent(i, n));
  }

  // 行营对角邻居：仅当本格为行营时，返回 4 个在棋盘内的对角邻居（八方向移动用）
  function diagNeighbors(i) {
    if (terrain[i] !== 'camp') return [];
    const [r, c] = rc(i);
    const out = [];
    const cands = [[r - 1, c - 1], [r - 1, c + 1], [r + 1, c - 1], [r + 1, c + 1]];
    for (const [rr, cc] of cands) {
      if (rr < 0 || rr >= ROWS || cc < 0 || cc >= COLS) continue;
      out.push(idx(rr, cc));
    }
    return out;
  }

  // 铁路邻居：正交邻居中同为 railway 且 isAdjacent 成立（楚河已过滤）
  const RAIL_NEIGHBORS = new Array(ROWS * COLS);
  for (let i = 0; i < ROWS * COLS; i++) {
    if (terrain[i] !== 'railway') { RAIL_NEIGHBORS[i] = []; continue; }
    RAIL_NEIGHBORS[i] = ORTH_NEIGHBORS[i].filter((n) =>
      terrain[n] === 'railway' && isAdjacent(i, n)
    );
  }
  function railNeighbors(i) { return RAIL_NEIGHBORS[i]; }

  // 是否两铁路格连通（用于工兵 BFS 边判定，等于 railNeighbors 关系）
  function railConnected(a, b) {
    return terrain[a] === 'railway' && terrain[b] === 'railway' && isAdjacent(a, b);
  }

  NS.Junqi.board = {
    ROWS, COLS, idx, rc,
    terrain, terrainAt,
    isAdjacent, isDiagAdjacent,
    orthNeighbors, diagNeighbors,
    railNeighbors, railConnected,
    CAMP_SET, isCamp: (i) => terrain[i] === 'camp',
    isRailway: (i) => terrain[i] === 'railway',
  };
})();
