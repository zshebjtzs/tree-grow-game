$ErrorActionPreference = 'Stop'
$Root = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot 'dist'))
$Index = Join-Path $Root 'index.html'
$Port = 4173
if (-not (Test-Path -LiteralPath $Index -PathType Leaf)) {
    Write-Error "找不到 dist/index.html。请确认离线发行包已完整解压。"
    exit 1
}
$Listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, $Port)
try { $Listener.Start() } catch {
    Write-Error "无法监听 127.0.0.1:$Port。请关闭占用该端口的程序后重试。"
    exit 1
}
$BaseUrl = "http://127.0.0.1:$Port/"
Write-Host "游戏服务已启动：$BaseUrl" -ForegroundColor Green
Write-Host "关闭此窗口即可停止服务。"
Start-Process $BaseUrl
$Mime = @{
    '.html'='text/html; charset=utf-8'; '.js'='text/javascript; charset=utf-8'
    '.mjs'='text/javascript; charset=utf-8'; '.css'='text/css; charset=utf-8'
    '.json'='application/json; charset=utf-8'; '.svg'='image/svg+xml'
    '.png'='image/png'; '.jpg'='image/jpeg'; '.jpeg'='image/jpeg'
    '.ico'='image/x-icon'; '.woff'='font/woff'; '.woff2'='font/woff2'
}
try {
    while ($true) {
        $Client = $Listener.AcceptTcpClient()
        $Reader = $null
        try {
            $Stream = $Client.GetStream()
            $Reader = [System.IO.StreamReader]::new($Stream, [System.Text.Encoding]::ASCII, $false, 1024, $true)
            $RequestLine = $Reader.ReadLine()
            if ([string]::IsNullOrWhiteSpace($RequestLine)) { continue }
            $Parts = $RequestLine.Split(' ')
            $Method = $Parts[0]
            $Target = $Parts[1]
            while (-not [string]::IsNullOrEmpty($Reader.ReadLine())) { }
            $Status = '200 OK'
            $Body = [byte[]]@()
            $ContentType = 'application/octet-stream'
            if ($Method -ne 'GET' -and $Method -ne 'HEAD') {
                $Status = '405 Method Not Allowed'
            } else {
                try {
                    $Uri = [System.Uri]::new("http://127.0.0.1:$Port$Target")
                    $Relative = [System.Uri]::UnescapeDataString($Uri.AbsolutePath.TrimStart('/')).Replace('/', [System.IO.Path]::DirectorySeparatorChar)
                    if ([string]::IsNullOrEmpty($Relative)) { $Relative = 'index.html' }
                    $FilePath = [System.IO.Path]::GetFullPath((Join-Path $Root $Relative))
                    $Prefix = $Root.TrimEnd([System.IO.Path]::DirectorySeparatorChar) + [System.IO.Path]::DirectorySeparatorChar
                    if (-not ($FilePath.StartsWith($Prefix, [System.StringComparison]::OrdinalIgnoreCase) -or $FilePath -eq $Index)) { throw 'Invalid path' }
                    if (Test-Path -LiteralPath $FilePath -PathType Container) { $FilePath = Join-Path $FilePath 'index.html' }
                    if (-not (Test-Path -LiteralPath $FilePath -PathType Leaf)) {
                        $Status = '404 Not Found'
                    } else {
                        $Extension = [System.IO.Path]::GetExtension($FilePath).ToLowerInvariant()
                        if ($Mime.ContainsKey($Extension)) { $ContentType = $Mime[$Extension] }
                        $Body = [System.IO.File]::ReadAllBytes($FilePath)
                    }
                } catch { $Status = '400 Bad Request' }
            }
            $CRLF = [string][char]13 + [string][char]10
            $Header = "HTTP/1.1 $Status" + $CRLF + "Content-Type: $ContentType" + $CRLF + "Content-Length: $($Body.Length)" + $CRLF + "Connection: close" + $CRLF + "X-Content-Type-Options: nosniff" + $CRLF + $CRLF
            $HeaderBytes = [System.Text.Encoding]::ASCII.GetBytes($Header)
            $Stream.Write($HeaderBytes, 0, $HeaderBytes.Length)
            if ($Method -eq 'GET' -and $Body.Length -gt 0) { $Stream.Write($Body, 0, $Body.Length) }
            $Stream.Flush()
        } catch { Write-Warning $_ } finally {
            if ($Reader) { $Reader.Dispose() }
            $Client.Close()
        }
    }
} finally { $Listener.Stop() }
