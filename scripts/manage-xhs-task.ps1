param(
    [ValidateSet("status", "start", "stop", "enable", "delete", "install")]
    [string]$Action = "status"
)

$TaskName = "XHS_Hourly_Movie_Publisher"
$VbsPath = "C:\Users\dy776\.gemini\antigravity\scratch\movie-site\scripts\run-xhs-silent.vbs"

switch ($Action) {
    "install" {
        Write-Host "📦 注册小红书每小时定时发布计划任务..." -ForegroundColor Green
        schtasks /Create /TN $TaskName /TR "wscript.exe $VbsPath" /SC HOURLY /MO 1 /F
    }
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
