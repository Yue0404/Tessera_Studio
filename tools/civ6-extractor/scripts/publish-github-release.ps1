[CmdletBinding()]
param(
    [Parameter(Mandatory)] [string]$Version,
    [Parameter(Mandatory)] [string]$Tag,
    [Parameter(Mandatory)] [string]$SourceRefName,
    [Parameter(Mandatory)] [string]$DefaultBranch,
    [Parameter(Mandatory)] [string]$ArtifactDirectory,
    [Parameter(Mandatory)] [string]$CatalogOutputPath,
    [string]$Repository = $env:GITHUB_REPOSITORY,
    [string]$TargetCommitish = $env:GITHUB_SHA,
    [string]$MinAppVersion = '0.1.0'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$semverPattern = '^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-(?:0|[1-9][0-9]*|[0-9]*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9][0-9]*|[0-9]*[A-Za-z-][0-9A-Za-z-]*))*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$'
$artifactName = "tessera-civ6-extractor-v$Version-windows-x64.zip"
$expectedAssetNames = @(
    $artifactName,
    "$artifactName.sha256",
    "$artifactName.summary.json"
)

function Invoke-GhJson {
    param([Parameter(Mandatory)] [string[]]$Arguments)

    $output = @(& gh @Arguments)
    if ($LASTEXITCODE -ne 0) {
        throw "GitHub CLI 命令失败（exit $LASTEXITCODE）。"
    }
    return ($output -join "`n") | ConvertFrom-Json
}

function Get-ReleaseAssets {
    param(
        [Parameter(Mandatory)] [string]$RepositoryName,
        [Parameter(Mandatory)] [long]$ReleaseId
    )

    return @(Invoke-GhJson -Arguments @(
            'api',
            "repos/$RepositoryName/releases/$ReleaseId/assets",
            '--header', 'X-GitHub-Api-Version: 2022-11-28'
        ))
}

function Assert-AssetClosure {
    param(
        [Parameter(Mandatory)] [object[]]$Assets,
        [Parameter(Mandatory)] [hashtable]$LocalFiles
    )

    if ($Assets.Count -ne $expectedAssetNames.Count) {
        throw "Release 资产数量不是三项闭包：实际 $($Assets.Count) 项。"
    }

    $assetsByName = @{}
    foreach ($asset in $Assets) {
        if ($assetsByName.ContainsKey([string]$asset.name)) {
            throw "Release 包含重名资产：$($asset.name)"
        }
        $assetsByName[[string]$asset.name] = $asset
    }

    foreach ($name in $expectedAssetNames) {
        if (-not $assetsByName.ContainsKey($name)) {
            throw "Release 缺少闭包资产：$name"
        }
        $asset = $assetsByName[$name]
        $localFile = $LocalFiles[$name]
        if ($asset.state -ne 'uploaded' -or [long]$asset.size -ne $localFile.Length) {
            throw "Release 资产状态或字节数不匹配：$name"
        }
    }

    return $assetsByName
}

if ($Version -cnotmatch $semverPattern -or $MinAppVersion -cnotmatch $semverPattern) {
    throw 'Version 与 MinAppVersion 必须是规范 SemVer。'
}
if ($Tag -cne "extractor-v$Version") {
    throw "Tag 必须严格等于 extractor-v$Version。"
}
if ([string]::IsNullOrWhiteSpace($DefaultBranch) -or $SourceRefName -cne $DefaultBranch) {
    throw "正式 Release 只能从仓库默认分支运行，当前 ref 为 $SourceRefName。"
}
if ($Repository -cnotmatch '^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$') {
    throw 'Repository 必须是 owner/name 格式。'
}
if ($TargetCommitish -cnotmatch '^[0-9a-f]{40}$') {
    throw 'TargetCommitish 必须是完整的小写 Git 提交 SHA。'
}
if ([string]::IsNullOrWhiteSpace($env:GH_TOKEN)) {
    throw '发布需要由 GitHub Actions 注入 GH_TOKEN。'
}

$artifactDirectoryPath = [IO.Path]::GetFullPath($ArtifactDirectory)
$catalogOutputFullPath = [IO.Path]::GetFullPath($CatalogOutputPath)
$localFiles = @{}
foreach ($name in $expectedAssetNames) {
    $path = Join-Path $artifactDirectoryPath $name
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
        throw "本地发布闭包缺少资产：$name"
    }
    $localFiles[$name] = Get-Item -LiteralPath $path
}

$summary = Get-Content -LiteralPath $localFiles["$artifactName.summary.json"].FullName -Raw | ConvertFrom-Json
$archiveSha256 = (Get-FileHash -LiteralPath $localFiles[$artifactName].FullName -Algorithm SHA256).Hash.ToLowerInvariant()
$expectedSidecar = "$archiveSha256  $artifactName"
$actualSidecar = (Get-Content -LiteralPath $localFiles["$artifactName.sha256"].FullName -Raw).TrimEnd("`r", "`n")
if ($summary.schemaVersion -ne '1' -or
    $summary.artifactName -cne $artifactName -or
    $summary.version -cne $Version -or
    $summary.os -ne 'windows' -or
    $summary.arch -ne 'x64' -or
    $summary.minOsBuild -ne 26100 -or
    $summary.bytes -ne $localFiles[$artifactName].Length -or
    $summary.sha256 -cne $archiveSha256 -or
    $summary.entrypoint -ne 'TesseraCiv6Extractor.exe' -or
    $actualSidecar -cne $expectedSidecar) {
    throw '本地 ZIP、SHA-256 sidecar 与 summary 未形成一致闭包。'
}

# 正式发布只接受全新 tag；不覆盖已有 tag 或 Release。
& gh api "repos/$Repository/releases/tags/$Tag" --silent 2>$null
if ($LASTEXITCODE -eq 0) {
    throw "Release 已存在：$Tag"
}
& gh api "repos/$Repository/git/ref/tags/$Tag" --silent 2>$null
if ($LASTEXITCODE -eq 0) {
    throw "Git tag 已存在：$Tag"
}

$release = $null
try {
    $release = Invoke-GhJson -Arguments @(
        'api', '--method', 'POST',
        "repos/$Repository/releases",
        '--header', 'X-GitHub-Api-Version: 2022-11-28',
        '-f', "tag_name=$Tag",
        '-f', "target_commitish=$TargetCommitish",
        '-f', "name=Tessera Civilization VI Extractor v$Version",
        '-f', "body=Windows x64 自包含的可选 Civilization VI 资源提取器。发布资产已经过测试、构建、载荷审计与远端逐字节复核。",
        '-F', 'draft=true',
        '-F', "prerelease=$($Version.Contains('-').ToString().ToLowerInvariant())"
    )
    if (-not $release.draft -or $release.tag_name -cne $Tag) {
        throw 'GitHub API 未创建预期的 draft Release。'
    }

    $uploadArguments = @('release', 'upload', $Tag, '--repo', $Repository)
    foreach ($name in $expectedAssetNames) {
        $uploadArguments += $localFiles[$name].FullName
    }
    & gh @uploadArguments
    if ($LASTEXITCODE -ne 0) {
        throw "上传 Release 三项资产失败（exit $LASTEXITCODE）。"
    }

    $assets = Get-ReleaseAssets -RepositoryName $Repository -ReleaseId $release.id
    $assetsByName = Assert-AssetClosure -Assets $assets -LocalFiles $localFiles
    $expectedAssetUrl = "https://github.com/$Repository/releases/download/$Tag/$artifactName"
    if ($assetsByName[$artifactName].browser_download_url -cne $expectedAssetUrl) {
        throw 'ZIP 的 GitHub 下载 URL 与确定性 Release URL 不一致。'
    }
    $downloadDirectory = Join-Path ([IO.Path]::GetTempPath()) "tessera-release-audit-$([Guid]::NewGuid().ToString('N'))"
    New-Item -ItemType Directory -Path $downloadDirectory | Out-Null
    try {
        foreach ($name in $expectedAssetNames) {
            $asset = $assetsByName[$name]
            $assetApiUri = [Uri]$asset.url
            $expectedAssetApiPrefix = "/repos/$Repository/releases/assets/"
            if ($assetApiUri.Scheme -cne 'https' -or
                $assetApiUri.Host -cne 'api.github.com' -or
                -not $assetApiUri.AbsolutePath.StartsWith(
                    $expectedAssetApiPrefix,
                    [StringComparison]::Ordinal)) {
                throw "拒绝向非预期 GitHub API 地址发送授权信息：$name"
            }
            $downloadPath = Join-Path $downloadDirectory $name
            Invoke-WebRequest -Uri $assetApiUri -Headers @{
                Accept = 'application/octet-stream'
                Authorization = "Bearer $($env:GH_TOKEN)"
                'X-GitHub-Api-Version' = '2022-11-28'
            } -OutFile $downloadPath
            $downloaded = Get-Item -LiteralPath $downloadPath
            $downloadedSha256 = (Get-FileHash -LiteralPath $downloadPath -Algorithm SHA256).Hash.ToLowerInvariant()
            $localSha256 = (Get-FileHash -LiteralPath $localFiles[$name].FullName -Algorithm SHA256).Hash.ToLowerInvariant()
            if ($downloaded.Length -ne $localFiles[$name].Length -or $downloadedSha256 -cne $localSha256) {
                throw "远端 Release 资产逐字节复核失败：$name"
            }
        }
    }
    finally {
        if (Test-Path -LiteralPath $downloadDirectory) {
            Remove-Item -LiteralPath $downloadDirectory -Recurse -Force
        }
    }

    # 发布前最后一次回读，确保验证后没有出现第四项资产或字节数漂移。
    $releaseBeforePublish = Invoke-GhJson -Arguments @(
        'api', "repos/$Repository/releases/$($release.id)",
        '--header', 'X-GitHub-Api-Version: 2022-11-28'
    )
    if (-not $releaseBeforePublish.draft) {
        throw 'Release 在验收完成前已不再是 draft。'
    }
    $finalAssets = Get-ReleaseAssets -RepositoryName $Repository -ReleaseId $release.id
    $null = Assert-AssetClosure -Assets $finalAssets -LocalFiles $localFiles

    $catalogEntry = [ordered]@{
        extractorId = 'tessera.civ6-extractor'
        version = $Version
        os = 'windows'
        arch = 'x64'
        minOsBuild = 26100
        artifactType = 'portable-zip'
        entrypoint = 'TesseraCiv6Extractor.exe'
        bytes = [long]$summary.bytes
        sha256 = $archiveSha256
        outputModuleId = 'tessera.civ6'
        outputModuleVersion = '1.0.0'
        minAppVersion = $MinAppVersion
        assetUrl = $expectedAssetUrl
    }
    $catalogDirectory = Split-Path -Parent $catalogOutputFullPath
    New-Item -ItemType Directory -Path $catalogDirectory -Force | Out-Null
    [IO.File]::WriteAllText(
        $catalogOutputFullPath,
        (($catalogEntry | ConvertTo-Json -Depth 4) + "`n"),
        [Text.UTF8Encoding]::new($false))

    # PATCH draft=false 是最后一个可改变远端状态的步骤；此前任一步失败都只留下草稿。
    $published = Invoke-GhJson -Arguments @(
        'api', '--method', 'PATCH',
        "repos/$Repository/releases/$($release.id)",
        '--header', 'X-GitHub-Api-Version: 2022-11-28',
        '-F', 'draft=false'
    )
    if ($published.draft -or $published.tag_name -cne $Tag) {
        throw 'GitHub API 未返回已发布的预期 Release。'
    }

    Write-Output ($catalogEntry | ConvertTo-Json -Depth 4)
}
catch {
    $failure = $_
    if ($null -ne $release) {
        try {
            $releaseState = Invoke-GhJson -Arguments @(
                'api', "repos/$Repository/releases/$($release.id)",
                '--header', 'X-GitHub-Api-Version: 2022-11-28'
            )
            if ($releaseState.draft) {
                Write-Warning "发布失败；Release $Tag 保持 draft，便于审计或手动删除。"
            }
            else {
                Write-Warning "发布命令返回异常，但远端 Release $Tag 已正式发布；三项闭包此前已全部通过，请核对 Actions 运行日志。"
            }
        }
        catch {
            Write-Warning "发布失败，且暂时无法回读 Release $Tag 的 draft 状态；请在 GitHub Releases 中核对。"
        }
    }
    throw $failure
}
