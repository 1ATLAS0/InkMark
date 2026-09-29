@echo off
REM 生成 APK 签名用的 keystore（仅 PoC 用；正式发布请自建并妥善保管口令）
REM 用法: make-keystore.cmd [口令]
setlocal
set "PW=%~1"
if "%PW%"=="" set "PW=inkmark-poc"
set "KS=%~dp0keystore\inkmark.jks"
if exist "%KS%" (echo keystore 已存在: %KS% & goto :eof)
mkdir "%~dp0keystore" 2>nul
call keytool -genkeypair -v -keystore "%KS%" -alias inkmark ^
  -keyalg RSA -keysize 2048 -validity 10000 ^
  -storepass "%PW%" -keypass "%PW%" ^
  -dname "CN=InkMark, OU=PoC, O=InkMark, L=-, ST=-, C=CN"
echo.
echo 已生成: %KS%  (alias=inkmark  口令=%PW%)
echo !! 该口令仅用于演示，请勿用于正式分发。
