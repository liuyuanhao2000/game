// 军旗翻翻棋 — ui.js 记牌器「悔棋复活」回归测试
// 覆盖缺陷：阵亡名册是 append-only diff（renderTracker 假设 state.captured 局内只增，
// prevLost 仅在 changed 时更新）。悔棋复活棋子后 captured 回退 → delta 为负不更新
// prevLost（高水位残留）→ 该型棋子再次被吃时 delta≤0 → chip 永久缺失，名册脱同步。
// 修复：ui.js 导出 rebuildTracker()（包一层幂等的 buildTracker，清空 prevLost/hiddenEls
// 缓存），main.undo() 恢复快照后调用。
//
// 手法：与 tests/ui-gameover.test.js 同款轻量假 DOM，驱动真实 UI.init/render 全链路。
const { test } = require('node:test');
const assert = require('node:assert');

// ---- 轻量假 DOM（必须先于 require ui.js 就位；与 ui-gameover.test.js 同款） ----
function makeEl(tag) {
  const e = {
    tagName: tag || 'div',
    children: [],
    parentNode: null,
    attrs: {},
    style: {},
    dataset: {},
    textContent: '',
    listeners: {},
    classList: {
      _set: new Set(),
      add(...cs) { for (const c of cs) this._set.add(c); },
      remove(...cs) { for (const c of cs) this._set.delete(c); },
      contains(c) { return this._set.has(c); },
      toggle(c, force) {
        const want = force !== undefined ? !!force : !this._set.has(c);
        if (want) this._set.add(c); else this._set.delete(c);
        return want;
      },
    },
    setAttribute(k, v) {
      this.attrs[k] = String(v);
      if (k === 'class') this.className = v;
    },
    getAttribute(k) { return this.attrs[k] !== undefined ? this.attrs[k] : null; },
    appendChild(c) { c.parentNode = this; this.children.push(c); return c; },
    removeChild(c) {
      const i = this.children.indexOf(c);
      if (i >= 0) this.children.splice(i, 1);
      c.parentNode = null;
      return c;
    },
    get firstChild() { return this.children.length ? this.children[0] : null; },
    addEventListener(type, fn) { (this.listeners[type] = this.listeners[type] || []).push(fn); },
    removeEventListener() {},
    focus() {},
    querySelector(sel) { return qs(this, sel); },
  };
  let _html = '';
  Object.defineProperty(e, 'innerHTML', {
    get() { return _html; },
    set(v) {
      _html = String(v);
      if (_html === '') { for (const c of e.children) c.parentNode = null; e.children.length = 0; }
    },
  });
  // className ↔ classList 双向同步（真实 DOM 语义）：ui.js 的 hel() 用
  // `e.className = cls` 造 chip，不同步则 classList.contains 永远为 false。
  let _cls = '';
  Object.defineProperty(e, 'className', {
    get() { return _cls; },
    set(v) {
      _cls = String(v);
      e.classList._set = new Set(_cls.split(/\s+/).filter(Boolean));
    },
  });
  return e;
}

// 仅支持 ui.js 实际用到的简单选择器：'tag.class'（layer）与 '.class'（lost-empty）
function qs(root, sel) {
  const m = /^([A-Za-z][\w-]*)?(\.[\w-]+)?$/.exec(sel);
  if (!m || (!m[1] && !m[2])) return null;
  const tag = m[1] || null, cls = m[2] ? m[2].slice(1) : null;
  const walk = (n) => {
    for (const c of n.children) {
      if ((!tag || c.tagName === tag) && (!cls || c.classList.contains(cls))) return c;
      const hit = walk(c);
      if (hit) return hit;
    }
    return null;
  };
  return walk(root);
}

const byId = new Map(); // getElementById 按 id 记忆化：同一 id 恒返回同一元素
global.document = {
  readyState: 'complete',
  addEventListener() {},
  body: makeEl('body'),
  getElementById(id) {
    let e = byId.get(id);
    if (!e) { e = makeEl('div'); byId.set(id, e); }
    return e;
  },
  createElement(tag) { return makeEl(tag); },
  createElementNS(ns, tag) { return makeEl(tag); },
};

require('../js/constants.js');
require('../js/board.js');
require('../js/ui.js');

const UI = Junqi.ui;

UI.init({
  board: document.getElementById('board'),
  status: document.getElementById('status'),
  mines: document.getElementById('mines'),
  lastmove: document.getElementById('lastmove'),
  onSelect: () => {},
});

// ---- 状态构造（与 tests/ui-gameover.test.js 同款形状） ----
function makeState(over) {
  const b = new Array(60);
  for (let i = 0; i < 60; i++) b[i] = { piece: null, revealed: false };
  return Object.assign({
    board: b, rows: 12, cols: 5, turn: null, controllers: { red: null, blue: null }, mode: 'ai',
    sidesAssigned: false, winner: null, staleCount: 0,
    minesLost: { red: 0, blue: 0 }, captured: {}, lastMove: null, prevMove: null, onChange: null,
  }, over);
}

// 阵亡名册观测点（假 DOM 的 querySelector 只回首个匹配，chip 计数用 children 过滤）
function lostChips(side) {
  const box = document.getElementById('lost-' + side);
  return box.children.filter((c) => c.classList.contains('chip-lost'));
}
function lostEmpty(side) {
  return document.getElementById('lost-' + side).querySelector('.lost-empty');
}
function lostCount(side) {
  return document.getElementById('lost-' + side + '-count').textContent;
}

test('ui: rebuildTracker 后名册可回退 — 复活棋子清空 chip、计数归零、空位提示复原', () => {
  UI.render(makeState({ captured: { 'engineer:red': 1 } })); // 红方工兵阵亡
  assert.strictEqual(lostChips('red').length, 1, '前置：应有 1 枚阵亡 chip');
  assert.strictEqual(lostCount('red'), '1');

  UI.rebuildTracker();                                       // 悔棋恢复（captured 回退）
  UI.render(makeState({ captured: {} }));

  assert.strictEqual(lostChips('red').length, 0, '复活的棋子不得残留 chip');
  assert.ok(lostEmpty('red'), '「红方暂无阵亡」空位提示应复原');
  assert.strictEqual(lostCount('red'), '0', '阵亡计数应归零');
});

test('ui: 脱同步回归锁 — 吃子→悔棋复活→同型再被吃，名册恰好 1 chip（修复前永久 0）', () => {
  UI.rebuildTracker();                                       // 隔离上一用例的名册状态
  UI.render(makeState({ captured: {} }));

  UI.render(makeState({ captured: { 'engineer:red': 1 } })); // 第一次被吃
  assert.strictEqual(lostChips('red').length, 1);

  UI.rebuildTracker();                                       // 悔棋：main.undo() 的恢复序列
  UI.render(makeState({ captured: {} }));                    // 复活
  assert.strictEqual(lostChips('red').length, 0);

  UI.render(makeState({ captured: { 'engineer:red': 1 } })); // 同型再被吃
  assert.strictEqual(lostChips('red').length, 1,
    'prevLost 高位残留会让 delta≤0，chip 永久缺失（append-only diff 无法表达复活）');
  assert.strictEqual(lostCount('red'), '1');

  UI.rebuildTracker();                                       // 收尾复位，隔离后续文件内用例
  UI.render(makeState({ captured: {} }));
});
