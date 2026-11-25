# Загрузка установщика NetLoom с проверкой SHA-256.
# Вызывается установщиком NetAdmin Desk, только если пользователь отметил «Также установить браузер NetLoom».
# Файл сохраняется лишь тогда, когда его контрольная сумма совпала со значением, зашитым в установщик при сборке.
#
# Коды выхода: 0 — скачан и проверен; 2 — не удалось скачать; 3 — контрольная сумма не совпала (файл удалён);
#              4 — неверные параметры.
param(
  [Parameter(Mandatory = $true)][string]$Url,
  [Parameter(Mandatory = $true)][string]$Sha256,
  [Parameter(Mandatory = $true)][string]$Out,
  [long]$ExpectedBytes = 0
)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

function Remove-Download {
  if (Test-Path -LiteralPath $Out) { Remove-Item -LiteralPath $Out -Force -ErrorAction SilentlyContinue }
}

if ($Url -notmatch '^https://') { Write-Output 'Адрес загрузки должен начинаться с https://'; exit 4 }
if ($Sha256 -notmatch '^[0-9a-fA-F]{64}$') { Write-Output 'Неверная контрольная сумма в установщике'; exit 4 }

# GitHub принимает только TLS 1.2 и новее; в Windows PowerShell 5.1 его иногда нужно включить явно
try {
  [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
} catch { }

# Защита от бесконечной загрузки: не больше двойного ожидаемого размера
$limit = if ($ExpectedBytes -gt 0) { $ExpectedBytes * 2 } else { 1GB }

Remove-Download
$resp = $null; $in = $null; $fs = $null
try {
  $req = [Net.WebRequest]::Create($Url)
  $req.UserAgent = 'NetAdminDesk-Setup'
  $req.Timeout = 30000
  $req.ReadWriteTimeout = 60000
  # Прокси берётся из настроек Windows, вход на прокси — под текущим пользователем
  if ($req.Proxy) { $req.Proxy.Credentials = [Net.CredentialCache]::DefaultCredentials }
  $resp = $req.GetResponse()
  $total = $resp.ContentLength
  $in = $resp.GetResponseStream()
  $fs = [IO.File]::Create($Out)
  $buf = New-Object byte[] 262144
  $done = 0L
  $nextPct = 10
  while (($n = $in.Read($buf, 0, $buf.Length)) -gt 0) {
    $fs.Write($buf, 0, $n)
    $done += $n
    if ($done -gt $limit) { throw 'файл намного больше ожидаемого' }
    if ($total -gt 0) {
      $pct = [math]::Floor(100 * $done / $total)
      if ($pct -ge $nextPct) {
        Write-Output ('  загружено {0} % ({1} из {2} МБ)' -f $pct, [math]::Round($done / 1MB), [math]::Round($total / 1MB))
        $nextPct = $pct - ($pct % 10) + 10
      }
    }
  }
  $fs.Close(); $fs = $null
} catch {
  if ($fs) { $fs.Close() }
  if ($in) { $in.Close() }
  if ($resp) { $resp.Close() }
  Remove-Download
  Write-Output ('Не удалось скачать: ' + $_.Exception.Message)
  exit 2
}
$in.Close()
$resp.Close()

$actual = (Get-FileHash -LiteralPath $Out -Algorithm SHA256).Hash
if ($actual -ne $Sha256) {
  Remove-Download
  Write-Output ('Контрольная сумма не совпала: ожидалась {0}, получена {1}' -f $Sha256.ToLowerInvariant(), $actual.ToLowerInvariant())
  exit 3
}
Write-Output 'Контрольная сумма SHA-256 совпадает.'
exit 0
