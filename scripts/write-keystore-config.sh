#!/bin/bash
# 交互式写入 android/keystore.properties（密码隐藏输入，不进命令历史/会话记录）
# 用法：bash scripts/write-keystore-config.sh
set -e
cd "$(dirname "$0")/.." || exit 1

read -srp "输入 keystore 密码: " pw
echo
printf 'storeFile=/home/yhliu/junqi-release.keystore\nstorePassword=%s\nkeyAlias=junqi\nkeyPassword=%s\n' "$pw" "$pw" > android/keystore.properties
unset pw
echo "已写入 android/keystore.properties（该文件已被 gitignore）"
