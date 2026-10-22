# Scan audio files in songs folder and generate songs.json
$songsDir = Join-Path $PSScriptRoot "songs"
if (-not (Test-Path $songsDir)) {
    Write-Host "Creating songs directory..."
    New-Item -ItemType Directory -Path $songsDir -Force | Out-Null
}

$supportedExtensions = @('.mp3', '.wav', '.ogg', '.flac', '.m4a', '.aac')
$audioFiles = Get-ChildItem -Path $songsDir -File | Where-Object { $supportedExtensions -contains $_.Extension.ToLower() }

$songList = @()
$id = 1

foreach ($file in $audioFiles) {
    $baseName = [System.IO.Path]::GetFileNameWithoutExtension($file.Name)
    $title = $baseName
    $artist = "Offline Artist"
    $album = "Local Music"

    if ($baseName -match "^(.+?)\s*-\s*(.+)$") {
        $artist = $matches[1].Trim()
        $title = $matches[2].Trim()
    }

    $songObj = [PSCustomObject]@{
        id = "offline_$id"
        title = $title
        artist = $artist
        album = $album
        filename = $file.Name
        url = "songs/" + $file.Name
        format = $file.Extension.TrimStart('.').ToLower()
        size = $file.Length
    }
    $songList += $songObj
    $id++
}

$jsonPath = Join-Path $songsDir "songs.json"
$songList | ConvertTo-Json -Depth 3 | Set-Content -Path $jsonPath -Encoding utf8
Write-Host "Successfully indexed $($songList.Count) songs to $jsonPath"
