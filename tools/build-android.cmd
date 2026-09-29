@echo off
REM InkMark 安卓端一键打包（debug + unsigned release）
REM 依赖: JDK 21（Capacitor 8 要求 sourceCompatibility 21）、Android SDK(platforms;android-36 + build-tools;36.0.0)
REM JDK 21 默认取 .toolchain\jdk-21*（可用 JAVA_HOME 覆盖）
setlocal
set "SDK=%~dp0..\.toolchain\android-sdk"
if not defined JAVA_HOME (
  for /d %%D in ("%~dp0..\.toolchain\jdk-21*") do set "JAVA_HOME=%%~fD"
)
if not defined JAVA_HOME (
  echo !! 未找到 JDK 21。请下载 Temurin 21 解压到 .toolchain\jdk-21 或设置 JAVA_HOME。
  exit /b 1
)
echo JAVA_HOME=%JAVA_HOME%
set "ANDROID_HOME=%SDK%"
set "ANDROID_SDK_ROOT=%SDK%"
cd /d "%~dp0..\android"

REM local.properties 必须用正斜杠；反斜杠在 .properties 里是转义字符，会解析成非法路径
> android\local.properties echo sdk.dir=%SDK:\=/%

echo [1/4] 安装依赖...
call npx --yes pnpm@10.33.3 install --no-frozen-lockfile || goto :err

echo [2/4] 构建 Web 产物并同步到 Android 工程 (cap sync)...
call npx --yes pnpm@10.33.3 run android:sync || goto :err

cd android
echo [3/4] Gradle assembleDebug ...
call gradlew.bat assembleDebug || goto :err

echo [4/4] Gradle assembleRelease（未签名，可用 tools\make-keystore.cmd + tools\sign-apk.cmd 签名）...
call gradlew.bat assembleRelease || goto :err

echo.
echo 产物:
dir /b /s app\build\outputs\apk\*.apk
goto :eof

:err
echo.
echo !! 构建失败，请查看上方日志。
exit /b 1
