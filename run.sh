#!/bin/sh
# 军旗翻翻棋 — 本地服务器启动脚本
# 用法：./run.sh，然后浏览器访问 http://localhost:8000（Ctrl+C 停止）
# 响应附带 Cache-Control: no-store，浏览器总是加载最新代码（开发期免缓存困扰）
cd "$(dirname "$0")" || exit 1
echo "军旗翻翻棋已启动：http://localhost:8000 （Ctrl+C 停止）"
exec python3.10 -c '
from http.server import HTTPServer, SimpleHTTPRequestHandler

class Handler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

HTTPServer(("0.0.0.0", 8000), Handler).serve_forever()
'
