# v1.2.0 娱乐模式·军衔升级玩法 — 设计文档

日期：2026-10-12　状态：已实现（规则细节经用户确认）

## 背景与目标

保持现有经典模式**完全不变**，新增"娱乐模式"作为可扩展玩法容器；首个玩法为**军衔升级**：

- 吃掉一个棋子后，存活方军衔自动升一级。
- 工兵升级路径特殊：工兵吃子后变为**超级工兵**——移动方式不变、保留排雷能力，此后每吃一个棋子战力 +1（排雷也算吃棋子）。

用户确认的规则细节：
1. **司令封顶**：升到司令（rank 9）后再吃子保持司令，不再变化。
2. **攻防都触发**：只要战斗后己方棋子存活、对方棋子死亡就升级（含防守反杀）；同归于尽双方都不升。
3. **数值同场比较**：超级工兵战力 = 1 + 吃子数（排雷计入），与普通军衔数值（工兵1、排长2 … 司令9）直接比大小，同值同归；战力 ≥10 可吃司令。

非目标：新增棋子类型、改变记牌口径、改变胜负/和棋判定、改动经典模式任何行为。

## 核心架构决策

### ① variant 与 mode 正交
`state.mode`（'ai'|'pvp'）不动，新增 `state.variant`（'classic'|'rankUp'，constants.VARIANTS）。
娱乐模式同样支持人机/双人两种对战形态；variant 是纯数据字段，随 `createInitialState({mode, variant})`
写入 state，经 JSON 快照自动进 AI Worker。**为后续娱乐玩法预留扩展位**。

### ② 升级钩子放在 state.applyBattle 末尾，克隆替换
`applyBattle` 是真实对局与 AI 搜索（applyAction/applyOnClone）共用的唯一交战落盘口。
关键点：

- 该函数内胜负判定（outcome）、阵亡名册（captured）、司令亮旗全部依赖 **对象引用比较**
  （`res.to.piece === p`）。升级逻辑必须放在这些判定**之后**。
- 升级以 `Object.assign({}, surv, {...})` **克隆替换** `state.board[to].piece`，绝不原地改
  `rank`——AI `undoAction` 回填的是原 cell 对象引用，原地突变会让升级泄漏到搜索树其他分支
  （违反 ai.js "撤销后逐位一致" 契约，快照一致性测试会抓到）。
- 仅存活方可升；地雷/军旗/炸弹（`PIECES[type].special`）不参与升级（地雷防守吃到来袭子也不升）。
- 升级记录 `promotion = {side, type, fromRank, rank, captures}` 随返回值 → `lastMove.battle.promotion`
  → main.js toast 播报 + sfx 'promote' 音效。

### ③ 棋子身份：type 不变，rank 即战力
升级**不改 type**，只改 piece.rank（工兵另加 piece.captures）。理由：
`captured['type:side']` 名册、AI `remainingDistribution` 暗子分布、ui `trackerData`
记牌器全部按 type 口径计数，改 type 会导致计数出现负数/口径漂移。
`resolveBattle` 本来就读 piece.rank 比大小 → 战力比较**零改动**天然成立；
工兵排雷（`a.type === 'engineer'`）与铁路转弯 BFS（同判定）也天然保留。

### ④ AI 升级感知
- 战术层免费：所有交战预测走 `resolveBattle`，读的就是活 rank。
- 静态估值：新增 `valueOfPiece(piece)`——未升级子与 `valueOf(type)` 逐位一致（经典 AI 零影响）；
  升级子按 `RANK_VALUE`（军衔阶梯，由 PIECE_VALUE 反查生成）估值；超级工兵另加 +10 挖雷溢价
  （工兵22 − 排长12 的口径差），rank>9 每级再 +10（可吃司令 → 比司令贵）。
  替换了全部持有 piece 对象的估值点（材料/威胁图/危险度/MVV-LVA/delta 剪枝等）；
  暗子期望仍按 type（暗子永不升级，成立）。
- `threatWeight(type, mines, piece?)` 加可选第三参：超级工兵战力高了不再按普通工兵 0.5 折价；
  两参旧签名行为逐位不变（既有测试锁定）。
- `scoreActionMedium` 的"攻击者存活"判定由 `type` 比较改为**引用比较**：娱乐模式下同 type
  可能 rank 不同（升级排长 vs 排长），type 相等不再等价于攻击者存活（经典下两者等价）。
- `clone()` 补拷 `variant` 字段（否则 applyOnClone 路径搜索时升级不生效、预测失真）。

### ⑤ UI 呈现
- 棋子名统一走 `C.pieceName(piece)`（升级感知）：升级子显示新军衔名；工兵 captures>0 显示
  "超级工兵"（四字双行 tspan 排版，0.26px 字号缩进圆内）。
- 升级子加**金环**标识（区分"升上来的连长"与原生连长）；超级工兵加**战力数字角标**（金底）。
- toast 播报 `C.promotionText`（"⬆ 红方排长 升级为 连长" / "⬆ 工兵 升级为 超级工兵 · 战力 2" /
  "⬆ 超级工兵 战力 +1 → N"），吃子音后 220ms 叠一记上行音阶 'promote'。
- 顶栏金标 `#variant-badge`、规则弹窗附条 `#rules-fun` 仅在 rankUp 局显示（applyModeUI 切换）。
- 模式弹窗新增玩法 seg（经典模式 / 娱乐·军衔升级）+ 动态玩法说明；选完模式一并生效，
  `reset()` 后 variant 与 mode/difficulty 一样跨重开保持。
- 记牌器/阵亡名册不变：按 type 口径，升级不影响计数（阵亡名册显示原类型名，接受此近似）。
- aria 标签、上一步描述、交战 FX 文本全部走 pieceName。

## 已知近似与边界

- 司令阵亡亮旗仍按 `type === 'commander'` 判定：升级到 rank 9 的军长阵亡**不**触发亮旗
  （保持经典规则口径，避免娱乐模式引入连锁规则变化）。
- 吃军旗同样触发升级（军旗也是棋子；同时终局，无实际影响）。
- 阵亡名册显示原类型名（升级排长阵亡记"排长"）；如需精确显示升级后军衔需改 captured
  存储结构，暂不做。
- Android versionCode/versionName 未动，发 APK 时按《安卓发布说明》流程另行 bump。

## 修改文件清单

| 文件 | 改动 |
|---|---|
| js/constants.js | VERSION 1.2.0；VARIANTS/RANK_MAX/RANK_NAMES/RANK_VALUE/SIDE_NAME；pieceName()/promotionText() |
| js/state.js | createInitialState 收 opts.variant；applyBattle 末尾克隆式升级 + promotion 返回；lastMove 补 rank/captures/promotion |
| js/ai.js | valueOfPiece()；估值点全量换用；threatWeight 第三参；scoreActionMedium 引用判定；clone() 带 variant |
| js/main.js | variant 状态 + setVariant()；升级 toast/promote 音效；导出 |
| js/ui.js | pieceName 渲染（双行 tspan/金环/战力角标）；aria/lastmove/FX 文本升级感知 |
| js/sfx.js | 'promote' 音效（五声音阶上行三连） |
| index.html | v1.2.0；顶栏玩法金标；弹窗玩法 seg + 说明；规则弹窗娱乐附条；接线 |
| style.css | .variant-badge/.variant-row/.variant-desc/.fun-rule/.piece-text-2l/.power-badge-text |
| package.json | version 1.2.0；dist:win --app-version 1.2.0 |
| tests/* | +21 用例（state 12 / rules 2 / ai 4 / ui 3 / main 1，含经典回归护栏） |
| README.md | 娱乐模式章节 |

## 验证

- `npm test`：156/156 全绿（原 135 + 新 21）。
- 关键回归护栏：经典模式同款战斗断言"存活者仍为原对象、rank 不变、promotion=null"。
- AI 一致性：rankUp 下 chooseMove（medium/hard/master）不篡改输入状态（boardSig 含 rank/captures），
  快照与活状态产出相同动作；quiesce 吃子链展开后逐位还原。
- 整局自弈冒烟（AI vs AI ×3 局 ×2 玩法）：经典 promotions=0；娱乐每局 14~20 次升级、
  超级工兵正常成长、无非法动作、状态可 JSON 序列化。
- DOM 桩渲染冒烟：升级子显示新军衔名 + 金环，超级工兵双行名 + 战力角标，暗子/特殊子不受影响。
