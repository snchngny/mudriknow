import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { WindowInfo } from "../shared/types";
import { runPowerShell } from "./powershell-runner";

// A fixed HWND is mandatory: a newly spawned PowerShell or the chat panel
// can steal foreground. Never identify whatever became foreground afterwards.
export const WINDOW_IDENTITY_SCRIPT = `param([string]$OutputFile, [long]$TargetHwnd)
$ErrorActionPreference = "Stop"
Add-Type -TypeDefinition @"
using System;
using System.Text;
using System.Runtime.InteropServices;
public class MudrikIdentity {
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder text, int count);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint processId);
}
"@
$targetProcessId = [uint32]0
$handle = [IntPtr]$TargetHwnd
[MudrikIdentity]::GetWindowThreadProcessId($handle, [ref]$targetProcessId) | Out-Null
if ($targetProcessId -eq 0) { throw "Target window is no longer available" }
$buffer = New-Object System.Text.StringBuilder 2048
[MudrikIdentity]::GetWindowText($handle, $buffer, $buffer.Capacity) | Out-Null
$proc = Get-Process -Id $targetProcessId -ErrorAction Stop
$result = @{ title=$buffer.ToString(); processName=$proc.ProcessName; processPath=""; hwnd=$TargetHwnd; productName=""; productVersion=""; fileVersion=""; publisher=""; versionSource="unknown" }
try {
  $result.processPath = $proc.MainModule.FileName
  $info = [System.Diagnostics.FileVersionInfo]::GetVersionInfo($result.processPath)
  $result.productName = $info.ProductName
  $result.publisher = $info.CompanyName
  $result.productVersion = $info.ProductVersion
  $result.fileVersion = $info.FileVersion
  if (-not [string]::IsNullOrWhiteSpace($info.ProductVersion)) { $result.versionSource = "product-version" }
  elseif (-not [string]::IsNullOrWhiteSpace($info.FileVersion)) { $result.versionSource = "file-version" }
} catch { }
$result | ConvertTo-Json -Compress | Out-File -FilePath $OutputFile -Encoding utf8
`;

export async function readWindowIdentity(targetHwnd: number): Promise<WindowInfo | null> {
  if (!Number.isSafeInteger(targetHwnd) || targetHwnd <= 0) return null;
  const scriptDir = path.join(os.tmpdir(), "hoverbuddy");
  fs.mkdirSync(scriptDir, { recursive: true });
  const script = path.join(scriptDir, "mudrik-window-identity-v1.ps1");
  fs.writeFileSync(script, WINDOW_IDENTITY_SCRIPT, "utf8");
  const result = await runPowerShell(script, ["-TargetHwnd", String(targetHwnd)], { timeout: 8000 });
  if (result.exitCode || !result.output) return null;
  try {
    const raw = JSON.parse(result.output.replace(/^\uFEFF/, ""));
    if (raw.hwnd !== targetHwnd || !raw.processName) return null;
    return raw as WindowInfo;
  } catch { return null; }
}
