@echo off
REM 对未签名的 release APK 做 zipalign + apksigner 签名
REM 用法: sign-apk.cmd <input.apk> [output.apk]
setlocal
set "SDK=%~dp0..\.toolchain\android-sdk"
set "BT=%SDK%\build-tools\36.0.0"
set "IN=%~1"
set "OUT=%~2"
if "%IN%"=="" echo 用法: sign-apk.cmd ^<input.apk^> [output.apk] & exit /b 1
if "%OUT%"=="" set "OUT=%~dpn1-signed.apk"

if not exist "%~dp0keystore\inkmark.jks" (
  echo 缺 keystore，先运行 make-keystore.cmd & exit /b 1
)

call "%BT%\zipalign.exe" -f -p 4 "%IN%" "%~dpn1-aligned.apk" || exit /b 1
call "%BT%\apksigner.bat" sign --ks "%~dp0keystore\inkmark.jks" --ks-key-alias inkmark ^
  --ks-pass pass:inkmark-poc --key-pass pass:inkmark-poc ^
  --out "%OUT%" "%~dpn1-aligned.apk" || exit /b 1
call "%BT%\apksigner.bat" verify --print-certs "%OUT%"
echo.
echo 已签名: %OUT%
