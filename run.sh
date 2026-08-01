#!/bin/sh
# 军旗翻翻棋 — 本地服务器启动脚本
# 用法：./run.sh，然后浏览器访问 http://localhost:8000（Ctrl+C 停止）
cd "$(dirname "$0")" || exit 1
echo "军旗翻翻棋已启动：http://localhost:8000 （Ctrl+C 停止）"
exec python3.10 -m http.server 8000
