@echo off
REM 生成 APK 签名用的 keystore
REM 用法: make-keystore.cmd <口令>     （口令必须自带，不再提供默认值）
setlocal
set "PW=%~1"
if "%PW%"=="" (
  echo 用法: make-keystore.cmd ^<口令^>
  echo 提示: 口令请自行生成并离线保管（例如 pwgen -s 24 1）；本文件不提供默认口令。
  exit /b 1
)
set "KS=%~dp0keystore\inkmark.jks"
if exist "%KS%" (echo keystore 已存在: %KS% ^(如需重建请先备份并删除^) & goto :eof)
mkdir "%~dp0keystore" 2>nul
call keytool -genkeypair -v -keystore "%KS%" -alias inkmark ^
  -keyalg RSA -keysize 2048 -validity 10000 ^
  -storepass "%PW%" -keypass "%PW%" ^
  -dname "CN=InkMark, OU=PoC, O=InkMark, L=-, ST=-, C=CN"
echo.
echo 已生成: %KS%  (alias=inkmark)
echo !! 请离线备份 keystore 与口令：更换 keystore 会导致已安装用户无法覆盖升级。
