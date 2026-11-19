' Windows 无黑框静默运行小红书回复机器人
Set WshShell = CreateObject("WScript.Shell")
WshShell.CurrentDirectory = "C:\Users\dy776\.gemini\antigravity\scratch\movie-site"
WshShell.Run "node scripts/xhs-auto-replier.js", 0, True
