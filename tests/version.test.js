// 军旗翻翻棋 — 版本一致性单测：constants.VERSION 必须与 package.json 一致
// （界面版本号由 js/main.js 从 constants.VERSION 渲染，忘同步会导致显示旧版本）
const { test } = require('node:test');
const assert = require('node:assert');
require('../js/constants.js');
const pkg = require('../package.json');

test('version: constants.VERSION 与 package.json version 一致', () => {
  assert.strictEqual(Junqi.constants.VERSION, pkg.version);
});
