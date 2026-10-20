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
#   scripts/dist-desktop.sh all "国潮墨金UI"  # 同上；APK 自动归档到根目录并带备注后缀
#   scripts/dist-desktop.sh --dev        # 不打包，只补装本机运行用的 electron 二进制（npm start 用）
#
# APK 归档：带 android 构建时，产物自动复制到仓库根目录，命名为
#   军旗翻翻棋-v<版本>_<备注>.apk（备注 = 平台关键字之外的参数，可省略）
#
# 说明：
# - 依赖和 electron 二进制都走 npmmirror 镜像（直连 npmjs.org / github 经常超时）
# - 依赖用 --ignore-scripts 安装：sharp（@capacitor/assets 的依赖，仅安卓用）
#   在本机 node-gyp 编译会失败并导致整个 install 回滚，跳过脚本不影响桌面打包
# - 打包本身不依赖 node_modules/electron/dist（packager 自行下载对应平台的 zip），
#   只有本机 npm start 才需要它，用 --dev 补装
# - android 需要 JDK 21 + Android SDK + android/keystore.properties（签名），
#   环境搭建见 安卓构建指南.md；签名配置用 scripts/write-keystore-config.sh 生成
# - android/app/build.gradle 的 versionCode/versionName 会自动跟随 package.json：
#   versionName 不一致时 versionName 直接同步、versionCode +1（改动记得提交）

set -e
set -u

cd "$(dirname "$0")/.."

export ELECTRON_MIRROR="https://npmmirror.com/mirrors/electron/"
REGISTRY="https://registry.npmmirror.com"
APP_NAME="军旗翻翻棋"
APP_VERSION=$(node -p "require('./package.json').version")
# 白名单式 ignore：排除一切，只放行 Electron 运行所需文件
# （根目录的 APK / 备份 / 预览目录等历史遗留曾多次被打进 asar，黑名单防不住）
IGNORE='^/(?!index\.html$|style\.css$|package\.json$|LICENSE$|README\.md$|js(/|$)|desktop(/(?!make-icon\.js$)|$)|node_modules(/|$))'

platforms=()
build_android=0
dev_only=0
apk_note=""

for arg in "$@"; do
  case "$arg" in
    --dev)       dev_only=1 ;;
    win|windows) platforms+=(win32) ;;
    linux)       platforms+=(linux) ;;
    android|apk) build_android=1 ;;
    all)         platforms+=(win32 linux); build_android=1 ;;
    *)           apk_note="$arg" ;;   # 平台关键字之外的参数 = APK 备注后缀
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
    echo "      运行 scripts/write-keystore-config.sh 生成（默认复用已有配置，否则读 \$HOME/junqi-release.keystore）" >&2
    exit 1
  fi
  store_file=$(sed -n 's/^[[:space:]]*storeFile[[:space:]]*=[[:space:]]*//p' android/keystore.properties | tr -d '\r' | head -1)
  if [ -z "$store_file" ]; then
    echo "错误：android/keystore.properties 缺少 storeFile，请重新生成签名配置" >&2
    exit 1
  fi
  # 与 Gradle 的 file() 一致：相对路径以 android/app/ 为基准（不能按仓库根目录判断）
  case "$store_file" in
    /*) ;;
    *)  store_file="$PWD/android/app/$store_file" ;;
  esac
  if [ ! -f "$store_file" ]; then
    echo "错误：keystore.properties 指向的 keystore 不存在：$store_file" >&2
    echo "      重新运行 scripts/write-keystore-config.sh <keystore 路径>" >&2
    exit 1
  fi

  # SDK 路径：local.properties（不入库）缺失时按 ANDROID_HOME → ~/android-sdk 补齐
  if [ ! -f android/local.properties ]; then
    sdk_dir="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-$HOME/android-sdk}}"
    if [ -d "$sdk_dir" ]; then
      printf 'sdk.dir=%s\n' "$sdk_dir" > android/local.properties
      echo "==> 已生成 android/local.properties（sdk.dir=$sdk_dir）"
    else
      echo "错误：找不到 Android SDK。安装后设置 ANDROID_HOME，或写 android/local.properties" >&2
      echo "      见 安卓构建指南.md 第 0 节" >&2
      exit 1
    fi
  fi

  # versionCode/versionName 跟随 package.json（原来靠手工改，常忘）
  gradle_file="android/app/build.gradle"
  gradle_version=$(sed -n 's/^[[:space:]]*versionName "\(.*\)"/\1/p' "$gradle_file" | head -1)
  if [ "$gradle_version" != "$APP_VERSION" ]; then
    gradle_code=$(sed -n 's/^[[:space:]]*versionCode \([0-9][0-9]*\)/\1/p' "$gradle_file" | head -1)
    if [ -z "$gradle_code" ]; then
      echo "错误：无法从 $gradle_file 读取 versionCode" >&2
      exit 1
    fi
    new_code=$((gradle_code + 1))
    # 不用 sed -i：BSD/macOS 的 sed 不支持无后缀的 -i
    tmp_file=$(mktemp)
    sed \
      -e "s/^\([[:space:]]*\)versionCode [0-9][0-9]*/\1versionCode $new_code/" \
      -e "s/^\([[:space:]]*\)versionName \".*\"/\1versionName \"$APP_VERSION\"/" \
      "$gradle_file" > "$tmp_file"
    cat "$tmp_file" > "$gradle_file"   # 保留原文件权限/属主
    rm -f "$tmp_file"
    echo "==> 同步 build.gradle 版本：$gradle_version (code $gradle_code) -> $APP_VERSION (code $new_code)"
    echo "    记得提交该改动"
  fi
  npm run stage:web
  node_modules/.bin/cap sync android
  (cd android && ./gradlew assembleRelease)

  # 归档 APK 到仓库根目录（沿用历史版本的命名习惯；cp 保留 gradle 原产物）
  APK_SRC="android/app/build/outputs/apk/release/app-release.apk"
  if [ -n "$apk_note" ]; then
    APK_OUT="${APP_NAME}-v${APP_VERSION}_${apk_note}.apk"
  else
    APK_OUT="${APP_NAME}-v${APP_VERSION}.apk"
  fi
  cp -f "$APK_SRC" "$APK_OUT"
  echo "==> APK 已归档：$APK_OUT"
fi

echo "==> 完成，产物："
for p in "${platforms[@]}"; do
  case "$p" in
    win32) echo "  dist/${APP_NAME}-win32-x64/${APP_NAME}.exe（整个文件夹 zip 发给 Windows 用户）" ;;
    linux) echo "  dist/${APP_NAME}-linux-x64/${APP_NAME}（整个文件夹打包发给 Linux 用户）" ;;
  esac
done
if [ "$build_android" -eq 1 ]; then
  echo "  ${APK_OUT}（已归档到根目录，直接发文件给安卓用户）"
fi
