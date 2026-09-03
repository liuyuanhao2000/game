#!/bin/sh
# 把游戏静态文件搬运到 www/，供 Capacitor 打包 Android
set -e
cd "$(dirname "$0")/.." || exit 1
rm -rf www
mkdir -p www
cp index.html style.css www/
cp -r js www/
echo "www/ 已就绪（index.html / style.css / js/）"
