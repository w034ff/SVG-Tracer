# Records the TCP connections and UDP endpoints of svg-tracer.exe and every
# process it starts (its own msedgewebview2.exe instances), for the network
# check in docs/manual-test.md. Other apps also run msedgewebview2.exe, so the
# process tree is followed instead of filtering by process name.
#
# Start it before launching the app; it waits for svg-tracer.exe and stops
# when the app exits. Run: powershell -ExecutionPolicy Bypass -File watch-network.ps1
param(
  [string]$LogPath = (Join-Path (Get-Location) "network-log.txt"),
  [int]$TimeoutMinutes = 60
)

$seen = @{}
$started = $false
$deadline = (Get-Date).AddMinutes($TimeoutMinutes)
while ((Get-Date) -lt $deadline) {
  $procs = Get-CimInstance Win32_Process
  $root = $procs | Where-Object Name -eq "svg-tracer.exe"
  if (-not $root) {
    if ($started) { break }
    Start-Sleep -Seconds 1
    continue
  }
  if (-not $started) {
    $started = $true
    "started $(Get-Date -Format o) pid=$($root.ProcessId -join ',')" | Out-File $LogPath -Encoding utf8
    Write-Host "Recording to $LogPath"
  }

  $tree = @{}
  foreach ($r in $root) { $tree[[int]$r.ProcessId] = $r.Name }
  do {
    $added = $false
    foreach ($p in $procs) {
      if (-not $tree.ContainsKey([int]$p.ProcessId) -and $tree.ContainsKey([int]$p.ParentProcessId)) {
        $tree[[int]$p.ProcessId] = $p.Name
        $added = $true
      }
    }
  } while ($added)
  $ids = [int[]]$tree.Keys

  foreach ($c in (Get-NetTCPConnection -ErrorAction SilentlyContinue | Where-Object { $ids -contains $_.OwningProcess })) {
    $key = "TCP $($tree[[int]$c.OwningProcess]) pid=$($c.OwningProcess) $($c.LocalAddress):$($c.LocalPort) -> $($c.RemoteAddress):$($c.RemotePort) $($c.State)"
    if ($seen.ContainsKey($key)) { continue }
    $seen[$key] = $true
    "$(Get-Date -Format o) $key" | Out-File $LogPath -Append -Encoding utf8
    if ($c.State -eq "Established") {
      # The DNS cache maps the address back to the host name that was looked up.
      $names = (Get-DnsClientCache | Where-Object Data -eq $c.RemoteAddress | Select-Object -ExpandProperty Entry -Unique) -join ","
      "    host: $names" | Out-File $LogPath -Append -Encoding utf8
    }
  }
  foreach ($u in (Get-NetUDPEndpoint -ErrorAction SilentlyContinue | Where-Object { $ids -contains $_.OwningProcess })) {
    $key = "UDP $($tree[[int]$u.OwningProcess]) pid=$($u.OwningProcess) $($u.LocalAddress):$($u.LocalPort)"
    if ($seen.ContainsKey($key)) { continue }
    $seen[$key] = $true
    "$(Get-Date -Format o) $key" | Out-File $LogPath -Append -Encoding utf8
  }
  Start-Sleep -Milliseconds 500
}
"ended $(Get-Date -Format o) entries=$($seen.Count)" | Out-File $LogPath -Append -Encoding utf8
