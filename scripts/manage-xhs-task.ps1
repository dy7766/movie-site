param(
    [ValidateSet("status", "start", "stop", "enable", "delete", "install", "install-reply", "status-reply", "start-reply", "stop-reply")]
    [string]$Action = "status"
)

$TaskName = "XHS_Hourly_Movie_Publisher"
$VbsPath = "C:\Users\dy776\.gemini\antigravity\scratch\movie-site\scripts\run-xhs-silent.vbs"

$ReplyTaskName = "XHS_Comment_Replier_Bot"
$ReplyVbsPath = "C:\Users\dy776\.gemini\antigravity\scratch\movie-site\scripts\run-xhs-reply-silent.vbs"

switch ($Action) {
    "install" {
        Write-Host "📦 注册小红书每小时定时发布计划任务..." -ForegroundColor Green
        schtasks /Create /TN $TaskName /TR "wscript.exe $VbsPath" /SC HOURLY /MO 1 /F
    }
    "install-reply" {
        Write-Host "📦 注册小红书评论区扣1私信回复机器人任务 (每 20 分钟轮询一次)..." -ForegroundColor Green
        schtasks /Create /TN $ReplyTaskName /TR "wscript.exe $ReplyVbsPath" /SC MINUTE /MO 20 /F
    }
    "status" {
        Write-Host "🔍 查询小红书每小时定时发布任务状态..." -ForegroundColor Cyan
        schtasks /Query /TN $TaskName /FO LIST
        Write-Host "`n🔍 查询评论区私信机器人任务状态..." -ForegroundColor Cyan
        schtasks /Query /TN $ReplyTaskName /FO LIST 2>$null
    }
    "status-reply" {
        Write-Host "🔍 查询评论区私信机器人任务状态..." -ForegroundColor Cyan
        schtasks /Query /TN $ReplyTaskName /FO LIST
    }
    "start" {
        Write-Host "🚀 立即主动触发一次发布任务执行..." -ForegroundColor Green
        schtasks /Run /TN $TaskName
    }
    "start-reply" {
        Write-Host "🚀 立即主动触发一次评论区回复任务..." -ForegroundColor Green
        schtasks /Run /TN $ReplyTaskName
    }
    "stop" {
        Write-Host "⏸️ 暂停每小时自动发布任务..." -ForegroundColor Yellow
        schtasks /Change /TN $TaskName /DISABLE
    }
    "stop-reply" {
        Write-Host "⏸️ 暂停评论区私信机器人任务..." -ForegroundColor Yellow
        schtasks /Change /TN $ReplyTaskName /DISABLE
    }
    "enable" {
        Write-Host "▶️ 恢复每小时自动发布任务..." -ForegroundColor Green
        schtasks /Change /TN $TaskName /ENABLE
    }
    "delete" {
        Write-Host "🗑️ 彻底删除发布与回复定时任务..." -ForegroundColor Red
        schtasks /Delete /TN $TaskName /F
        schtasks /Delete /TN $ReplyTaskName /F 2>$null
    }
}
