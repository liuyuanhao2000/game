#!/bin/bash
# 交互式写入 android/keystore.properties（密码隐藏输入，不进命令历史/会话记录）
#
# 用法：
#   scripts/write-keystore-config.sh [keystore 路径]
# 默认 keystore 路径：$HOME/junqi-release.keystore（即仓库同级的 ../junqi-release.keystore）
#
# 写入前会用 keytool 校验 keystore 密码和别名，避免构建到一半才报错。
set -e
set -u

cd "$(dirname "$0")/.." || exit 1

# 路径优先级：命令行参数 > 已有 keystore.properties > 默认位置 > 旧版默认位置
# 这样各机器各自的自定义路径不会被覆盖
if [ -n "${1:-}" ]; then
  keystore="$1"
elif [ -f android/keystore.properties ]; then
  keystore=$(sed -n 's/^[[:space:]]*storeFile[[:space:]]*=[[:space:]]*//p' android/keystore.properties | tr -d '\r' | head -1)
  case "$keystore" in
    /*) ;;
    *)  keystore="android/app/$keystore" ;;   # 与 Gradle 的 file() 一致
  esac
  [ -f "$keystore" ] || keystore=""
fi
if [ -z "${keystore:-}" ]; then
  for candidate in "$HOME/junqi-release.keystore" "$HOME/liu/release/junqi-release.keystore"; do
    if [ -f "$candidate" ]; then keystore="$candidate"; break; fi
  done
fi
keystore="${keystore:-$HOME/junqi-release.keystore}"

if [ ! -f "$keystore" ]; then
  echo "错误：keystore 不存在：$keystore" >&2
  echo "      可用参数指定路径：scripts/write-keystore-config.sh /path/to/release.keystore" >&2
  exit 1
fi
# Gradle 的 file() 相对 android/app/ 解析，统一写绝对路径最稳妥
keystore=$(cd "$(dirname "$keystore")" && pwd)/$(basename "$keystore")

read -rsp "keystore 密码: " store_pw
echo
read -rp "key 别名 [junqi]: " key_alias
key_alias="${key_alias:-junqi}"
read -rsp "key 密码（与 keystore 相同则直接回车）: " key_pw
echo
key_pw="${key_pw:-$store_pw}"

# 校验：密码能打开 keystore，且别名存在（密码走环境变量，不出现在进程参数里）
if ! STOREPW="$store_pw" keytool -list -keystore "$keystore" -storepass:env STOREPW >/dev/null 2>&1; then
  unset store_pw key_pw
  echo "错误：keystore 密码不正确" >&2
  exit 1
fi
if ! STOREPW="$store_pw" keytool -list -alias "$key_alias" -keystore "$keystore" -storepass:env STOREPW >/dev/null 2>&1; then
  unset store_pw key_pw
  echo "错误：keystore 中没有别名 \"$key_alias\"。现有别名：" >&2
  STOREPW="$store_pw" keytool -list -keystore "$keystore" -storepass:env STOREPW 2>/dev/null | sed -n 's/^\([^,]*\),.*/\1/p' >&2 || true
  exit 1
fi

umask 077
printf 'storeFile=%s\nstorePassword=%s\nkeyAlias=%s\nkeyPassword=%s\n' \
  "$keystore" "$store_pw" "$key_alias" "$key_pw" > android/keystore.properties
unset store_pw key_pw

echo "已写入 android/keystore.properties（权限 600，已 gitignore）"
echo "  keystore: $keystore"
echo "  alias:    $key_alias"
