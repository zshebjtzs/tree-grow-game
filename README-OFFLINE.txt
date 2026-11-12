生长树：图论 — Windows 离线版

启动方式
1. 将整个压缩包解压到本地文件夹。
2. 确保 Windows PowerShell 可用（Windows 10/11 通常已预装）。
3. 运行 Start-Game.ps1；如执行策略阻止脚本，可在 PowerShell 中执行：
   powershell -ExecutionPolicy Bypass -File .\Start-Game.ps1
4. 浏览器将自动打开 http://127.0.0.1:4173/。
5. 关闭 PowerShell 窗口即可停止本地服务。

说明
- 游戏资源全部位于 dist 目录，启动后不需要互联网连接。
- 不需要安装 Node.js、npm、Python 或其他运行时。
- 不要直接双击 dist/index.html；浏览器会限制 file:// 下的 ES Modules 和 Web Worker。
- 默认使用本机回环地址，不对局域网开放。
