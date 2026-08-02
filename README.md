# 军旗翻翻棋（暗棋）

浏览器军旗翻翻棋小游戏，支持人机对战（简单/普通/困难/大师四档 AI）。零依赖、零构建，双击 `index.html` 即玩。

自带记牌器侧栏：未翻棋子透视（按阵营分列，剧透模式）、双方阵亡名册、拔雷进度条，均带计数动效。

音效为 Web Audio 程序化合成（零资源文件、离线可用），翻棋/落子/吃子/炸弹/拔雷/胜负小调全套；顶栏「音效」按钮可静音（设置持久化）。

## 玩法

- 5×12 棋盘，含**铁路**（多步直线移动，工兵可转弯）与**行营**（安全格，不可被攻击；行营内棋子可向 8 个方向移动，斜走仅限与行营斜相邻的方向）。
- 开局所有棋子背面朝下随机铺满；**你永远先翻第一颗棋子，翻出的颜色决定你的阵营**（若翻到蓝色，则先行移动的是 AI）。
- 每回合可**翻棋**或**移动**一颗已翻己方子；地雷/军旗不可移动。
- 大吃小，同级同归于尽；工兵可挖雷，炸弹与任何子同归于尽；**炸弹炸掉对方军旗 → 旗方立即判负**。
- 必须**先拔光对方全部 3 颗地雷**，才能攻击其军旗（吃旗、炸弹炸旗均受此限制）。
- 铁路上可直线滑行多步（工兵可转弯），但**不能在同一步内离轨**；离开铁路到相邻普通/行营格须是独立的下一步。
- 楚河仅在左(C1)/中(C3)/右(C5)三处可过。
- 吃掉（或炸掉）对方军旗、或令其无路可走即胜——无路可走**优先于和棋**判负；连续 40 回合（=双方各 40 步）无吃子且无翻棋判和。

## 运行

直接双击 `index.html` 打开即可（file://）。也可用本地服务器：

```bash
python3 -m http.server 8000
# 浏览器访问 http://localhost:8000
```

## 桌面版（Electron 打包）

想发给别人当桌面程序玩（无需浏览器/服务器）：

```bash
npm install            # 安装 electron 开发依赖（仅打包需要，游戏本体零依赖不变）
npm start              # 本机开发运行（Linux 需图形环境）
npm run dist:win       # 构建 Windows x64 版 → dist/军旗翻翻棋-win32-x64/
```

**分发方式**：把 `dist/军旗翻翻棋-win32-x64` 整个文件夹 zip 发给对方，解压后双击 `军旗翻翻棋.exe` 即玩，无需安装。

- 首次运行 Windows 可能弹 SmartScreen「未知发布者」提示（未购买代码签名证书的正常现象），点「更多信息 → 仍要运行」即可。
- 首版使用 Electron 默认图标；如需自定义：把 `desktop/icon.ico` 备好，在 Windows 上构建时加 `--icon=desktop/icon.ico`（Linux 宿主换 Windows 图标需安装 wine）。

经 HTTP 部署（如 `./run.sh`）时，困难/大师档 AI 的思考在后台线程（Web Worker）进行，AI 思考期间页面不冻屏、动画照常播放；`file://` 直接打开时自动降级为同步思考，游戏行为完全一致。

## 测试

规则/状态/AI 为纯逻辑，用 Node 内置测试框架（需 Node ≥ 18，`node:test`）：

```bash
npm test

# 或直接运行三个测试文件：
node --test tests/rules.test.js tests/state.test.js tests/ai.test.js
```

## 无障碍

支持键盘操作（Tab 聚焦格子、方向键移动焦点、Enter/Space 翻棋或走子），状态有 aria-live 播报；动画尊重 `prefers-reduced-motion`。

## 结构

```
index.html / style.css        # 标记与样式
package.json                  # 脚本入口（npm test）
js/constants.js               # 棋子表/价值/常量
js/board.js                   # 棋盘地形、楚河邻接、铁路图
js/rules.js                   # 合法走法/交战结算/胜负（纯函数）
js/state.js                   # 游戏状态唯一真源
js/ai.js                      # 四档 AI（随机/启发式/困难=expectimax+quiesce/大师=+aspiration+killer，3s 预算）
js/ui.js / js/main.js         # 渲染与回合调度
tests/                        # Node 单测
docs/superpowers/specs/       # 设计文档
```

## 调试与「AI 不作弊」

纯前端游戏：调试接口 `Junqi.main.getState()` 会暴露未翻子的阵营（可在 devtools 读取）。「AI 不作弊」指 AI 逻辑不读取隐藏信息（只用公开信息与剩余分布概率），并非对玩家的防作弊保证。

## 许可证

MIT（见 [LICENSE](LICENSE)）。
