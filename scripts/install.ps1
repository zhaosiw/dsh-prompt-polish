# install.ps1 — 把 dsh-prompt-polish 装进「正在运行的那个」DSH profile 并热加载
#
# 幂等：重复执行只会补齐缺失的步骤，不会重复 insert、不会重复 add。
# 安全：不重启宿主；每次改 profile 前自动备份；任一步失败自动回滚。
#
# 用法：
#   pwsh -File install.ps1                      # 自动探测在跑的 profile（推荐）
#   pwsh -File install.ps1 -ProfileName desktop
#   pwsh -File install.ps1 -ProfileName web     # 只有你确实用 `dsh web` 起宿主时才用
#   pwsh -File install.ps1 -VerifyOnly          # 只做只读验证
#
# 依赖：pnpm 在 PATH（或 -Pnpm 指定）；node 在 PATH（用于 SSE 验证）。

[CmdletBinding()]
param(
  [string]$ProfileName = '',
  [string]$PluginDir   = (Split-Path $PSScriptRoot -Parent),
  [string]$PackageName = 'dsh-prompt-polish',
  [string]$RowId       = 'prompt-polish',
  [string]$Port        = '',
  [string]$Pnpm        = 'pnpm',
  [switch]$SkipInstall,   # 只补 patch / 只验证
  [switch]$VerifyOnly
)

$ErrorActionPreference = 'Stop'
$stamp   = Get-Date -Format 'yyyyMMdd-HHmmss'
$home_   = Join-Path $HOME '.dsh'

function Write-Step([string]$t) { Write-Host "`n=== $t ===" -ForegroundColor Cyan }
function Write-Ok([string]$t)   { Write-Host "  OK   $t" -ForegroundColor Green }
function Write-Warn2([string]$t){ Write-Host "  WARN $t" -ForegroundColor Yellow }

# ---------------------------------------------------------------- 0. 探测在跑的 profile
function Resolve-LiveProfile {
  if ($ProfileName) { return $ProfileName }
  # desktop 宿主进程的命令行里带着 profile 目录
  $hits = Get-CimInstance Win32_Process -Filter "Name = 'DeepSeek Harness.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -match 'dsh-desktop-host' } |
    ForEach-Object {
      if ($_.CommandLine -match '\.dsh\\profiles\\([^"\\]+)') { $Matches[1] }
    } | Select-Object -Unique
  if ($hits.Count -eq 1) { return $hits[0] }
  if ($hits.Count -gt 1) { throw "发现多个 profile 宿主：$($hits -join ', ')；请用 -ProfileName 明确指定" }
  # 退回：只有一个 profile 目录在跑 webServer 时无法判断，默认 desktop
  Write-Warn2 '没找到 desktop 宿主进程，默认按 desktop 处理（可用 -ProfileName 覆盖）'
  return 'desktop'
}

if (-not $VerifyOnly) {
  $ProfileName = Resolve-LiveProfile
}
elseif (-not $ProfileName) {
  $ProfileName = Resolve-LiveProfile
}

$profileDir = Join-Path $home_ "profiles\$ProfileName"
if (-not (Test-Path $profileDir)) { throw "profile 目录不存在：$profileDir" }

$pkgJson  = Join-Path $profileDir 'package.json'
$patch    = Join-Path $profileDir 'cordis.patch.yml'
$lock     = Join-Path $profileDir 'pnpm-lock.yaml'
$verifyJs = Join-Path $PSScriptRoot '_verify.mjs'

Write-Step "目标 profile: $profileDir"
if (-not $Port) {
  # 取第一个在监听的 dsh 宿主端口（desktop 宿主用 --port 0，端口是随机的）
  $Port = (Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue |
    Where-Object { $_.LocalAddress -eq '127.0.0.1' -and $_.OwningProcess -eq (
        Get-CimInstance Win32_Process -Filter "Name = 'DeepSeek Harness.exe'" -ErrorAction SilentlyContinue |
          Where-Object { $_.CommandLine -match 'dsh-desktop-host' } | Select-Object -First 1 -ExpandProperty ProcessId) } |
    Sort-Object LocalPort | Select-Object -First 1 -ExpandProperty LocalPort)
  if (-not $Port) { $Port = '61372' }
}
Write-Host "  宿主端口: $Port"

# ---------------------------------------------------------------- 1. 备份
$backups = @{}
if (-not $VerifyOnly) {
  Write-Step '1. 备份 profile 文件'
  foreach ($f in @($pkgJson, $patch, $lock)) {
    if (Test-Path $f) {
      $bak = "$f.bak-polish-$stamp"
      Copy-Item $f $bak -Force
      $backups[$f] = $bak
      Write-Ok "backup $([IO.Path]::GetFileName($f)) -> $(Split-Path $bak -Leaf)"
    }
  }
}

function Restore-Backups {
  Write-Host "`n!!! 回滚 !!!" -ForegroundColor Red
  foreach ($k in $backups.Keys) {
    if (Test-Path $backups[$k]) {
      Copy-Item $backups[$k] $k -Force
      # 关键：Copy-Item 会带回旧 mtime，HMR watcher 会漏掉这次变更 → 手动 touch
      (Get-Item $k).LastWriteTime = Get-Date
      Write-Host "  restored $(Split-Path $k -Leaf)"
    }
  }
}

try {
  # ---------------------------------------------------------------- 2. pnpm add
  if (-not $SkipInstall -and -not $VerifyOnly) {
    Write-Step '2. 把本地包加进 profile 依赖（hoisted → 拷贝成普通目录）'
    $dep = Select-String -Path $pkgJson -Pattern "`"$([regex]::Escape($PackageName))`"\s*:" -Quiet
    if ($dep) {
      Write-Ok "$PackageName 已在 dependencies 里，跳过 pnpm add"
    }
    else {
      $spec = 'file:' + ($PluginDir -replace '\\', '/')
      & $Pnpm --dir $profileDir add $spec
      if ($LASTEXITCODE -ne 0) { throw "pnpm add 失败（exit $LASTEXITCODE）" }
      Write-Ok "pnpm add $spec"
    }
    $installed = Join-Path $profileDir "node_modules\$PackageName"
    if (-not (Test-Path (Join-Path $installed 'lib\client.js'))) {
      throw "安装后仍找不到 $installed\lib\client.js"
    }
    Write-Ok "node_modules\$PackageName\lib\client.js 就位"
  }

  # ---------------------------------------------------------------- 3. patch 层
  if (-not $VerifyOnly) {
    Write-Step '3. 在 profile 的 cordis.patch.yml 里确保有 insert 行（name 必须等于包名）'
    $text = Get-Content $patch -Raw
    $already = $text -match "(?m)^\s*-?\s*name:\s*$([regex]::Escape($PackageName))\s*$"
    if ($already) {
      Write-Ok "patch 里已有 $PackageName 行，跳过"
    }
    else {
      $block = @"

# --- $PackageName (install.ps1 $stamp) ---
- insert:
    - id: $RowId
      name: $PackageName
"@
      Add-Content -Path $patch -Value $block -Encoding utf8
      Write-Ok "已追加 insert 行（宿主会在 ~2-3 秒内热重组）"
    }
    Start-Sleep -Seconds 3
  }

  # ---------------------------------------------------------------- 4. 验证
  Write-Step '4. 验证：模块图是否含该行 + bundle 路由状态码（只读）'
  $ok = $false
  if (Test-Path $verifyJs) {
    $out = & node $verifyJs $PackageName $Port 2>&1
    $out | ForEach-Object { Write-Host "  $_" }
    $ok = (($out -join "`n") -match 'GRAPH_HIT.*true') -and (($out -join "`n") -match 'BUNDLE_STATUS\s+200')
  }
  else {
    Write-Warn2 "_verify.mjs 不在 $PSScriptRoot，跳过自动验证"
  }

  if ($ok) {
    Write-Host "`n热加载生效：宿主已把 $PackageName 发给浏览器（无需刷新、无需重启）。" -ForegroundColor Green
    Write-Host "UI 验证：composer 上方应出现 [data-prompt-polish] 容器。" -ForegroundColor Green
    Write-Host "回滚命令：pwsh -File `"$PSScriptRoot\uninstall.ps1`" -ProfileName $ProfileName" -ForegroundColor DarkGray
  }
  else {
    Write-Warn2 '图里暂时没有该行或 bundle 未 200。常见原因：'
    Write-Host '   - 半区声明缺失：package.json 的 dsh.client.platform 必须是 "web"，exports 必须有 "./client"'
    Write-Host '   - bundle 文件缺失：node_modules\<pkg>\lib\client.js 不存在（MissingClientBundleError）'
    Write-Host '   - HMR 未启用：该 profile 的 base 组合包 hmr 行被 disabled'
    Write-Host "   - 就绪后重跑：node `"$verifyJs`" $PackageName $Port"
    if (-not $VerifyOnly) { throw '验证未通过' }
  }
}
catch {
  if (-not $VerifyOnly) { Restore-Backups }
  Write-Host "`n失败：$($_.Exception.Message)" -ForegroundColor Red
  exit 1
}
