<#
  auto_push.ps1 — 乌合bingo 自动上传 GitHub（安全版 v2）
  用法:
    powershell -ExecutionPolicy Bypass -File auto_push.ps1                # 普通推送
    powershell -ExecutionPolicy Bypass -File auto_push.ps1 -Msg "更新"     # 自定义提交信息
    powershell -ExecutionPolicy Bypass -File auto_push.ps1 -Force         # 强制推送(覆盖远端)
  安全说明:
    - 只 fetch（不动工作区）；远端领先时【拒绝推送】并提示，绝不自动 pull/rebase
      （此前 git pull --rebase 失败曾导致工作区被重置，数据险些丢失）
    - -Force 直接 force push 覆盖远端（确认远端是旧版时才用）
    - remote 已切换为 SSH(ssh.github.com:443)，github.com 被墙时也能推送
    - 推送成功后提醒: 帽子云需手动「重新部署」网站才会更新
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

# 4. 只 fetch（不合并、不动工作区）
git fetch origin 2>&1 | Out-Null

# 5. 检查远端领先情况
$behind = git rev-list --count "HEAD..origin/master" 2>$null
if (-not $Force) {
    if ($behind -and $behind -gt 0) {
        Log "❌ 远端 origin/master 领先本地 $behind 个提交——拒绝推送(防数据丢失)。"
        Log "   确认远端为旧版可加 -Force 覆盖；或手动处理远端后重试。"
        exit 1
    }
}

# 6. 推送（remote 为 SSH: ssh://git@ssh.github.com:443/...）
if ($Force) {
    git push --force origin master 2>&1 | Out-Null
} else {
    git push origin master 2>&1 | Out-Null
}
$rc = $LASTEXITCODE

if ($rc -eq 0) {
    Log "✅ 推送成功 origin/master ($Time)"
    Log "   💡 帽子云不会自动部署——若网站未更新, 请到帽子云后台点「重新部署」"
} else {
    Log "❌ 推送失败 (exit=$rc)——网络问题可重试；SSH 通道已配置(ssh.github.com:443)更稳。"
}
