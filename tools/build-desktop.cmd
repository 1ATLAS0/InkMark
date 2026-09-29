@echo off
REM InkMark 桌面端（Windows x64）一键打包
REM 依赖: Node 20+/22+、VS2019 BuildTools(含 C++ 工具链)、Python 3
REM 关键: 必须强制 msvs_version=2019，因为本机 VS2022 Community 的 VC 组件未在 vswhere 注册
setlocal
set "GYP_MSVS_VERSION=2019"
set "npm_config_msvs_version=2019"
REM 国内网络建议走镜像；Electron 官方 Release 在本机多次下载失败
set "ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/"
set "ELECTRON_BUILDER_BINARIES_MIRROR=https://npmmirror.com/mirrors/electron-builder-binaries/"
cd /d "%~dp0..\desktop"

echo [1/3] 安装依赖（含 Electron 下载与原生模块重编）...
call npx --yes pnpm@10.33.4 install --no-frozen-lockfile || goto :err

echo [1.2/3] 校验品牌层（幂等；上游改动导致规则失效时会报错）...
node "%~dp0rebrand.mjs" || goto :err

echo [1.5/3] 关闭 native-keymap 的 Spectre 库要求（本机未装该 VS 组件）...
node "%~dp0patch-native-keymap.mjs" || goto :err

echo [2/3] 构建并打包 (electron-vite build + electron-builder --win --x64)...
call npx --yes pnpm@10.33.4 build:win:x64 || goto :err

echo [3/3] 完成。产物：
dir /b "..\dist\*setup.exe" "..\dist\*.zip" 2>nul
echo.
echo 输出目录: %~dp0..\dist
goto :eof

:err
echo.
echo !! 构建失败，请查看上方日志。
exit /b 1
