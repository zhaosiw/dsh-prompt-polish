# uninstall.ps1 — 从 profile 里摘掉 dsh-prompt-polish（不重启宿主）
#
# 步骤：备份 → 从 cordis.patch.yml 删掉它的 insert 块 → pnpm remove → touch patch 触发对账 → 验证图里已无该行
#
# 用法：
#   pwsh -File uninstall.ps1
#   pwsh -File uninstall.ps1 -ProfileName desktop -KeepPackage   # 只摘 patch 行，保留依赖

[CmdletBinding()]
param(
  [string]$ProfileName = '',
  [string]$PackageName = 'dsh-prompt-polish',
  [string]$RowId       = 'prompt-polish',
  [string]$Port        = '',
  [string]$Pnpm        = 'pnpm',
  [switch]$KeepPackage
)

$ErrorActionPreference = 'Stop'
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'

function Write-Step([string]$t) { Write-Host "`n=== $t ===" -ForegroundColor Cyan }
function Write-Ok([string]$t)   { Write-Host "  OK   $t" -ForegroundColor Green }

function Resolve-LiveProfile {
  if ($ProfileName) { return $ProfileName }
  $hits = Get-CimInstance Win32_Process -Filter "Name = 'DeepSeek Harness.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -match 'dsh-desktop-host' } |
    ForEach-Object { if ($_.CommandLine -match '\.dsh\\profiles\\([^"\\]+)') { $Matches[1] } } |
    Select-Object -Unique
  if ($hits.Count -eq 1) { return $hits[0] }
  return 'desktop'
}

$ProfileName = Resolve-LiveProfile
$profileDir  = Join-Path (Join-Path $HOME '.dsh') "profiles\$ProfileName"
$patch       = Join-Path $profileDir 'cordis.patch.yml'
$pkgJson     = Join-Path $profileDir 'package.json'
$verifyJs    = Join-Path $PSScriptRoot '_verify.mjs'
if (-not (Test-Path $patch)) { throw "找不到 $patch" }

Write-Step "目标 profile: $profileDir"

# 1. 备份
foreach ($f in @($patch, $pkgJson)) {
  if (Test-Path $f) { Copy-Item $f "$f.bak-unpolish-$stamp" -Force; Write-Ok "backup $(Split-Path $f -Leaf) -> *.bak-unpolish-$stamp" }
}

# 2. 删掉我们那条 insert 块（按 `- id: <RowId>` 起、到下一个顶层 `- ` 或文件尾）
Write-Step "从 cordis.patch.yml 移除 $RowId 行"
$lines = Get-Content $patch
$out   = New-Object System.Collections.Generic.List[string]
$removed = 0
for ($i = 0; $i -lt $lines.Count; $i++) {
  if ($lines[$i] -match "^\s*-\s*id:\s*$([regex]::Escape($RowId))\s*$") {
    # 回退到 owning "- insert:"（若紧邻两行之内）
    if ($out.Count -ge 2 -and $out[$out.Count - 1] -match '^\s{2,4}-\s*$|^\s*$' -and $out[$out.Count - 2] -match '^-\s*insert:\s*$') {
      $out.RemoveAt($out.Count - 1)
      $out.RemoveAt($out.Count - 1)
    }
    elseif ($out.Count -ge 1 -and $out[$out.Count - 1] -match '^-\s*insert:\s*$') {
      $out.RemoveAt($out.Count - 1)
    }
    # 跳过这一行及其后续缩进更深的字段行（name / config / inject …）
    $i++
    while ($i -lt $lines.Count -and ($lines[$i] -match '^\s{4,}\S' -or $lines[$i] -match '^\s*$')) { $i++ }
    $i--
    $removed++
  }
  else {
    $out.Add($lines[$i])
  }
}

if ($removed -eq 0) {
  Write-Ok 'patch 里没有该行，跳过'
}
else {
  Set-Content -Path $patch -Value ($out -join "`n") -Encoding utf8 -NoNewline
  Write-Ok "已移除 $removed 条 insert 行"
}

# 3. pnpm remove（除非只摘 patch 行）
if (-not $KeepPackage) {
  Write-Step '从 profile 依赖里移除'
  $hasDep = Select-String -Path $pkgJson -Pattern "`"$([regex]::Escape($PackageName))`"\s*:" -Quiet
  if ($hasDep) {
    & $Pnpm --dir $profileDir remove $PackageName
    if ($LASTEXITCODE -ne 0) { Write-Host "  pnpm remove 退出码 $LASTEXITCODE（依赖可能已被清掉，继续验证）" -ForegroundColor Yellow }
    else { Write-Ok "pnpm remove $PackageName" }
  }
  else { Write-Ok '依赖里没有它，跳过' }
}

# 4. 关键：touch patch，避免 Copy-Item/Set-Content 的 mtime 语义让 HMR 漏检
(Get-Item $patch).LastWriteTime = Get-Date
Start-Sleep -Seconds 3

# 5. 验证
Write-Step '验证：图里应已无该行'
if (Test-Path $verifyJs) {
  if (-not $Port) { $Port = '61372' }
  $out2 = & node $verifyJs $PackageName $Port 2>&1
  $out2 | ForEach-Object { Write-Host "  $_" }
  if (($out2 -join "`n") -match 'GRAPH_HIT.*true') {
    Write-Host "`n图里仍有该行：多半是孤儿行（文件已无声明，运行中未对账）。执行：" -ForegroundColor Yellow
    Write-Host "  (Get-Item '$patch').LastWriteTime = Get-Date"
    Write-Host "  再等 3 秒重跑本脚本验证。"
  }
  else { Write-Ok '图里已无该行；浏览器侧已随之清理（无需刷新）' }
}
