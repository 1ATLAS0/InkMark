@echo off
REM 对未签名的 release APK 做 zipalign + apksigner 签名
REM 用法: set INKMARK_KEYSTORE_PASS=<口令> && sign-apk.cmd <input.apk> [output.apk]
setlocal
set "SDK=%~dp0..\.toolchain\android-sdk"
set "BT=%SDK%\build-tools\36.0.0"
set "KS=%~dp0keystore\inkmark.jks"
set "IN=%~1"
set "OUT=%~2"

if "%IN%"=="" echo 用法: set INKMARK_KEYSTORE_PASS=^<口令^> ^&^& sign-apk.cmd ^<input.apk^> [output.apk] & exit /b 1
if not exist "%KS%" (echo 缺少 keystore: %KS% —— 先运行 make-keystore.cmd & exit /b 1)
if not defined INKMARK_KEYSTORE_PASS (
  echo 未设置 INKMARK_KEYSTORE_PASS 环境变量（口令不写死在脚本里，避免随仓库泄露）
  exit /b 1
)
if "%OUT%"=="" set "OUT=%~dpn1-signed.apk"

call "%BT%\zipalign.exe" -f -p 4 "%IN%" "%~dpn1-aligned.apk" || exit /b 1
call "%BT%\apksigner.bat" sign --ks "%KS%" --ks-key-alias inkmark ^
  --ks-pass "env:INKMARK_KEYSTORE_PASS" --key-pass "env:INKMARK_KEYSTORE_PASS" ^
  --out "%OUT%" "%~dpn1-aligned.apk" || exit /b 1
call "%BT%\apksigner.bat" verify --print-certs "%OUT%"
echo.
echo 已签名: %OUT%
