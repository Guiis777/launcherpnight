# Gera/atualiza o manifest.json com os hashes MD5 dos arquivos de UI do launcher
# Execute após editar qualquer arquivo em server/u/launcher/

$launcherDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$launcherDir = Join-Path $launcherDir "u\launcher"

$uiFiles = @("auth.js","config.js","index.html","launcher-updater.js","news-config.json","news.js","renderer.js","styles.css","updater.js")
$entries = @()

foreach ($f in $uiFiles) {
    $filePath = Join-Path $launcherDir $f
    if (Test-Path $filePath) {
        $hash = (Get-FileHash $filePath -Algorithm MD5).Hash.ToLower()
        $entries += @{ name = $f; md5 = $hash }
    } else {
        Write-Warning "Arquivo não encontrado: $f"
    }
}

# main.js fica na raiz do launcher (root: true)
$mainPath = Join-Path $launcherDir "main.js"
if (Test-Path $mainPath) {
    $hash = (Get-FileHash $mainPath -Algorithm MD5).Hash.ToLower()
    $entries += @{ name = "main.js"; md5 = $hash; root = $true }
}

$manifest = @{
    files = $entries
    version = (Get-Date -Format "yyyy-MM-ddTHH:mm:ss.fffZ")
}

$json = $manifest | ConvertTo-Json -Depth 3
Set-Content (Join-Path $launcherDir "manifest.json") $json -Encoding UTF8

Write-Host "manifest.json atualizado com $($entries.Count) arquivos"
Write-Host "Versão: $($manifest.version)"
