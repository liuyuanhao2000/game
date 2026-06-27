// 军旗翻翻棋 — UI 渲染与交互（SVG 棋盘，经典军旗布局）
// 监听 state.onChange 重渲染；把玩家点击转成动作意图提交给 main。
// 只在 cell.revealed 时显示阵营，未翻子只显示背面。
;(function () {
  const NS = (typeof window !== 'undefined') ? window : globalThis;
  NS.Junqi = NS.Junqi || {};
  const C = NS.Junqi.constants;
  const B = NS.Junqi.board;
  const R = NS.Junqi.rules;

  const NS_NAME = { red: '红', blue: '蓝' };
  const PIECE_NAME = {};
  for (const t in C.PIECES) PIECE_NAME[t] = C.PIECES[t].name;

  // ---- 几何 ----
  const CELL = 1, MARGIN = 0.45, RIVER = 1.0, COLS = C.COLS, ROWS = C.ROWS;
  const W = 2 * MARGIN + COLS * CELL;
  const H = 2 * MARGIN + ROWS * CELL + RIVER;
  const cellX = (c) => MARGIN + c * CELL;
  const cellY = (r) => MARGIN + r * CELL + (r >= 6 ? RIVER : 0);
  const cx = (c) => cellX(c) + CELL / 2;
  const cy = (r) => cellY(r) + CELL / 2;

  // 铁路线段端点（用格子中心坐标）
  const RAIL_SEGMENTS = [
    // 竖向 C1（col0）行1..10，跨河
    [cx(0), cy(1), cx(0), cy(10)],
    // 竖向 C5（col4）行1..10，跨河
    [cx(4), cy(1), cx(4), cy(10)],
    // 横向 R2（row1）
    [cx(0), cy(1), cx(4), cy(1)],
    // 横向 R6（row5）
    [cx(0), cy(5), cx(4), cy(5)],
    // 横向 R7（row6）
    [cx(0), cy(6), cx(4), cy(6)],
    // 横向 R11（row10）
    [cx(0), cy(10), cx(4), cy(10)],
  ];

  // 行营八方向斜路：每个行营向其 4 个对角邻居画线（与 diagNeighbors 一致）
  const DIAG_SEGMENTS = (() => {
    const segs = [];
    const seen = new Set();
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const i = B.idx(r, c);
        if (B.terrainAt(i) !== 'camp') continue;
        for (const j of B.diagNeighbors(i)) {
          const key = Math.min(i, j) + ':' + Math.max(i, j);
          if (seen.has(key)) continue;
          seen.add(key);
          const [r1, c1] = B.rc(i), [r2, c2] = B.rc(j);
          segs.push([cx(c1), cy(r1), cx(c2), cy(r2)]);
        }
      }
    }
    return segs;
  })();

  let svgEl = null, statusEl = null, minesEl = null, lastmoveEl = null, onSelect = null;
  let selected = null, legalTargets = {};

  // SVG 元素创建辅助
  function el(tag, attrs, parent) {
    const e = document.createElementNS('http://www.w3.org/2000/svg', tag);
    if (attrs) for (const k in attrs) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  }

  function init({ board, hud, status, mines, lastmove, onSelect: cb }) {
    statusEl = status; minesEl = mines; lastmoveEl = lastmove; onSelect = cb;
    // 在容器内创建 <svg>（容器本身可为 div）
    svgEl = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    board.innerHTML = '';
    board.appendChild(svgEl);
    // 首次构建静态结构（棋盘骨架）
    buildSkeleton();
  }

  function buildSkeleton() {
    svgEl.innerHTML = '';
    svgEl.setAttribute('viewBox', `0 0 ${W} ${H}`);
    svgEl.setAttribute('preserveAspectRatio', 'xMidYMid meet');
    svgEl.classList.add('board-svg');

    // 箭头标记定义（上一步走子用）
    const defs = el('defs', {}, svgEl);
    const marker = el('marker', { id: 'last-arrow', viewBox: '0 0 10 10', refX: '8', refY: '5', markerWidth: '5', markerHeight: '5', orient: 'auto-start-reverse' }, defs);
    el('path', { d: 'M0,0 L10,5 L0,10 z', fill: 'var(--last-line)' }, marker);

    // 棋盘底
    el('rect', { x: 0, y: 0, width: W, height: H, fill: 'var(--board-bg)' }, svgEl);

    // 河带（楚河汉界）
    const riverY = cellY(5) + CELL;
    el('rect', {
      x: MARGIN, y: riverY, width: COLS * CELL, height: RIVER,
      fill: 'var(--river-bg)', class: 'river-band',
    }, svgEl);
    el('text', {
      x: cx(1), y: riverY + RIVER / 2, 'text-anchor': 'middle',
      'dominant-baseline': 'central', class: 'river-text',
    }, svgEl).textContent = '楚 河';
    el('text', {
      x: cx(3), y: riverY + RIVER / 2, 'text-anchor': 'middle',
      'dominant-baseline': 'central', class: 'river-text',
    }, svgEl).textContent = '汉 界';

    // 格子底色层（按地形）
    const cellLayer = el('g', { class: 'cell-layer' }, svgEl);
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const i = B.idx(r, c);
        const t = B.terrainAt(i);
        el('rect', {
          x: cellX(c), y: cellY(r), width: CELL, height: CELL,
          fill: t === 'camp' ? 'var(--camp-bg)' : (t === 'railway' ? 'var(--rail-bg)' : 'var(--cell-bg)'),
          stroke: 'var(--grid-line)', 'stroke-width': 0.02, class: 'cell-fill',
        }, cellLayer);
      }
    }

    // 铁路双轨线
    const railLayer = el('g', { class: 'rail-layer' }, svgEl);
    RAIL_SEGMENTS.forEach((s) => drawRail(railLayer, s[0], s[1], s[2], s[3]));
    // 过河桥 C3（非铁路，细线）
    el('line', {
      x1: cx(2), y1: cy(5), x2: cx(2), y2: cy(6),
      stroke: 'var(--bridge-line)', 'stroke-width': 0.06, 'stroke-dasharray': '0.12 0.08',
    }, railLayer);

    // 梅花斜路
    const diagLayer = el('g', { class: 'diag-layer' }, svgEl);
    DIAG_SEGMENTS.forEach((s) => {
      el('line', { x1: s[0], y1: s[1], x2: s[2], y2: s[3], stroke: 'var(--diag-line)', 'stroke-width': 0.03 }, diagLayer);
    });

    // 行营 ⊙ 标记
    const campLayer = el('g', { class: 'camp-layer' }, svgEl);
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        if (B.terrainAt(B.idx(r, c)) === 'camp') {
          el('circle', { cx: cx(c), cy: cy(r), r: CELL * 0.30, fill: 'none', stroke: 'var(--camp-ring)', 'stroke-width': 0.035 }, campLayer);
          el('circle', { cx: cx(c), cy: cy(r), r: CELL * 0.06, fill: 'var(--camp-ring)' }, campLayer);
        }
      }
    }

    // 高亮层（选中/落点）+ 棋子层 + 上一步标记层 + 点击层
    el('g', { class: 'hl-layer' }, svgEl);
    el('g', { class: 'piece-layer' }, svgEl);
    el('g', { class: 'last-layer' }, svgEl);

    // 透明点击层（每格一个 rect，置于最上）
    const clickLayer = el('g', { class: 'click-layer' }, svgEl);
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const i = B.idx(r, c);
        const rct = el('rect', {
          x: cellX(c), y: cellY(r), width: CELL, height: CELL,
          fill: 'transparent', 'data-index': i, class: 'click-cell',
        }, clickLayer);
        rct.addEventListener('click', () => { if (onSelect) onSelect(i); });
      }
    }
  }

  // 画一段双轨铁路：两条平行线 + 枕木虚线
  function drawRail(parent, x1, y1, x2, y2) {
    // 方向法线
    const dx = x2 - x1, dy = y2 - y1;
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len, ny = dx / len;
    const off = 0.06;
    el('line', { x1: x1 + nx * off, y1: y1 + ny * off, x2: x2 + nx * off, y2: y2 + ny * off, stroke: 'var(--rail-line)', 'stroke-width': 0.035 }, parent);
    el('line', { x1: x1 - nx * off, y1: y1 - ny * off, x2: x2 - nx * off, y2: y2 - ny * off, stroke: 'var(--rail-line)', 'stroke-width': 0.035 }, parent);
    el('line', { x1, y1, x2, y2, stroke: 'var(--rail-tie)', 'stroke-width': 0.10, 'stroke-dasharray': '0.10 0.14' }, parent);
  }

  function layer(name) {
    return svgEl.querySelector('g.' + name);
  }

  function clearLayer(g) { while (g.firstChild) g.removeChild(g.firstChild); }

  function render(state) {
    if (!svgEl) return;

    // 高亮层
    const hl = layer('hl-layer');
    clearLayer(hl);
    if (selected !== null) {
      const [r, c] = B.rc(selected);
      el('rect', { x: cellX(c), y: cellY(r), width: CELL, height: CELL, fill: 'none', stroke: 'var(--sel-line)', 'stroke-width': 0.09, rx: 0.05 }, hl);
      for (const t in legalTargets) {
        const [tr, tc] = B.rc(Number(t));
        const tcell = state.board[t];
        const col = (tcell && tcell.piece && tcell.revealed) ? 'var(--enemy-line)' : 'var(--target-line)';
        el('rect', { x: cellX(tc), y: cellY(tr), width: CELL, height: CELL, fill: 'none', stroke: col, 'stroke-width': 0.08, rx: 0.05 }, hl);
      }
    }

    // 棋子层
    const pl = layer('piece-layer');
    clearLayer(pl);
    for (let i = 0; i < state.board.length; i++) {
      const cell = state.board[i];
      if (!cell.piece) continue;
      const [r, c] = B.rc(i);
      const ccx = cx(c), ccy = cy(r);
      if (cell.revealed) {
        const g = el('g', { class: 'piece-g side-' + cell.piece.side }, pl);
        el('circle', { cx: ccx, cy: ccy, r: CELL * 0.36, fill: 'var(--p-' + cell.piece.side + ')', stroke: 'var(--p-' + cell.piece.side + '-ring)', 'stroke-width': 0.04 }, g);
        el('text', { x: ccx, y: ccy, 'text-anchor': 'middle', 'dominant-baseline': 'central', class: 'piece-text side-text-' + cell.piece.side }, g).textContent = PIECE_NAME[cell.piece.type];
      } else {
        const g = el('g', { class: 'piece-g back' }, pl);
        el('circle', { cx: ccx, cy: ccy, r: CELL * 0.36, fill: 'var(--p-back)', stroke: 'var(--p-back-ring)', 'stroke-width': 0.04 }, g);
        el('text', { x: ccx, y: ccy, 'text-anchor': 'middle', 'dominant-baseline': 'central', class: 'piece-text back-text' }, g).textContent = '军';
      }
    }

    // 上一步标记层（持续显示，直到下一步覆盖）
    const ll = layer('last-layer');
    clearLayer(ll);
    const lm = state.lastMove;
    if (lm) {
      if (lm.kind === 'flip') {
        const [r, c] = B.rc(lm.index);
        el('rect', { x: cellX(c), y: cellY(r), width: CELL, height: CELL, fill: 'none', stroke: 'var(--last-line)', 'stroke-width': 0.09, rx: 0.05, 'stroke-dasharray': '0.14 0.10' }, ll);
        el('text', { x: cx(c), y: cellY(r) + 0.16, 'text-anchor': 'middle', class: 'last-tag' }, ll).textContent = '翻';
      } else {
        const [fr, fc] = B.rc(lm.from), [tr, tc] = B.rc(lm.to);
        // 起点：虚线框
        el('rect', { x: cellX(fc), y: cellY(fr), width: CELL, height: CELL, fill: 'none', stroke: 'var(--last-from)', 'stroke-width': 0.07, rx: 0.05, 'stroke-dasharray': '0.12 0.10' }, ll);
        // 终点：实线框（交战时染红）
        const toStroke = lm.battle ? 'var(--last-battle)' : 'var(--last-line)';
        el('rect', { x: cellX(tc), y: cellY(tr), width: CELL, height: CELL, fill: 'none', stroke: toStroke, 'stroke-width': 0.09, rx: 0.05 }, ll);
        // 起点→终点箭头
        drawArrow(ll, cx(fc), cy(fr), cx(tc), cy(tr));
      }
    }

    renderHud(state);
  }

  // 上一步走子箭头：从 (x1,y1) 指向 (x2,y2)，终点回缩以免被棋子盖住箭头
  function drawArrow(parent, x1, y1, x2, y2) {
    const dx = x2 - x1, dy = y2 - y1;
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len, uy = dy / len;
    const pull = 0.34; // 回缩到目标格中心前
    el('line', {
      x1, y1, x2: x2 - ux * pull, y2: y2 - uy * pull,
      stroke: 'var(--last-line)', 'stroke-width': 0.055, 'marker-end': 'url(#last-arrow)',
      'stroke-linecap': 'round',
    }, parent);
  }

  // 格子坐标标签：列 a-e（左→右），行 1-12（上→下）
  const COL_CHARS = 'abcde';
  function cellLabel(i) {
    const [r, c] = B.rc(i);
    return COL_CHARS[c] + (r + 1);
  }

  // 把 state.lastMove 描述成一行中文
  function describeLastMove(lm) {
    if (!lm) return '';
    const side = NS_NAME[lm.side] + ' ' + PIECE_NAME[lm.type];
    if (lm.kind === 'flip') {
      return '翻开 ' + side + ' @ ' + cellLabel(lm.index);
    }
    const move = side + ' ' + cellLabel(lm.from) + '→' + cellLabel(lm.to);
    if (!lm.battle) return move;
    const dfn = NS_NAME[lm.battle.side] + ' ' + PIECE_NAME[lm.battle.type];
    switch (lm.battle.outcome) {
      case 'win':  return move + ' · 吃 ' + dfn;
      case 'lose': return move + ' · 败于 ' + dfn;
      case 'both': return move + ' · 同归于尽 ' + dfn;
      case 'flag': return move + ' · 夺旗 ' + dfn + '！';
      default: return move;
    }
  }

  function renderHud(state) {
    let msg;
    if (state.winner) {
      if (state.winner === 'draw') msg = '和局（困局）';
      else {
        const who = state.winner === state.playerSide ? '🎉 你胜' : 'AI 胜';
        msg = who;
      }
    } else if (!state.sidesAssigned) {
      msg = '点击任意背面棋子翻开，决定你的阵营';
    } else {
      const mine = state.turn === state.playerSide;
      const tag = '你是 ' + NS_NAME[state.playerSide] + ' 方';
      msg = tag + ' · ' + (mine ? '你的回合，选择棋子' : 'AI 思考中…');
    }
    statusEl.textContent = msg;
    // 染色状态条
    statusEl.className = 'status' + (state.winner ? ' status-end' : (state.sidesAssigned && state.turn === state.playerSide ? ' status-mine' : ''));

    // 地雷拔除进度（拔满 3 才能吃对方军旗）
    if (minesEl) {
      if (!state.sidesAssigned || !state.minesLost) {
        minesEl.textContent = '';
      } else {
        const ml = state.minesLost;
        const myLoss = ml[state.playerSide] || 0;
        const enLoss = ml[state.aiSide] || 0;
        const M = C.MINES_PER_SIDE;
        minesEl.textContent =
          '敌方军旗解锁：' + enLoss + '/' + M + ' 颗地雷' +
          (enLoss >= M ? '（可吃旗！）' : '') +
          '  ·  己方地雷剩余 ' + (M - myLoss) + '/' + M;
      }
    }

    // 上一步提示行
    if (lastmoveEl) {
      const text = describeLastMove(state.lastMove);
      lastmoveEl.textContent = text ? '上一步：' + text : '';
      lastmoveEl.className = 'lastmove' + (text ? '' : ' empty');
    }
  }

  function setSelection(index, targets) {
    selected = index;
    legalTargets = {};
    if (targets) for (const m of targets) legalTargets[m.to] = true;
  }
  function clearSelection() { selected = null; legalTargets = {}; }

  function toast(msg) {
    let t = document.getElementById('jq-toast');
    if (!t) { t = document.createElement('div'); t.id = 'jq-toast'; document.body.appendChild(t); }
    t.textContent = msg;
    t.className = 'toast show';
    clearTimeout(t._timer);
    t._timer = setTimeout(() => { t.className = 'toast'; }, 1500);
  }

  NS.Junqi.ui = {
    init, render, setSelection, clearSelection, toast,
  };
})();
