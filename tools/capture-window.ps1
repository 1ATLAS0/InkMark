# 截取指定进程的主窗口（用 PrintWindow，不依赖窗口是否在前台）
# 用法: powershell -ExecutionPolicy Bypass -File tools\capture-window.ps1 [-ProcessName inkmark] [-Out path.png]
param(
  [string]$ProcessName = "inkmark",
  [string]$Out = "D:\Markdown\tools\preview\app-window.png"
)
Add-Type -AssemblyName System.Drawing
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class WinCap {
  [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr hWnd, IntPtr hdcBlt, uint nFlags);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
}
"@
$proc = Get-Process -Name $ProcessName -ErrorAction SilentlyContinue |
        Where-Object { $_.MainWindowHandle -ne 0 -and $_.MainWindowHandle -ne $null } |
        Select-Object -First 1
if (-not $proc) { Write-Error "未找到窗口进程: $ProcessName"; exit 1 }

$h = $proc.MainWindowHandle
$r = New-Object WinCap+RECT
[void][WinCap]::GetWindowRect($h, [ref]$r)
$w = $r.Right - $r.Left; $ht = $r.Bottom - $r.Top
if ($w -le 0 -or $ht -le 0) { Write-Error "窗口尺寸异常: ${w}x${ht}"; exit 1 }

# 先把窗口激活并还原，再按其矩形抓屏；Electron/Chromium 用 PrintWindow 常返回空白帧
$shell = New-Object -ComObject wscript.shell
[void]$shell.AppActivate($proc.Id)
Start-Sleep -Milliseconds 900
[void][WinCap]::GetWindowRect($h, [ref]$r)
$w = $r.Right - $r.Left; $ht = $r.Bottom - $r.Top

$bmp = New-Object System.Drawing.Bitmap $w, $ht
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen($r.Left, $r.Top, 0, 0, (New-Object System.Drawing.Size $w, $ht))
$dir = Split-Path $Out -Parent
if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir | Out-Null }
$bmp.Save($Out, [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose(); $bmp.Dispose()
Write-Output "saved: $Out (${w}x${ht}) via screen-capture"
