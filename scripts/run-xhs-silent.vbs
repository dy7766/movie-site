Set WshShell = CreateObject("WScript.Shell")
WshShell.CurrentDirectory = "C:\Users\dy776\.gemini\antigravity\scratch\movie-site"
WshShell.Run "node scripts/xhs-batch-scheduler.js", 0, True
