# 军旗翻翻棋（暗棋）

浏览器军旗翻翻棋小游戏，支持人机对战（简单/普通/困难三档 AI）。零依赖、零构建，双击 `index.html` 即玩。

## 玩法

- 5×12 棋盘，含**铁路**（多步直线移动，工兵可转弯）与**行营**（安全格，不可被攻击）。
- 开局所有棋子背面朝下随机铺满；**翻开第一颗棋子决定你的阵营**，红方先手。
- 每回合可**翻棋**或**移动**一颗已翻己方子；地雷/军旗不可移动。
- 大吃小，同级同归于尽；工兵可挖雷，炸弹与任何子同归于尽。
- 楚河仅在左(C1)/中(C3)/右(C5)三处可过。
- 吃掉对方军旗或令其无路可走即胜；连续 40 回合无吃翻判和。

## 运行

直接双击 `index.html` 打开即可（file://）。也可用本地服务器：

```bash
python3 -m http.server 8000
# 浏览器访问 http://localhost:8000
```

## 测试

规则/状态/AI 为纯逻辑，用 Node 内置测试框架：

```bash
node --test tests/rules.test.js tests/state.test.js tests/ai.test.js
```

## 结构

```
index.html / style.css        # 标记与样式
js/constants.js               # 棋子表/价值/常量
js/board.js                   # 棋盘地形、楚河邻接、铁路图
js/rules.js                   # 合法走法/交战结算/胜负（纯函数）
js/state.js                   # 游戏状态唯一真源
js/ai.js                      # 三档 AI（随机/启发式/expectimax+概率）
js/ui.js / js/main.js         # 渲染与回合调度
tests/                        # Node 单测
docs/superpowers/specs/       # 设计文档
```
