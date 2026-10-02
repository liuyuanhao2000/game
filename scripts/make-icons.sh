#!/bin/sh
# 生成 Android 全套图标与启动屏（图标唯一真源：assets/logo.png，1024×1024）
# 用法：bash scripts/make-icons.sh
# 说明：
#   1. @capacitor/assets 依赖 sharp 0.32，其 libvips 二进制默认从 GitHub 下载，
#      国内网络常超时，这里指向 npmmirror 镜像。
#   2. logo.png 模式会生成全套（自适应图标 + 传统图标 + 启动屏）；
#      背景色 #15314A 需与图标底色一致（更换图标时须核对，否则自适应图标边缘会露底色差）。
#   3. 图标本体圆角外是透明区，作为自适应前景放在同色底上正好无缝。
#   4. 历史坑（P0-5）：本脚本曾 `cp desktop/icon.png assets/logo.png`——那是旧的
#      512×512 图标，会静默把 v1.0.10 起的 1024×1024 国潮印章新 logo 覆盖回旧版
#      并生成全套旧图标。切勿恢复该拷贝；desktop/icon.png 仅供 Electron 桌面版使用，
#      与 Android 图标源解耦（如需统一桌面图标，那是一个独立的产品决策，应显式进行）。
set -e
cd "$(dirname "$0")/.." || exit 1

# 图标源存在性检查：缺失时大声失败，而不是静默用别处的旧图标兜底
if [ ! -f assets/logo.png ]; then
  echo "错误：缺少 assets/logo.png（Android 图标唯一真源，1024×1024）" >&2
  echo "请先把图标源放到 assets/logo.png 再运行本脚本。" >&2
  exit 1
fi

npm install -D @capacitor/assets \
  --sharp-libvips-binary-host=https://npmmirror.com/mirrors/sharp-libvips

npx capacitor-assets generate --android \
  --assetPath assets \
  --iconBackgroundColor '#15314A' \
  --iconBackgroundColorDark '#15314A' \
  --splashBackgroundColor '#15314A' \
  --splashBackgroundColorDark '#15314A'

echo "图标已生成 → android/app/src/main/res/mipmap-*/"
