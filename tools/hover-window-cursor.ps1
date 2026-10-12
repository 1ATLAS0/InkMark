# 找到 inkmark 主窗口，把鼠标移到指定相对位置，然后截屏（含指针）
# 用法: powershell -ExecutionPolicy Bypass -File tools/hover-window-cursor.ps1 [-Out path.png] [-RelX 0.5] [-RelY 0.5]
param(
  [string]$Out = "D:\Markdown\tools\preview\win-cursor.png",
  [double]$RelX = 0.5,
  [double]$RelY = 0.5,
  [string]$ProcessName = "inkmark"
)
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class WinRect2 {
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
}
"@
$candidates = Get-Process $ProcessName -ErrorAction SilentlyContinue |
      Where-Object { $_.MainWindowHandle -ne 0 } |
      ForEach-Object {
        $rect = New-Object WinRect2+RECT
        [void][WinRect2]::GetWindowRect($_.MainWindowHandle, [ref]$rect)
        [pscustomobject]@{ Proc = $_; Rect = $rect; Area = ($rect.Right - $rect.Left) * ($rect.Bottom - $rect.Top) }
      } | Sort-Object Area -Descending
if (-not $candidates) { Write-Error "$ProcessName window not found"; exit 1 }
$r = $candidates[0].Rect
Write-Output ("window: {0},{1} - {2},{3} ({4} px wide)" -f $r.Left, $r.Top, $r.Right, $r.Bottom, ($r.Right - $r.Left))
$x = [int]($r.Left + ($r.Right - $r.Left) * $RelX)
$y = [int]($r.Top + ($r.Bottom - $r.Top) * $RelY)
& python (Join-Path $PSScriptRoot "capture-cursor.py") $x $y $Out
