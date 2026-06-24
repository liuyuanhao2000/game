// 军旗翻翻棋 — UI 渲染与交互
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

  let boardEl = null, hudEl = null, statusEl = null;
  let onSelect = null;          // 回调：用户点击格子的意图（index）
  let selected = null;          // 当前选中的己方已翻格 index
  let legalTargets = {};        // 选中格的合法落点 to->true

  function init({ board, hud, status, onSelect: cb }) {
    boardEl = board; hudEl = hud; statusEl = status; onSelect = cb;
    renderBoard();
  }

  function renderBoard() {
    boardEl.innerHTML = '';
    for (let r = 0; r < C.ROWS; r++) {
      for (let c = 0; c < C.COLS; c++) {
        const i = B.idx(r, c);
        const cell = document.createElement('div');
        cell.className = 'cell terrain-' + B.terrainAt(i);
        cell.dataset.index = i;
        // 楚河分隔标记
        if (r === 5 && c === 1) cell.classList.add('river-left');
        if (r === 5 && c === 3) cell.classList.add('river-right');
        cell.addEventListener('click', () => onCellClick(i));
        boardEl.appendChild(cell);
      }
      // 行尾换行（用 CSS grid 实际不需要，但保留分隔）
    }
  }

  function render(state) {
    if (!boardEl) return;
    const cells = boardEl.children;
    for (let i = 0; i < cells.length; i++) {
      const el = cells[i];
      el.className = el.className.replace(/cell-(sel|target|enemy-target|hint)\b/g, '').trim();
      // 重置 terrain class
      el.className = 'cell terrain-' + B.terrainAt(i) + ' ' + extraClasses(i).join(' ');
      el.innerHTML = '';
      const cell = state.board[i];
      if (cell.piece) {
        const p = document.createElement('div');
        p.className = 'piece';
        if (cell.revealed) {
          p.classList.add('side-' + cell.piece.side, 'revealed');
          p.textContent = PIECE_NAME[cell.piece.type];
        } else {
          p.classList.add('back');
          p.textContent = '军';
        }
        el.appendChild(p);
      }
    }
    // 高亮选中与合法落点
    if (selected !== null) {
      const sel = cells[selected];
      if (sel) sel.classList.add('cell-sel');
      for (const t in legalTargets) {
        const tel = cells[t];
        if (!tel) continue;
        const tcell = state.board[t];
        if (tcell.piece && tcell.revealed) tel.classList.add('cell-enemy-target');
        else tel.classList.add('cell-target');
      }
    }
    renderHud(state);
  }

  function extraClasses(i) {
    const out = [];
    return out;
  }

  function renderHud(state) {
    let msg;
    if (state.winner) {
      if (state.winner === 'draw') msg = '和局（困局）';
      else {
        const who = state.winner === state.playerSide ? '你胜' : 'AI 胜';
        msg = who + '（' + NS_NAME[state.winner] + '方夺旗/对方无路）';
      }
    } else if (!state.sidesAssigned) {
      msg = '点击任意背面棋子翻开，决定你的阵营';
    } else {
      const mine = state.turn === state.playerSide;
      msg = '你是' + NS_NAME[state.playerSide] + '方 · ' + (mine ? '你的回合' : 'AI 思考中…');
    }
    statusEl.textContent = msg;
  }

  function onCellClick(i) {
    if (typeof onSelect !== 'function') return;
    onSelect(i);
  }

  // 由 main 调用：设置选中格及其合法落点（高亮），null 清除
  function setSelection(index, targets) {
    selected = index;
    legalTargets = {};
    if (targets) for (const m of targets) legalTargets[m.to] = true;
  }

  function clearSelection() {
    selected = null;
    legalTargets = {};
  }

  function toast(msg) {
    let t = document.getElementById('jq-toast');
    if (!t) {
      t = document.createElement('div');
      t.id = 'jq-toast';
      document.body.appendChild(t);
    }
    t.textContent = msg;
    t.className = 'toast show';
    clearTimeout(t._timer);
    t._timer = setTimeout(() => { t.className = 'toast'; }, 1500);
  }

  NS.Junqi.ui = {
    init, render, setSelection, clearSelection, toast,
  };
})();
