Set WshShell = CreateObject("WScript.Shell")
WshShell.CurrentDirectory = "C:\Users\dy776\.gemini\antigravity\scratch\movie-site"
Set WshEnv = WshShell.Environment("PROCESS")
WshEnv("HTTP_PROXY") = "http://127.0.0.1:7897"
WshEnv("HTTPS_PROXY") = "http://127.0.0.1:7897"
WshShell.Run "node scripts/xhs-batch-scheduler.js", 0, True
