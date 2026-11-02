param(
    [ValidateSet("status", "start", "stop", "enable", "delete")]
    [string]$Action = "status"
)

$TaskName = "XHS_Hourly_Movie_Publisher"

switch ($Action) {
    "status" {
        Write-Host "🔍 查询小红书每小时定时发布任务状态..." -ForegroundColor Cyan
        schtasks /Query /TN $TaskName /FO LIST
    }
    "start" {
        Write-Host "🚀 立即主动触发一次任务执行..." -ForegroundColor Green
        schtasks /Run /TN $TaskName
    }
    "stop" {
        Write-Host "⏸️ 暂停每小时自动任务..." -ForegroundColor Yellow
        schtasks /Change /TN $TaskName /DISABLE
    }
    "enable" {
        Write-Host "▶️ 恢复每小时自动任务..." -ForegroundColor Green
        schtasks /Change /TN $TaskName /ENABLE
    }
    "delete" {
        Write-Host "🗑️ 彻底删除定时任务..." -ForegroundColor Red
        schtasks /Delete /TN $TaskName /F
    }
}
