# Dev-only helper for tools/build.html: POST /save?path=<relative> writes files under -Root; GET /proxy?url= reads nuts-agency.ru (used once to import content).
param([string]$Root, [int]$Port = 5174)
$l = New-Object System.Net.HttpListener
$l.Prefixes.Add("http://localhost:$Port/")
$l.Start()
Write-Host "save-server on $Port -> $Root"
$rootFull = [IO.Path]::GetFullPath($Root)
while ($l.IsListening) {
  $ctx = $l.GetContext(); $req = $ctx.Request; $res = $ctx.Response
  $res.Headers.Add('Access-Control-Allow-Origin', '*')
  $res.Headers.Add('Access-Control-Allow-Methods', 'POST, OPTIONS')
  $res.Headers.Add('Access-Control-Allow-Headers', 'Content-Type')
  $res.Headers.Add('Access-Control-Allow-Private-Network', 'true')
  if ($req.HttpMethod -eq 'OPTIONS') { $res.StatusCode = 204; $res.Close(); continue }
  if ($req.HttpMethod -eq 'GET' -and $req.Url.AbsolutePath -eq '/proxy') {
    # read-only proxy to the old site, so a localhost page can parse it without CORS
    try {
      $u = [Uri]$req.QueryString['url']
      if ($u.Host -ne 'nuts-agency.ru') { throw 'host not allowed' }
      $wc = New-Object Net.WebClient; $wc.Encoding = [Text.Encoding]::UTF8
      $msg = [Text.Encoding]::UTF8.GetBytes($wc.DownloadString($u))
      $res.ContentType = 'text/html; charset=utf-8'
    } catch { $res.StatusCode = 502; $msg = [Text.Encoding]::UTF8.GetBytes("$_") }
    $res.OutputStream.Write($msg, 0, $msg.Length); $res.Close(); continue
  }
  try {
    $rel = $req.QueryString['path']
    $target = [IO.Path]::GetFullPath((Join-Path $rootFull $rel))
    if (-not $target.StartsWith($rootFull)) { throw "outside root" }
    New-Item -ItemType Directory -Force -Path (Split-Path $target) | Out-Null
    $ms = New-Object IO.MemoryStream; $req.InputStream.CopyTo($ms)
    [IO.File]::WriteAllBytes($target, $ms.ToArray())
    $msg = [Text.Encoding]::UTF8.GetBytes("ok $rel")
  } catch { $res.StatusCode = 500; $msg = [Text.Encoding]::UTF8.GetBytes("$_") }
  $res.OutputStream.Write($msg, 0, $msg.Length); $res.Close()
}
