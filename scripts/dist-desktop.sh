#!/bin/bash
#
# 桌面版打包脚本（Electron，Windows / Linux；另支持 Android APK）
#
# 用法：
#   scripts/dist-desktop.sh              # 默认打全平台：Windows x64 + Linux x64 + Android APK（同 all）
#   scripts/dist-desktop.sh win          # 只打 Windows x64
#   scripts/dist-desktop.sh linux        # 只打 Linux x64
#   scripts/dist-desktop.sh android      # 只打 Android 签名 release APK
#   scripts/dist-desktop.sh all          # 三个都打（win + linux + android）
#   scripts/dist-desktop.sh --dev        # 不打包，只补装本机运行用的 electron 二进制（npm start 用）
#
# 说明：
# - 依赖和 electron 二进制都走 npmmirror 镜像（直连 npmjs.org / github 经常超时）
# - 依赖用 --ignore-scripts 安装：sharp（@capacitor/assets 的依赖，仅安卓用）
#   在本机 node-gyp 编译会失败并导致整个 install 回滚，跳过脚本不影响桌面打包
# - 打包本身不依赖 node_modules/electron/dist（packager 自行下载对应平台的 zip），
#   只有本机 npm start 才需要它，用 --dev 补装
# - android 需要 JDK 21 + Android SDK + android/keystore.properties（签名），
#   环境搭建见 安卓构建指南.md；发新版时记得同步 android/app/build.gradle 的
#   versionCode/versionName（不会自动跟随 package.json）

set -e
set -u

cd "$(dirname "$0")/.."

export ELECTRON_MIRROR="https://npmmirror.com/mirrors/electron/"
REGISTRY="https://registry.npmmirror.com"
APP_NAME="军旗翻翻棋"
APP_VERSION=$(node -p "require('./package.json').version")
IGNORE="^/(dist|docs|tests|scripts|desktop/make-icon\.js|\.claude|\.git|plans|www|android)"

platforms=()
build_android=0
dev_only=0

for arg in "$@"; do
  case "$arg" in
    --dev)       dev_only=1 ;;
    win|windows) platforms+=(win32) ;;
    linux)       platforms+=(linux) ;;
    android|apk) build_android=1 ;;
    all)         platforms+=(win32 linux); build_android=1 ;;
    *)
      echo "未知参数: $arg（可用: win linux android all --dev）" >&2
      exit 1
      ;;
  esac
done

# 没指定平台时默认打全平台（win + linux + android，同 all）
if [ ${#platforms[@]} -eq 0 ] && [ "$build_android" -eq 0 ] && [ "$dev_only" -eq 0 ]; then
  platforms+=(win32 linux)
  build_android=1
fi

# 1. 安装依赖（已装则跳过）
if [ ! -x node_modules/.bin/electron-packager ] || [ ! -x node_modules/.bin/cap ]; then
  echo "==> 安装依赖（npmmirror 镜像，--ignore-scripts）"
  npm install --ignore-scripts --registry="$REGISTRY"
fi

# 2. 只补装本机运行二进制（npm start 用）
if [ "$dev_only" -eq 1 ]; then
  echo "==> 补装本机 electron 二进制"
  (cd node_modules/electron && node install.js)
  echo "完成，可 npm start"
  exit 0
fi

# 3. 打包桌面版（Electron）
for p in "${platforms[@]}"; do
  echo "==> 打包 $p x64（v$APP_VERSION）"
  node_modules/.bin/electron-packager . "$APP_NAME" \
    --platform="$p" --arch=x64 --out=dist --overwrite \
    --app-version="$APP_VERSION" \
    --ignore="$IGNORE"
done

# 4. 打包 Android APK（签名 release，环境要求见 安卓构建指南.md / 安卓发布说明.md）
if [ "$build_android" -eq 1 ]; then
  echo "==> 打包 Android APK（v$APP_VERSION）"
  if [ ! -d android ]; then
    echo "错误：android/ 工程不存在，先按 安卓构建指南.md 执行 npx cap add android" >&2
    exit 1
  fi
  if [ ! -f android/keystore.properties ]; then
    echo "错误：缺少 android/keystore.properties（签名配置，已 gitignore），" >&2
    echo "      参照 android/keystore.properties.example 填写后重试" >&2
    exit 1
  fi
  npm run stage:web
  node_modules/.bin/cap sync android
  (cd android && ./gradlew assembleRelease)
fi

echo "==> 完成，产物："
for p in "${platforms[@]}"; do
  case "$p" in
    win32) echo "  dist/${APP_NAME}-win32-x64/${APP_NAME}.exe（整个文件夹 zip 发给 Windows 用户）" ;;
    linux) echo "  dist/${APP_NAME}-linux-x64/${APP_NAME}（整个文件夹打包发给 Linux 用户）" ;;
  esac
done
if [ "$build_android" -eq 1 ]; then
  echo "  android/app/build/outputs/apk/release/app-release.apk（直接发文件给安卓用户）"
fi
