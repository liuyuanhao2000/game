# 悔棋（Undo）设计 — v1.3.0（2026-10-16）

## 1. 需求与语义（用户确认）

| 决策点 | 结论 |
|---|---|
| 人机模式粒度 | 一次悔棋撤销**一整回合**：人类的一步 + AI 的应手，回到人类回合 |
| 双人模式粒度 | 一次悔棋撤销**一步** |
| 终局后 | **禁止**悔棋（toast「对局已结束，无法悔棋」），需「再来一局」 |
| 次数 | **不限**，无惩罚 |
| AI 思考中 | **允许**悔棋：作废在飞思考（450ms 挂起窗口 / worker 在飞 / 看门狗，全覆盖） |

原始设计（2026-06-23 spec §7）将悔棋列为非目标，本版按用户需求反转；复盘回放仍不做。

## 2. 方案：整状态快照栈（main.js）

`state` 为纯 JSON 可序列化对象（唯一函数字段 `onChange`），发牌后全程无随机性
（翻棋只是 `revealed=true`，暗子身份在 `createInitialState` 洗牌时已固定），
`applyMove` 是唯一变异入口 → **走子前拍整状态快照**即可完备回退，
无需碰 ai.js 内部的 make/unmake（`docs/优化建议.md` CORE-1/5 警告过三套 apply 路径的脆弱契约）。

- 复用 `main.js` 既有 `snapshot()`（JSON 往返，喂 AI worker 同款，<1ms）。
- **唯一压栈点 `commitAction`**（人类走子），且仅在 `applyMove` 返回 `ok` 时入栈
  （被拒走子不入栈，否则悔棋消耗点击却原地空转）。
- `start()` 首行清空 `history`：start 是所有新局路径（boot / reset / 换模式 / 再来一局）
  的唯一漏斗，旧发牌快照不得跨局、跨模式泄漏。

### 核心不变式：压栈点恒为人类回合边界

AI 的三个落子路径（`onWorkerResult` / `runAISync` / 看门狗·onerror 兜底）都只在
`commitAction` 下游被触发，且 AI 不先手翻棋（`runAI` 有 `sidesAssigned` 守卫）。
因此**每个快照之后恰有 0 或 1 个 AI 步**：

- 人机模式一次 pop = 撤「人类一步 + AI 应手」= 整回合；首翻快照
  （`turn:null`、`controllers` 全 null、`sidesAssigned:false`）连定阵营一并撤销。
- 双人模式双方共用 `commitAction`，一次 pop = 一步。
- 人类终局步的快照成为死条目：被 winner 守卫挡住，reset 时清空——无需专门分支。

## 3. `undo()` 时序（main.js）

1. 守卫：`winner` → toast 拒绝；空栈 → toast「暂无可悔棋的步数」。
2. **失效三部曲**（与 `reset()` 同款）：清 `aiTimer`（覆盖 450ms 窗口与同步降级）、
   `thinkId++`（迟到 worker 结果按 id 作废）、`killWorker()`（terminate 在飞线程 + 清 15s 看门狗）。
3. `state = history.pop()` —— **整对象替换**而非字段拷贝。
4. 重挂 `onChange`（JSON 快照丢函数字段）。
5. UI 恢复：`clearSel()` → `UI.rebuildTracker()` → `UI.markLastMoveRendered(state)` → `UI.render(state)` → `SFX.play('undo')`。
6. 防御性 `scheduleAI()`：快照恒为人类回合边界 → 正常是 no-op，防意外态 AI 停摆。

### 为什么必须是对象替换

代码库的过期守卫全是**身份比较**，且就是围绕「换对象」设计的：

- `soundAfterApply` 升级音定时器 `if (state === st)`（main.js，220ms）；
- 终局 700ms 弹层 `state === liveState`（ui.js renderHud）。

替换对象让这些挂起回调自动失效；若改为字段拷贝（保持同一对象），旧局面的
升级音会在悔棋后漏播、终局弹层可能误弹。测试断言因此必须**重新取** `getState()`。

## 4. UI 层配套（js/ui.js 新增两个导出）

- `rebuildTracker()`：包一层幂等的 `buildTracker()`。阵亡名册是 append-only diff
  （假设 `captured` 局内只增、`prevLost` 仅在 changed 时更新），悔棋复活棋子后
  高水位残留会让同型棋子再次被吃时 delta≤0 → chip 永久缺失。清重建即复位
  `prevLost` / `hiddenEls.prev` 缓存。不整调 `UI.init`：避免无谓拆建 60 格 SVG 点击层。
- `markLastMoveRendered(st)`：`renderedLastMove` 按引用比较，快照还原出的旧
  `lastMove` 是新对象，不标记会把已撤销走子的入场动画重播一遍（棋盘"自己动"）。

棋盘本体零改动：`render(state)` 是全量重绘；终局弹层在 winner 为 null 时走
else 分支自愈隐藏（终局禁悔之下属双保险）。

## 5. 交互与音效

- 按钮：topbar 第二行「悔棋」（`.btn-ghost`，`#switch-mode` 与 `#restart` 之间），
  单击即生效，不用二次确认（arm 模式留给毁局的 restart）。守卫全在 `main.undo()`
  内，按钮态零同步（代码库无 disabled 先例，toast 是既有拦截习语）。
- 音效 `undo`：下行双音 D5→G4（triangle），与 `promote` 上行三连互为镜像，"时间回拨"感。

## 6. 测试

- `tests/undo.test.js`（main.test.js 同款桩环境，8 用例）：pvp 单步回退、
  人机整回合回退（深度等于走前快照，锁 prevMove/mode/variant 保真）、450ms 窗口内
  悔棋 AI 永不出手、worker 在飞悔棋 terminate+迟到结果作废、不限次数连悔到发牌态+
  空栈 toast、终局拦截（不做任何恢复动作）、reset 清史、恢复钩子（rebuildTracker×1 /
  markLastMoveRendered 参数 === 恢复态 / undo 音效 / onChange 重挂后渲染链恢复）。
- `tests/ui-tracker-undo.test.js`（ui-gameover 同款假 DOM，2 用例）：rebuildTracker
  后名册回退（chip 清空、计数归零、空位提示复原）+ 脱同步回归锁
  （吃子→复活→同型再吃，恰好 1 chip；修复前为 0）。
- `tests/sfx.test.js` 音效名数组登记 `undo`；新文件登记进 package.json test script。

## 7. 版本

v1.3.0：package.json（version + `dist:win` 硬编码 `--app-version`）、js/constants.js
`VERSION`、index.html 占位文本三处同步（version.test.js 强制前两者相等）。
android/app/build.gradle 按《安卓发布说明》在打 APK 时手动 bump（versionCode 10→11、
versionName 1.3.0）。
