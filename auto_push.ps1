<#
  auto_push.ps1 — 乌合bingo 自动上传 GitHub
  用法:
    powershell -ExecutionPolicy Bypass -File auto_push.ps1                # 普通推送
    powershell -ExecutionPolicy Bypass -File auto_push.ps1 -Msg "更新"     # 自定义提交信息
    powershell -ExecutionPolicy Bypass -File auto_push.ps1 -Force         # 强制推送(首次同步用)
  说明:
    - 自动 add 全部改动并提交(带时间戳), 然后 push origin master
    - 远端领先导致推送失败时, 提示使用 -Force(会覆盖远端, 仅首次/确定时用)
    - 日志写入 auto_push.log
#>
param(
    [string]$Msg = "",
    [switch]$Force
)

$ErrorActionPreference = "Continue"
$Repo = "D:\wuhebingo"
$Log = Join-Path $Repo "auto_push.log"
$Time = Get-Date -Format "yyyy-MM-dd HH:mm:ss"

function Log($s) {
    Write-Host $s
    Add-Content -Path $Log -Value "[$Time] $s" -Encoding UTF8
}

Set-Location $Repo

# 1. 移除已跟踪的隐私/依赖文件（.gitignore 已排除，这里清历史缓存）
git rm --cached --ignore-unmatch "zlwuhe/subscriptions.json" "zlwuhe/pool.json" "node_modules" 2>$null | Out-Null

# 2. 提交信息
if (-not $Msg) { $Msg = "自动提交 $Time" }

# 3. 暂存 + 提交
git add -A
$staged = git diff --cached --name-only | Measure-Object -Line | Select-Object -ExpandProperty Lines
if ($staged -eq 0) {
    Log "无改动, 跳过提交"
} else {
    git commit -m $Msg 2>&1 | Out-Null
    Log "已提交 $staged 个文件: $Msg"
}

# 4. 拉取远端（合并，不强制时）
git fetch origin 2>&1 | Out-Null

# 5. 推送
if ($Force) {
    git push --force origin master 2>&1 | Out-Null
    $rc = $LASTEXITCODE
} else {
    git pull --rebase origin master 2>&1 | Out-Null
    if ($LASTEXITCODE -ne 0) {
        Log "❌ pull/rebase 冲突或失败——需要手动处理, 或确认覆盖远端后加 -Force"
        exit 1
    }
    git push origin master 2>&1 | Out-Null
    $rc = $LASTEXITCODE
}

if ($rc -eq 0) {
    Log "✅ 推送成功 origin/master ($Time)"
} else {
    Log "❌ 推送失败 (exit=$rc)——远端领先时请确认后加 -Force 覆盖"
}
