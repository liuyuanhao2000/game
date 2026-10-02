// 军旗翻翻棋 — ui.js 终局结算浮层延迟回调回归测试
// 覆盖 P0-3 缺陷：弹层的 700ms setTimeout 闭包捕获的是 render 的实参 state（旧局对象），
// 旧对象 winner 恒为真值——终局后 700ms 内快速重开（armed 双击机制允许），
// 旧定时器会把结算浮层误弹到已经开好的新棋盘上。
// 修复：ui.js 记录 liveState（最近一次 render 的 state 对象），定时器内做引用同一性比对。
//
// 手法：轻量假 DOM（覆盖 ui.js 实际用到的 API 面）驱动真实的 UI.init + UI.render 全链路；
// goStartFx 在无 requestAnimationFrame 环境下早退（ui.js:740 自带守卫），无需 canvas 桩。
const { test } = require('node:test');
const assert = require('node:assert');

// ---- 轻量假 DOM（必须先于 require ui.js 就位） ----
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
      if (k === 'class') this.classList._set = new Set(String(v).split(/\s+/).filter(Boolean));
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
    // 故意不提供 getContext：goStopFx 的 typeof 守卫（ui.js:753）会跳过画布清理
  };
  let _html = '';
  Object.defineProperty(e, 'innerHTML', {
    get() { return _html; },
    set(v) {
      _html = String(v);
      if (_html === '') { for (const c of e.children) c.parentNode = null; e.children.length = 0; }
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

const byId = new Map(); // getElementById 按 id 记忆化：同一 id 恒返回同一元素（跨 render 可断言）
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

const C = Junqi.constants;
const UI = Junqi.ui;

UI.init({
  board: document.getElementById('board'),
  status: document.getElementById('status'),
  mines: document.getElementById('mines'),
  lastmove: document.getElementById('lastmove'),
  onSelect: () => {},
});

// ---- 状态构造（与 tests/ui.test.js 的 emptyState 同款形状） ----
function makeState(over) {
  const b = new Array(60);
  for (let i = 0; i < 60; i++) b[i] = { piece: null, revealed: false };
  return Object.assign({
    board: b, rows: 12, cols: 5, turn: null, controllers: { red: null, blue: null }, mode: 'ai',
    sidesAssigned: false, winner: null, staleCount: 0,
    minesLost: { red: 0, blue: 0 }, captured: {}, lastMove: null, prevMove: null, onChange: null,
  }, over);
}
// 人机模式人类胜的终局（renderHud 走 win 分支：印章/标题/副标题 + 排定 700ms 弹层）
function endState() {
  return makeState({
    sidesAssigned: true, turn: 'blue', winner: 'red',
    controllers: { red: 'human', blue: 'ai' },
  });
}

test('ui: 终局后 700ms 内重开新局 → 旧局延迟弹层不得误弹到新棋盘', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const go = document.getElementById('gameover');

  UI.render(makeState());   // 非终局：else 分支隐藏浮层（与真实页面初始 hidden 一致）
  assert.ok(go.classList.contains('hidden'), '非终局时浮层应隐藏');

  UI.render(endState());    // 终局：排定 700ms 延迟弹层
  assert.ok(go.classList.contains('hidden'), '700ms 内浮层尚未弹出');

  UI.render(makeState());   // 用户在 700ms 内快速重开 → main.start() 已重建 state 对象

  t.mock.timers.tick(700);  // 旧局的定时器到期
  assert.ok(go.classList.contains('hidden'),
    '旧局定时器不得把结算浮层弹到已重开的新棋盘上（P0-3：闭包捕获旧 state，winner 恒真）');
});

test('ui: 终局未重开 → 700ms 后结算浮层正常弹出（修复不破坏正路径）', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const go = document.getElementById('gameover');

  UI.render(makeState());
  UI.render(endState());
  assert.ok(go.classList.contains('hidden'), '700ms 内浮层尚未弹出');

  t.mock.timers.tick(700);
  assert.ok(!go.classList.contains('hidden'), '当前局的结算浮层应正常弹出');
  assert.strictEqual(go.dataset.result, 'win', '人机模式人类胜 → win 视觉');

  UI.render(makeState());   // 收尾：隐藏浮层并复位 gameoverShown，隔离下一用例
  assert.ok(go.classList.contains('hidden'));
});

test('ui: 同一局连续多次 render（终局态重渲染）不得重复排定弹层定时器', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const go = document.getElementById('gameover');
  const st = endState();

  UI.render(makeState());
  UI.render(st);            // 终局第一次 render：排定弹层
  UI.render(st);            // 同一对象再 render（如选中变化触发）：gameoverShown 已置位，不再排定
  t.mock.timers.tick(700);
  assert.ok(!go.classList.contains('hidden'), '弹层应弹出（恰好一次路径生效）');

  UI.render(makeState());   // 收尾复位
});
