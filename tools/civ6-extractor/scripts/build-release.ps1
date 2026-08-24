[CmdletBinding()]
param(
    [string]$DotnetPath = $env:TESSERA_DOTNET_PATH,
    [string]$OutputRoot
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$releaseVersion = '0.1.0-preview.1'
$artifactName = "tessera-civ6-extractor-v$releaseVersion-windows-x64.zip"
$entrypoint = 'TesseraCiv6Extractor.exe'
$fixedTimestamp = [DateTimeOffset]::new(1980, 1, 1, 0, 0, 0, [TimeSpan]::Zero)

function Invoke-CheckedCommand {
    param(
        [Parameter(Mandatory)] [string]$FilePath,
        [Parameter(Mandatory)] [string[]]$ArgumentList
    )

    & $FilePath @ArgumentList
    if ($LASTEXITCODE -ne 0) {
        throw "命令失败（exit $LASTEXITCODE）：$FilePath $($ArgumentList -join ' ')"
    }
}

function Get-RelativeArchivePath {
    param(
        [Parameter(Mandatory)] [string]$Root,
        [Parameter(Mandatory)] [string]$Path
    )

    return [IO.Path]::GetRelativePath($Root, $Path).Replace('\', '/')
}

function Write-Utf8File {
    param(
        [Parameter(Mandatory)] [string]$Path,
        [Parameter(Mandatory)] [string]$Value
    )

    [IO.File]::WriteAllText($Path, $Value, [Text.UTF8Encoding]::new($false))
}

function Get-OrderedPayloadFiles {
    param([Parameter(Mandatory)] [string]$Root)

    $filesByPath = [Collections.Generic.Dictionary[string, IO.FileInfo]]::new([StringComparer]::Ordinal)
    $foldedPaths = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
    foreach ($file in Get-ChildItem -LiteralPath $Root -Recurse -File) {
        $relativePath = Get-RelativeArchivePath -Root $Root -Path $file.FullName
        if (-not $filesByPath.TryAdd($relativePath, $file) -or -not $foldedPaths.Add($relativePath)) {
            throw "发布目录包含重复或大小写冲突路径：$relativePath"
        }
    }
    $paths = [string[]]$filesByPath.Keys
    [Array]::Sort($paths, [StringComparer]::Ordinal)
    foreach ($relativePath in $paths) {
        [PSCustomObject]@{
            Path = $relativePath
            File = $filesByPath[$relativePath]
        }
    }
}

function New-StableZip {
    param(
        [Parameter(Mandatory)] [string]$SourceDirectory,
        [Parameter(Mandatory)] [string]$ArchivePath
    )

    Add-Type -AssemblyName System.IO.Compression
    $stream = [IO.FileStream]::new(
        $ArchivePath,
        [IO.FileMode]::CreateNew,
        [IO.FileAccess]::ReadWrite,
        [IO.FileShare]::None)
    try {
        $archive = [IO.Compression.ZipArchive]::new(
            $stream,
            [IO.Compression.ZipArchiveMode]::Create,
            $false,
            [Text.UTF8Encoding]::new($false, $true))
        try {
            foreach ($item in Get-OrderedPayloadFiles -Root $SourceDirectory) {
                $relativePath = $item.Path
                $file = $item.File
                if ($relativePath.StartsWith('/') -or $relativePath.Contains('\') -or
                    $relativePath.Split('/') -contains '..') {
                    throw "发布文件路径不规范：$relativePath"
                }
                $entry = $archive.CreateEntry($relativePath, [IO.Compression.CompressionLevel]::Optimal)
                $entry.LastWriteTime = $fixedTimestamp
                $input = [IO.File]::OpenRead($file.FullName)
                $output = $entry.Open()
                try {
                    $input.CopyTo($output)
                }
                finally {
                    $output.Dispose()
                    $input.Dispose()
                }
            }
        }
        finally {
            $archive.Dispose()
        }
    }
    finally {
        $stream.Dispose()
    }
}

function Test-ReleasePayload {
    param(
        [Parameter(Mandatory)] [string]$PayloadDirectory,
        [Parameter(Mandatory)] [string]$RepositoryRoot,
        [Parameter(Mandatory)] [string]$DotnetRoot
    )

    $required = @(
        $entrypoint,
        'TesseraCiv6Extractor.dll',
        'Tessera.Civ6.Extractor.Core.dll',
        'coreclr.dll',
        'hostfxr.dll',
        'extractor-release-manifest.json',
        '快速开始.txt',
        'SOURCE-AND-LICENSE.txt',
        'DOTNET-LICENSE.txt',
        'DOTNET-THIRD-PARTY-NOTICES.txt'
    )
    foreach ($name in $required) {
        if (-not (Test-Path -LiteralPath (Join-Path $PayloadDirectory $name) -PathType Leaf)) {
            throw "发布物缺少必需文件：$name"
        }
    }

    $forbiddenExtensions = @('.pdb', '.cs', '.csproj', '.sln', '.slnx', '.artdef', '.blp', '.civbig')
    $files = Get-ChildItem -LiteralPath $PayloadDirectory -Recurse -File
    foreach ($file in $files) {
        if ($forbiddenExtensions -contains $file.Extension.ToLowerInvariant() -or
            $file.Name.EndsWith('.tessera-module.zip', [StringComparison]::OrdinalIgnoreCase) -or
            $file.Name.EndsWith('.tessera-preset.zip', [StringComparison]::OrdinalIgnoreCase) -or
            $file.Name.Contains('Tessera.Civ6.Extractor.Cli', [StringComparison]::OrdinalIgnoreCase)) {
            throw "发布物包含禁止文件：$($file.Name)"
        }
    }

    $manifestPath = Join-Path $PayloadDirectory 'extractor-release-manifest.json'
    $manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
    if ($manifest.extractorId -ne 'tessera.civ6-extractor' -or
        $manifest.version -ne $releaseVersion -or
        $manifest.os -ne 'windows' -or
        $manifest.arch -ne 'x64' -or
        $manifest.minOsBuild -ne 26100 -or
        $manifest.entrypoint -ne $entrypoint -or
        $manifest.outputModuleId -ne 'tessera.civ6' -or
        $manifest.outputModuleVersion -ne '1.0.0' -or
        -not $manifest.publish.selfContained -or
        $manifest.publish.singleFile -or
        $manifest.publish.trimmed) {
        throw '发布 manifest 与冻结契约不一致。'
    }

    $actualPaths = [string[]]@(Get-OrderedPayloadFiles -Root $PayloadDirectory | ForEach-Object { $_.Path })
    $declaredPaths = [string[]]@($manifest.payloadFiles | ForEach-Object { $_.path })
    [Array]::Sort($declaredPaths, [StringComparer]::Ordinal)
    $expectedPaths = [string[]]@($declaredPaths + 'extractor-release-manifest.json')
    [Array]::Sort($expectedPaths, [StringComparer]::Ordinal)
    if ([string]::Join("`n", $actualPaths) -ne [string]::Join("`n", $expectedPaths)) {
        throw '发布 manifest 的文件白名单与实际载荷不一致。'
    }
    foreach ($declared in $manifest.payloadFiles) {
        $path = Join-Path $PayloadDirectory $declared.path.Replace('/', [IO.Path]::DirectorySeparatorChar)
        if ((Get-Item -LiteralPath $path).Length -ne $declared.bytes) {
            throw "发布 manifest 的文件字节数不匹配：$($declared.path)"
        }
    }

    $safeTextFiles = @(
        'extractor-release-manifest.json',
        '快速开始.txt',
        'SOURCE-AND-LICENSE.txt'
    )
    foreach ($relativePath in $safeTextFiles) {
        $text = Get-Content -LiteralPath (Join-Path $PayloadDirectory $relativePath) -Raw
        if ($text.Contains($RepositoryRoot, [StringComparison]::OrdinalIgnoreCase) -or
            $text.Contains($DotnetRoot, [StringComparison]::OrdinalIgnoreCase) -or
            $text -match '(?i)(?:[a-z]:[\\/]|\\\\)[^\r\n"]*(?:Sid Meier''s Civilization VI|SteamLibrary|steamapps[\\/]common)' -or
            $text -match '-----BEGIN [A-Z ]*PRIVATE KEY-----|github_pat_|gh[pousr]_[A-Za-z0-9]+|Authorization:\s*Bearer\s+\S+|password\s*[:=]') {
            throw "发布文本包含绝对路径或疑似秘密：$relativePath"
        }
    }
}

function Test-ReleaseArchive {
    param(
        [Parameter(Mandatory)] [string]$ArchivePath,
        [Parameter(Mandatory)] [string]$AuditDirectory,
        [Parameter(Mandatory)] [string]$RepositoryRoot,
        [Parameter(Mandatory)] [string]$DotnetRoot
    )

    Add-Type -AssemblyName System.IO.Compression
    $stream = [IO.File]::OpenRead($ArchivePath)
    try {
        $archive = [IO.Compression.ZipArchive]::new(
            $stream,
            [IO.Compression.ZipArchiveMode]::Read,
            $false,
            [Text.UTF8Encoding]::new($false, $true))
        try {
            $paths = [string[]]@($archive.Entries | ForEach-Object { $_.FullName })
            $sortedPaths = [string[]]$paths.Clone()
            [Array]::Sort($sortedPaths, [StringComparer]::Ordinal)
            $exactPaths = [Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
            $foldedPaths = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
            if ($paths.Count -eq 0 -or
                $paths.Count -ne @($paths | Where-Object { $exactPaths.Add($_) -and $foldedPaths.Add($_) }).Count -or
                [string]::Join("`n", $paths) -ne [string]::Join("`n", $sortedPaths)) {
                throw 'Release ZIP 条目为空、重复或未按规范路径排序。'
            }
            foreach ($path in $paths) {
                if ($path.StartsWith('/') -or $path.EndsWith('/') -or $path.Contains('\') -or
                    $path.Split('/') -contains '..') {
                    throw "Release ZIP 路径不规范：$path"
                }
            }
        }
        finally {
            $archive.Dispose()
        }
    }
    finally {
        $stream.Dispose()
    }

    [IO.Compression.ZipFile]::ExtractToDirectory($ArchivePath, $AuditDirectory)
    Test-ReleasePayload -PayloadDirectory $AuditDirectory -RepositoryRoot $RepositoryRoot -DotnetRoot $DotnetRoot
}

function Test-GuiStartup {
    param([Parameter(Mandatory)] [string]$PayloadDirectory)

    $program = Join-Path $PayloadDirectory $entrypoint
    $process = Start-Process -FilePath $program -WorkingDirectory $PayloadDirectory -PassThru
    try {
        $deadline = [DateTime]::UtcNow.AddSeconds(15)
        do {
            Start-Sleep -Milliseconds 100
            $process.Refresh()
            if ($process.HasExited) {
                throw "GUI 启动后提前退出：$($process.ExitCode)"
            }
        } while ($process.MainWindowHandle -eq [IntPtr]::Zero -and [DateTime]::UtcNow -lt $deadline)
        if ($process.MainWindowHandle -eq [IntPtr]::Zero) {
            throw 'GUI 未在期限内创建主窗口。'
        }
    }
    finally {
        if (-not $process.HasExited) {
            $null = $process.CloseMainWindow()
            if (-not $process.WaitForExit(3000)) {
                $process.Kill($true)
                $process.WaitForExit()
            }
        }
        $process.Dispose()
    }
}

$scriptDirectory = Split-Path -Parent $PSCommandPath
$toolRoot = [IO.Path]::GetFullPath((Join-Path $scriptDirectory '..'))
$repositoryRoot = [IO.Path]::GetFullPath((Join-Path $toolRoot '../..'))
$solution = Join-Path $toolRoot 'TesseraCiv6Extractor.slnx'
$guiProject = Join-Path $toolRoot 'src/Tessera.Civ6.Extractor.Gui/Tessera.Civ6.Extractor.Gui.csproj'

if ([string]::IsNullOrWhiteSpace($DotnetPath)) {
    $DotnetPath = (Get-Command dotnet -ErrorAction Stop).Source
}
$DotnetPath = [IO.Path]::GetFullPath($DotnetPath)
if (-not (Test-Path -LiteralPath $DotnetPath -PathType Leaf)) {
    throw "找不到 dotnet：$DotnetPath"
}
$dotnetRoot = Split-Path -Parent $DotnetPath
$dotnetLicense = Join-Path $dotnetRoot 'LICENSE.txt'
$dotnetNotices = Join-Path $dotnetRoot 'ThirdPartyNotices.txt'
if (-not (Test-Path -LiteralPath $dotnetLicense -PathType Leaf) -or
    -not (Test-Path -LiteralPath $dotnetNotices -PathType Leaf)) {
    throw '当前 .NET 分发目录缺少 LICENSE.txt 或 ThirdPartyNotices.txt。'
}

if ([string]::IsNullOrWhiteSpace($OutputRoot)) {
    $OutputRoot = Join-Path $repositoryRoot 'local-modules/release-candidates'
}
$OutputRoot = [IO.Path]::GetFullPath($OutputRoot)
$allowedOutputRoot = [IO.Path]::GetFullPath((Join-Path $repositoryRoot 'local-modules'))
if (-not $OutputRoot.StartsWith($allowedOutputRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
    throw '发布候选只能写入仓库已忽略的 local-modules 子目录。'
}

$dirty = @(& git -C $repositoryRoot status --porcelain --untracked-files=all)
if ($LASTEXITCODE -ne 0) {
    throw '无法检查 Git 工作树状态。'
}
if ($dirty.Count -ne 0) {
    throw "发布必须从干净源码构建：`n$($dirty -join "`n")"
}

New-Item -ItemType Directory -Path $OutputRoot -Force | Out-Null
$nonce = [Guid]::NewGuid().ToString('N')
$staging = Join-Path $OutputRoot ".staging-$nonce"
$payload = Join-Path $staging 'payload'
$audit = Join-Path $staging 'audit'
$stagingArchive = Join-Path $staging $artifactName
$backupArchive = Join-Path $staging "$artifactName.previous"
$finalArchive = Join-Path $OutputRoot $artifactName
$summaryPath = "$finalArchive.summary.json"
$sidecarPath = "$finalArchive.sha256"

try {
    New-Item -ItemType Directory -Path $payload -Force | Out-Null
    Invoke-CheckedCommand -FilePath $DotnetPath -ArgumentList @('restore', $solution, '--locked-mode')
    Invoke-CheckedCommand -FilePath $DotnetPath -ArgumentList @(
        'restore', $guiProject, '--runtime', 'win-x64', '--locked-mode')
    Invoke-CheckedCommand -FilePath $DotnetPath -ArgumentList @(
        'test', $solution, '--configuration', 'Release', '--no-restore')
    Invoke-CheckedCommand -FilePath $DotnetPath -ArgumentList @(
        'publish', $guiProject,
        '--configuration', 'Release',
        '--runtime', 'win-x64',
        '--self-contained', 'true',
        '--no-restore',
        '--output', $payload,
        '-p:PublishProfile=WindowsX64')

    Copy-Item -LiteralPath (Join-Path $toolRoot 'release/快速开始.txt') -Destination $payload
    Copy-Item -LiteralPath (Join-Path $toolRoot 'release/SOURCE-AND-LICENSE.txt') -Destination $payload
    Copy-Item -LiteralPath $dotnetLicense -Destination (Join-Path $payload 'DOTNET-LICENSE.txt')
    Copy-Item -LiteralPath $dotnetNotices -Destination (Join-Path $payload 'DOTNET-THIRD-PARTY-NOTICES.txt')

    $payloadFiles = @(Get-OrderedPayloadFiles -Root $payload |
        ForEach-Object {
            [ordered]@{
                path = $_.Path
                bytes = $_.File.Length
            }
        })
    $manifest = [ordered]@{
        schemaVersion = '1'
        extractorId = 'tessera.civ6-extractor'
        version = $releaseVersion
        os = 'windows'
        arch = 'x64'
        minOsBuild = 26100
        artifactType = 'portable-zip'
        entrypoint = $entrypoint
        outputModuleId = 'tessera.civ6'
        outputModuleVersion = '1.0.0'
        moduleFormatVersion = '1'
        publish = [ordered]@{
            selfContained = $true
            singleFile = $false
            trimmed = $false
            debugSymbols = $false
        }
        implementation = [ordered]@{
            imageDecoding = 'fully-managed'
            skiaSharpBundled = $false
        }
        payloadFiles = $payloadFiles
    }
    Write-Utf8File -Path (Join-Path $payload 'extractor-release-manifest.json') -Value (($manifest | ConvertTo-Json -Depth 8) + "`n")

    Test-ReleasePayload -PayloadDirectory $payload -RepositoryRoot $repositoryRoot -DotnetRoot $dotnetRoot
    New-StableZip -SourceDirectory $payload -ArchivePath $stagingArchive
    New-Item -ItemType Directory -Path $audit -Force | Out-Null
    Test-ReleaseArchive -ArchivePath $stagingArchive -AuditDirectory $audit -RepositoryRoot $repositoryRoot -DotnetRoot $dotnetRoot
    Test-GuiStartup -PayloadDirectory $audit

    if (Test-Path -LiteralPath $finalArchive) {
        # File.Replace 在部分 PowerShell/.NET 绑定中不接受空备份路径；
        # 备份放在本次 staging 内，既保持替换原子性，也会由 finally 统一清理。
        [IO.File]::Replace($stagingArchive, $finalArchive, $backupArchive, $true)
    }
    else {
        [IO.File]::Move($stagingArchive, $finalArchive)
    }

    $archiveBytes = (Get-Item -LiteralPath $finalArchive).Length
    $sha256 = (Get-FileHash -LiteralPath $finalArchive -Algorithm SHA256).Hash.ToLowerInvariant()
    Write-Utf8File -Path $sidecarPath -Value "$sha256  $artifactName`n"
    $summary = [ordered]@{
        schemaVersion = '1'
        artifactName = $artifactName
        version = $releaseVersion
        os = 'windows'
        arch = 'x64'
        minOsBuild = 26100
        bytes = $archiveBytes
        sha256 = $sha256
        entrypoint = $entrypoint
    }
    Write-Utf8File -Path $summaryPath -Value (($summary | ConvertTo-Json -Depth 4) + "`n")
    $summary | ConvertTo-Json -Depth 4
}
finally {
    if (Test-Path -LiteralPath $staging) {
        Remove-Item -LiteralPath $staging -Recurse -Force
    }
}
