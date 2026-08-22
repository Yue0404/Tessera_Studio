namespace Tessera.Civ6.Extractor.Core;

public sealed class Civ6ExtractionService
{
    private readonly TimeProvider timeProvider;
    private readonly IPackageOutputValidator outputValidator;
    private readonly Civ6InstallationProbe installationProbe;

    public Civ6ExtractionService(
        TimeProvider? timeProvider = null,
        IPackageOutputValidator? outputValidator = null,
        Civ6InstallationProbe? installationProbe = null)
    {
        this.timeProvider = timeProvider ?? TimeProvider.System;
        this.outputValidator = outputValidator ?? new PackageOutputValidator();
        this.installationProbe = installationProbe ?? new Civ6InstallationProbe();
    }

    public async Task<ExtractionResult> ExtractAsync(ExtractionRequest request, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(request);
        var input = SafeInputRoot.Open(request.InputDirectory);
        if (string.IsNullOrWhiteSpace(request.OutputDirectory))
        {
            throw new ExtractionException("output-directory-required", "必须明确指定输出目录。", "outputDirectory");
        }

        var output = Path.TrimEndingDirectorySeparator(Path.GetFullPath(request.OutputDirectory));
        EnsureDirectoriesDoNotOverlap(input.Root, output);
        var inspection = await installationProbe.InspectAsync(input.Root, cancellationToken);

        var scan = await Civ6ContentScanner.ScanAsync(input, cancellationToken);
        var source = new Civ6SourceInfo(
            inspection.GameVersion,
            "civ6-standard-gs-v1",
            "not-extracted",
            ["Expansion1", "Expansion2"],
            scan.Definitions,
            scan.ChineseText);
        var artExtraction = await Civ6BlpTextureExtractor.ExtractRailroadPreviewAsync(
            input,
            scan.Definitions,
            cancellationToken);
        var artAssets = artExtraction is null ? Array.Empty<GeneratedArtAsset>() : [artExtraction.Asset];
        var sourceFiles = MergeSourceFiles(inspection, scan, artExtraction?.SourceFiles ?? []);
        var package = PackageJsonBuilder.Build(
            source,
            request.ModuleVersion,
            request.GeneratorVersion,
            timeProvider.GetUtcNow(),
            sourceFiles,
            artAssets);

        await AtomicDirectoryPublisher.PublishAsync(output, async staging =>
        {
            foreach (var (relativePath, bytes) in package.Files)
            {
                cancellationToken.ThrowIfCancellationRequested();
                var destination = Path.Combine(staging, relativePath.Replace('/', Path.DirectorySeparatorChar));
                Directory.CreateDirectory(Path.GetDirectoryName(destination)!);
                await File.WriteAllBytesAsync(destination, bytes, cancellationToken);
            }

            await outputValidator.ValidateAsync(staging, cancellationToken);
        }, cancellationToken);

        return new ExtractionResult(output, "tessera.civ6", request.ModuleVersion, package.ElementCount, package.ResourceCount);
    }

    public async Task<Civ6CatalogInspection> InspectCatalogAsync(
        string inputDirectory,
        CancellationToken cancellationToken = default)
    {
        var input = SafeInputRoot.Open(inputDirectory);
        var inspection = await installationProbe.InspectAsync(input.Root, cancellationToken);
        var scan = await Civ6ContentScanner.ScanAsync(input, cancellationToken);
        var categories = scan.Definitions.GroupBy(value => value.Category, StringComparer.Ordinal)
            .OrderBy(group => group.Key, StringComparer.Ordinal)
            .Select(group => new Civ6CatalogCategoryCount(
                group.Key,
                group.Count(),
                group.Select(value => value.Id).Order(StringComparer.Ordinal).Take(3).ToArray()))
            .ToArray();
        var chineseNameCount = scan.Definitions.Count(value => scan.ChineseText.ContainsKey(value.NameKey));
        return new(
            inspection.GameVersion,
            categories,
            scan.Definitions.Count,
            chineseNameCount,
            scan.Definitions.Count - chineseNameCount,
            inspection.Diagnostics.Concat(scan.Diagnostics)
                .OrderBy(value => value.Code, StringComparer.Ordinal)
                .ThenBy(value => value.RelativePath, StringComparer.Ordinal)
                .ToArray());
    }

    public async Task<Civ6ArtAssetInspection> InspectArtAssetsAsync(
        string inputDirectory,
        CancellationToken cancellationToken = default)
    {
        var input = SafeInputRoot.Open(inputDirectory);
        var installation = await installationProbe.InspectAsync(input.Root, cancellationToken);
        var content = await Civ6ContentScanner.ScanAsync(input, cancellationToken);
        var art = await Civ6ArtAssetProbe.InspectAsync(
            input,
            installation.GameVersion,
            content.Definitions,
            cancellationToken);
        var extracted = await Civ6BlpTextureExtractor.ExtractRailroadPreviewAsync(
            input,
            content.Definitions,
            cancellationToken);
        var diagnostics = installation.Diagnostics.Concat(content.Diagnostics).Concat(art.Diagnostics)
            .Where(value => value.Code != "art-static-image-extraction-unavailable")
            .Append(new Civ6InstallationDiagnostic(
                "art-static-image-extraction-partial",
                "warning",
                "仅已验证的 CIVBLP v2 BC2 纹理链可提取；其他 CIVBLP/CIVBIG 格式仍保持无图占位。",
                extracted?.Asset.SourceEntryName))
            .OrderBy(value => value.Code, StringComparer.Ordinal)
            .ThenBy(value => value.RelativePath, StringComparer.Ordinal)
            .ToArray();
        return art with
        {
            StaticImageExtractionAvailable = extracted is not null,
            StaticImageBlockerCode = extracted is null ? "firaxis-container-decoder-unavailable" : "partial-bc2-only",
            Diagnostics = diagnostics,
        };
    }

    public async Task<Civ6TextureContainerInspection> InspectTextureContainersAsync(
        string inputDirectory,
        CancellationToken cancellationToken = default)
    {
        var input = SafeInputRoot.Open(inputDirectory);
        var installation = await installationProbe.InspectAsync(input.Root, cancellationToken);
        return await Civ6TextureContainerProbe.InspectAsync(
            input,
            installation.GameVersion,
            cancellationToken);
    }

    private static SourceFileFact[] MergeSourceFiles(
        Civ6InstallationInspection inspection,
        Civ6ContentScanResult scan,
        IReadOnlyList<SourceFileFact> artSourceFiles)
    {
        var files = new SortedDictionary<string, long>(StringComparer.Ordinal);
        foreach (var value in inspection.Files)
        {
            files[value.RelativePath] = value.Bytes;
        }

        foreach (var value in scan.SourceFiles)
        {
            files[value.RelativePath] = value.Bytes;
        }

        foreach (var value in artSourceFiles)
        {
            files[value.RelativePath] = value.Bytes;
        }

        return files.Select((value, index) =>
            new SourceFileFact(value.Key, $"tessera.civ6:source.input-{index + 1:D4}", value.Value)).ToArray();
    }

    private static void EnsureDirectoriesDoNotOverlap(string input, string output)
    {
        static string WithSeparator(string path) => Path.TrimEndingDirectorySeparator(path) + Path.DirectorySeparatorChar;
        var inputPrefix = WithSeparator(Path.GetFullPath(input));
        var outputPrefix = WithSeparator(Path.GetFullPath(output));
        if (inputPrefix.StartsWith(outputPrefix, StringComparison.OrdinalIgnoreCase) ||
            outputPrefix.StartsWith(inputPrefix, StringComparison.OrdinalIgnoreCase))
        {
            throw new ExtractionException("input-output-overlap", "输入目录和输出目录不能相同或互相包含。", "outputDirectory");
        }
    }
}
