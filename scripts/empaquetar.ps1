$ErrorActionPreference = 'Stop'
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$jarPath = Join-Path $projectRoot 'target/bikestore-async-1.0.jar'
if (!(Test-Path -LiteralPath $jarPath)) { throw 'Compila primero: mvn package -DskipTests' }
$stagingBase = [IO.Path]::GetFullPath((Join-Path $projectRoot 'target/distribucion'))
$stagingPath = [IO.Path]::GetFullPath((Join-Path $stagingBase 'BikeStore-Async-v1.0'))
$distPath = Join-Path $projectRoot 'dist'
$zipPath = Join-Path $distPath 'BikeStore-Async-v1.0.zip'
# Solo se limpia esta carpeta generada; nunca el proyecto ni sus datos.
if (!$stagingPath.StartsWith($stagingBase + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
    throw 'La carpeta temporal queda fuera del destino esperado'
}
if (Test-Path -LiteralPath $stagingPath) { Remove-Item -LiteralPath $stagingPath -Recurse -Force }
New-Item -ItemType Directory -Path $stagingPath,$distPath -Force | Out-Null
try {
    foreach ($folder in @('src','scripts')) {
        foreach ($file in (Get-ChildItem -LiteralPath (Join-Path $projectRoot $folder) -Recurse -File)) {
            if ($file.Name.StartsWith('~$') -or $file.Extension -eq '.tmp') { continue }
            $relativePath = $file.FullName.Substring($projectRoot.Length + 1)
            $destination = Join-Path $stagingPath $relativePath
            New-Item -ItemType Directory -Path (Split-Path $destination -Parent) -Force | Out-Null
            Copy-Item -LiteralPath $file.FullName -Destination $destination
        }
    }
    Copy-Item -LiteralPath $jarPath -Destination $stagingPath
    foreach ($file in @('pom.xml','README.md','iniciar.bat','.gitignore')) {
        Copy-Item -LiteralPath (Join-Path $projectRoot $file) -Destination $stagingPath
    }
    Compress-Archive -LiteralPath $stagingPath -DestinationPath $zipPath -Force
    Write-Output "Entrega generada: $zipPath"
} finally {
    if (Test-Path -LiteralPath $stagingPath) { Remove-Item -LiteralPath $stagingPath -Recurse -Force }
}
