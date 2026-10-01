# v1.1.0 UI 升级收尾 — 设计文档

日期：2026-10-01　分支：ai-upgrade　状态：已获用户批准（方案 A）

## 背景

另一模型完成了 v1.1.0「国潮墨金」UI 升级（未提交），整体质量较好：
安全区适配、≥40px 触控目标、prefers-reduced-motion、aria 属性、窄屏手风琴、
版本号升级（package.json 1.1.0 / Android versionCode 9）、www/ 已同步、121 测试全过。

但探索发现以下不完善之处，本设计逐项收尾。

## 修复清单

### ① 版本一致性（高）
- `js/constants.js` `VERSION '1.0.9' → '1.1.0'`（界面版本号唯一来源，JS 运行时覆盖 HTML 占位）
- 新增 `tests/version.test.js`：断言 `constants.VERSION === package.json.version`，防再犯
- 修完运行 `npm run stage:web` 重新同步 www/

### ② Electron 启动底色（中）
- `desktop/main.js` `backgroundColor '#15314a'（旧蓝）→ '#17181c'（新墨黑）`

### ③ 打包 ignore 白名单化（高，方案 A）
`package.json` `dist:win` 与 `scripts/dist-desktop.sh` 两份相同的黑名单 ignore
被 APK、preview/、*.bak 等穿透（app.asar 52MB，内含 8 个 APK）。
改为白名单式负向前瞻正则，只放行 Electron 运行所需：
`index.html`、`style.css`、`package.json`、`js/`、`desktop/`（排除 make-icon.js）、
`node_modules/`、`LICENSE`、`README.md`。
（desktop/main.js 仅引用 desktop/icon.png，assets/ 不需要。）
只修脚本，不重新打包；用 node 对根目录逐项验证正则命中。

### ④ a11y / 交互小修（低）
- 两个 `<details>` 面板补回 `aria-label`
- 难度分段按钮补 `aria-pressed`；启动时调用一次 `syncDiffUI(currentDiff)` 统一初始状态
- 宽屏（≥980px）summary 加 `pointer-events: none`（样式已呈非交互态但点击仍会折叠，视觉与行为矛盾）
- Android `styles.xml` 启动主题补 `navigationBarColor #17181C`

### ⑤ 清理与提交
- 删除遗留：`preview/`、`index.html.v109.bak`、`style.css.v109.bak`、`apply_v110.sh`（均为 HEAD 副本或已执行完的一次性脚本）
- `git rm -r --cached dist`（本地保留；.gitignore 已含 dist/）
- 两个提交：
  1. `chore: dist/ 移出 git 跟踪`
  2. `v1.1.0: 国潮墨金 UI + 一致性修复`
- 提交前全量 `npm test` 通过；只 commit 不 push

## 不动的部分
- 新 UI 视觉设计本身（用户已认可）
- 根目录 8 个历史 APK（用户存档，仅排除出打包）

## 验收标准
1. `npm test` 全过（含新增 version 测试）
2. 浏览器打开 index.html，右下角/顶栏版本号显示 v1.1.0
3. ignore 正则验证：白名单外文件全部被排除
4. `git status` 干净：无遗留未跟踪文件，dist 不再被跟踪
5. 两个规范提交完成，未 push
