# v1.4.0 娱乐模式·镜像对决·明棋 — 设计文档

日期：2026-10-20　状态：已实现（规则细节经用户确认）

## 背景与目标

在「娱乐模式」容器内新增第二个玩法 **镜像对决·明棋**：

- 开局只随机一次布局，红蓝双方棋子**跨楚河完全镜像对称**。
- **所有棋子从一开始就明置**，全局没有翻棋动作。
- 保持经典规则与既有娱乐玩法（军衔升级）完全不变。

用户确认的规则细节：

1. **镜像方式**：跨楚河上下镜像，`(r,c) ↔ (11-r,c)`（同列、行翻转）。
   地形（行营、铁路、楚河）在该映射下自对称。
2. **阵营/先手**：人机模式**随机分边**，但**红方永远先行**；若人执蓝，AI 红方自动走第一步。
   双人同屏双方都是人类，红方先行。

非目标：新增棋子类型、改变地形/走法/胜负判定、改变经典模式或军衔升级的任何行为。

## 核心架构决策

### ① variant 扩展，与 mode 正交

`constants.VARIANTS` 新增 `MIRROR_OPEN: 'mirrorOpen'`：

- `classic`（经典）、`rankUp`（娱乐·军衔升级）、`mirrorOpen`（娱乐·镜像明棋）三者互斥。
- variant 仍是纯数据字段，随 `createInitialState({mode, variant})` 写入 state，
  经 JSON 快照自动进入 AI Worker；经典/rankUp 路径零改动。

### ② 镜像发牌算法（state.fillMirrorBoard）

棋盘 12×5，10 个行营恒空 → 非行营格恰 50 个；跨河镜像把它们分成 **25 对**。

1. 遍历 `i < B.mirrorIndex(i)` 的 25 个镜像对，跳过行营；
2. 每对用 `Math.random() < 0.5` 随机选一格作为红格；
3. 取红方 25 枚棋子洗牌后依次放到红格；
4. 在每个红格的镜像格放一枚**同类型、蓝方**的新棋子对象。

结果：50 个非行营格全部有子（25 红 + 25 蓝），全部 `revealed: true`。
这同时保证双方子力构成一致、位置完全镜像、没有任何暗子。

`board.mirrorIndex(i)` 为新增纯函数（`(ROWS-1-r)*COLS+c`），供发牌与测试共用。

### ③ 规则与 AI 零改动

全明棋局面下：

- `rules.enumerateActions` 没有任何 `!revealed` 格 → 只产生 move，不产生 flip；
  `hasAnyLegalMove` 直接进入合法走法扫描；`applyMove` 对 flip 的现有
  `cell.revealed` 守卫会直接拒绝。
- `ai.remainingDistribution` 的 `totalUnrevealed = 0`、剩余分布全 0；
  `evaluateBase` 跳过暗子期望；翻棋 chance 节点天然不存在。
- AI 的 make/unmake、clone、quiesce、迭代加深均不依赖首翻定边或暗子，
  因此无需为镜像玩法添加任何 AI 分支。
- 司令阵亡亮旗逻辑仍会运行，但军旗本来已明置，条件 `!c.revealed` 不成立 → no-op。

### ④ 随机分边与 AI 红方开局

`createInitialState` 在镜像模式下直接写入：

- `turn = 'red'`、`sidesAssigned = true`（没有首翻）；
- pvp：`controllers = {red:'human', blue:'human'}`；
- 人机：随机 `humanSide`，另一方为 `'ai'`。

`main.start()` 末尾调用 `scheduleAI()`：

- 经典/rankUp 开局 `sidesAssigned=false` → 现有 `scheduleAI` 直接 no-op，行为不变；
- 镜像人机且人执蓝 → `controllers.red='ai'`，450ms 后 AI 自动走第一步。
- reset/undo 的 worker 生命周期无需改动；worker 快照天然携带 `variant`。

### ⑤ UI 呈现

- 模式弹窗玩法 seg 增加「娱乐·镜像明棋」；玩法说明、模式按钮描述（随机分边/红方先行）
  随选择动态更新。
- 顶栏金标按玩法显示「娱乐·镜像明棋」或「娱乐·军衔升级」。
- 规则弹窗新增 `#rules-mirror` 附条。
- 明棋局没有暗子：左侧面板标题改为「战场信息」，隐藏「未翻透视」两组 chip，
  显示“全部棋子已亮明”的说明；拔雷进度与阵亡名册保留。
  记牌器数据层无需改动——全明棋时 `trackerData` 的 hidden 计数天然全 0。
- 棋盘渲染、aria 标签、上一步描述全部复用既有 `revealed` 分支。

## 已知边界

- 每次重新开局都会重新随机布局与分边。
- 人执蓝时，AI 红方的开局第一步发生在任何人类动作之前，因此不在悔棋历史内；
  之后人机仍是「撤销我的一步 + AI 应手」的整回合语义。
- 安卓 `versionCode/versionName` 按《安卓发布说明》在打 APK 时手动 bump（与既往一致）。

## 修改文件清单

| 文件 | 改动 |
|---|---|
| js/constants.js | VERSION 1.4.0；VARIANTS 增加 MIRROR_OPEN |
| js/board.js | mirrorIndex() 并导出 |
| js/state.js | fillMirrorBoard()；createInitialState 分支（全明置/红先/随机分边） |
| js/main.js | start() 末尾 scheduleAI（AI 红方开局）；variant 注释 |
| index.html | v1.4.0；玩法 seg 第三项；动态说明/金标；rules-mirror；面板「战场信息」 |
| style.css | .seg-variant 窄屏适配；.mirror-hint；明棋局隐藏透视分组 |
| package.json | version 与 dist:win --app-version → 1.4.0 |
| tests/* | +12 用例（rules 2 / state 5 / ai 2 / ui 1 / main 2） |
| README.md | 玩法二说明；娱乐模式段落更新 |

## 验证

- `npm test`：177/177 全绿（新增 12 条镜像玩法用例，既有经典/rankUp 回归全通过）。
- 新增回归护栏：镜像对称、全体明置、非行营格全占、双方构成一致、无 flip 动作、
  AI 在明棋局返回合法走法且不篡改输入/快照一致、人执蓝时 AI 红方自动开局。
- 自弈冒烟：mirrorOpen 5 局（easy vs easy），全部正常终局、非法动作 0、flip 动作 0。
- 语法检查：`node --check js/*.js` 与 index.html 内联脚本解析通过。