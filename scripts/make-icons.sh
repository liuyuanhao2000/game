#!/bin/sh
# 生成 Android 全套图标与启动屏（复用 desktop/icon.png）
# 用法：bash scripts/make-icons.sh
# 说明：
#   1. @capacitor/assets 依赖 sharp 0.32，其 libvips 二进制默认从 GitHub 下载，
#      国内网络常超时，这里指向 npmmirror 镜像。
#   2. logo.png 模式会生成全套（自适应图标 + 传统图标 + 启动屏）；
#      背景色 #15314A 取自 icon.png 的底色，保证与原图视觉一致。
#   3. 图标本体圆角外是透明区，作为自适应前景放在同色底上正好无缝。
set -e
cd "$(dirname "$0")/.." || exit 1

npm install -D @capacitor/assets \
  --sharp-libvips-binary-host=https://npmmirror.com/mirrors/sharp-libvips

mkdir -p assets
cp desktop/icon.png assets/logo.png

npx capacitor-assets generate --android \
  --assetPath assets \
  --iconBackgroundColor '#15314A' \
  --iconBackgroundColorDark '#15314A' \
  --splashBackgroundColor '#15314A' \
  --splashBackgroundColorDark '#15314A'

echo "图标已生成 → android/app/src/main/res/mipmap-*/"
