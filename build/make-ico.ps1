Add-Type -AssemblyName System.Drawing

$sizes = @(16, 32, 48, 64, 128, 256)
$pngPath = Join-Path $PSScriptRoot "icon.png"
$icoPath = Join-Path $PSScriptRoot "icon.ico"

$src = [System.Drawing.Image]::FromFile($pngPath)
$ms = New-Object System.IO.MemoryStream
$bw = New-Object System.IO.BinaryWriter($ms)

# ICO header
$bw.Write([int16]0)
$bw.Write([int16]1)
$bw.Write([int16]$sizes.Count)

# Prepare image data
$imageData = @()
foreach ($size in $sizes) {
    $bmp = New-Object System.Drawing.Bitmap($size, $size)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
    $g.DrawImage($src, 0, 0, $size, $size)
    $g.Dispose()
    $pngMs = New-Object System.IO.MemoryStream
    $bmp.Save($pngMs, [System.Drawing.Imaging.ImageFormat]::Png)
    $imageData += ,$pngMs.ToArray()
    $pngMs.Dispose()
    $bmp.Dispose()
}

# Calculate offsets
$offset = 6 + $sizes.Count * 16
for ($i = 0; $i -lt $sizes.Count; $i++) {
    $size = $sizes[$i]
    $data = $imageData[$i]
    $w = if ($size -ge 256) { 0 } else { $size }
    $h = if ($size -ge 256) { 0 } else { $size }
    $bw.Write([byte]$w)
    $bw.Write([byte]$h)
    $bw.Write([byte]0)
    $bw.Write([byte]0)
    $bw.Write([int16]1)
    $bw.Write([int16]32)
    $bw.Write([int32]$data.Length)
    $bw.Write([int32]$offset)
    $offset += $data.Length
}

foreach ($data in $imageData) {
    $bw.Write($data)
}

[System.IO.File]::WriteAllBytes($icoPath, $ms.ToArray())
$bw.Dispose()
$ms.Dispose()
$src.Dispose()

$file = Get-Item $icoPath
Write-Host "Created $($file.Name) ($([math]::Round($file.Length / 1KB, 1)) KB) with sizes: $($sizes -join ', ')"
