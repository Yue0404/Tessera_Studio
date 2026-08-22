namespace Tessera.Civ6.Extractor.Core;

public sealed class Civ6ExtractionService : ICiv6ExtractionApplicationService
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

    public Task<ExtractionResult> ExtractAsync(
        ExtractionRequest request,
        CancellationToken cancellationToken = default) =>
        ExtractAsync(request, progress: null, cancellationToken);

    public async Task<ExtractionResult> ExtractAsync(
        ExtractionRequest request,
        IProgress<ExtractionProgress>? progress,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(request);
        progress?.Report(new("checking-installation", 0.02));
        var input = SafeInputRoot.Open(request.InputDirectory);
        if (string.IsNullOrWhiteSpace(request.OutputDirectory))
        {
            throw new ExtractionException("output-directory-required", "必须明确指定输出目录。", "outputDirectory");
        }

        var output = Path.TrimEndingDirectorySeparator(Path.GetFullPath(request.OutputDirectory));
        EnsureDirectoriesDoNotOverlap(input.Root, output);
        var inspection = await installationProbe.InspectAsync(input.Root, cancellationToken);

        progress?.Report(new("scanning-content", 0.12));
        var scan = await Civ6ContentScanner.ScanAsync(input, cancellationToken);
        var source = new Civ6SourceInfo(
            inspection.GameVersion,
            "civ6-standard-gs-v1",
            "not-extracted",
            ["Expansion1", "Expansion2"],
            scan.Definitions,
            scan.ChineseText);
        progress?.Report(new("extracting-strategic-art", 0.3));
        var strategicExtraction = await Civ6StaticPreviewExtractor.ExtractAsync(
            input,
            scan.Definitions,
            cancellationToken);
        progress?.Report(new("extracting-ui-icons", 0.55));
        var artExtraction = await Civ6UiIconExtractor.FillPlaceholdersAsync(
            input,
            scan.Definitions,
            strategicExtraction,
            cancellationToken);
        var sourceFiles = MergeSourceFiles(inspection, scan, artExtraction.SourceFiles);
        var package = PackageJsonBuilder.Build(
            source,
            request.ModuleVersion,
            request.GeneratorVersion,
            timeProvider.GetUtcNow(),
            sourceFiles,
            artExtraction.Assets);

        progress?.Report(new("writing-package", 0.78));
        await AtomicDirectoryPublisher.PublishAsync(output, async staging =>
        {
            var written = 0;
            foreach (var (relativePath, bytes) in package.Files)
            {
                cancellationToken.ThrowIfCancellationRequested();
                var destination = Path.Combine(staging, relativePath.Replace('/', Path.DirectorySeparatorChar));
                Directory.CreateDirectory(Path.GetDirectoryName(destination)!);
                await File.WriteAllBytesAsync(destination, bytes, cancellationToken);
                written++;
                progress?.Report(new(
                    "writing-package",
                    0.78 + (0.17 * written / package.Files.Count)));
            }

            progress?.Report(new("validating-package", 0.97));
            await outputValidator.ValidateAsync(staging, cancellationToken);
        }, cancellationToken);

        progress?.Report(new("completed", 1));
        return new ExtractionResult(output, "tessera.civ6", request.ModuleVersion, package.ElementCount, package.ResourceCount);
    }

    public async Task<Civ6ExtractionOverview> InspectOverviewAsync(
        string inputDirectory,
        IProgress<ExtractionProgress>? progress = null,
        CancellationToken cancellationToken = default)
    {
        progress?.Report(new("checking-installation", 0.05));
        var input = SafeInputRoot.Open(inputDirectory);
        var inspection = await installationProbe.InspectAsync(input.Root, cancellationToken);
        progress?.Report(new("scanning-content", 0.45));
        var scan = await Civ6ContentScanner.ScanAsync(input, cancellationToken);
        var catalog = BuildCatalogInspection(inspection, scan);
        progress?.Report(new("inspection-complete", 1));
        return new(inspection, catalog);
    }

    public async Task<Civ6CatalogInspection> InspectCatalogAsync(
        string inputDirectory,
        CancellationToken cancellationToken = default)
    {
        var overview = await InspectOverviewAsync(inputDirectory, progress: null, cancellationToken);
        return overview.Catalog;
    }

    private static Civ6CatalogInspection BuildCatalogInspection(
        Civ6InstallationInspection inspection,
        Civ6ContentScanResult scan)
    {
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
        var strategic = await Civ6StaticPreviewExtractor.ExtractAsync(
            input,
            content.Definitions,
            cancellationToken);
        var extracted = await Civ6UiIconExtractor.FillPlaceholdersAsync(
            input,
            content.Definitions,
            strategic,
            cancellationToken);
        var generatedByCategory = extracted.Categories.ToDictionary(value => value.Category, StringComparer.Ordinal);
        var categories = art.Categories.Select(value =>
        {
            generatedByCategory.TryGetValue(value.Category, out var generated);
            return value with
            {
                ExtractedContentCount = generated?.ExtractedCount ?? 0,
                PlaceholderContentCount = generated?.PlaceholderCount ?? value.ContentCount,
                StrategicViewExtractedCount = generated?.StrategicCount ?? 0,
                UiIconExtractedCount = generated?.UiIconCount ?? 0,
            };
        }).ToArray();
        var diagnostics = installation.Diagnostics.Concat(content.Diagnostics).Concat(art.Diagnostics)
            .Concat(extracted.Diagnostics)
            .Where(value => value.Code != "art-static-image-extraction-unavailable")
            .Append(new Civ6InstallationDiagnostic(
                "art-static-image-extraction-partial",
                "warning",
                "优先使用完整闭合的 StrategicView 2D 链，其余内容仅由正式 IconDefinitions 与 UI atlas 精确补齐。",
                null))
            .OrderBy(value => value.Code, StringComparer.Ordinal)
            .ThenBy(value => value.RelativePath, StringComparer.Ordinal)
            .ToArray();
        var uiIconCount = extracted.Categories.Sum(value => value.UiIconCount);
        return art with
        {
            Categories = categories,
            StaticImageExtractionAvailable = extracted.Assets.Count > 0,
            StaticImageBlockerCode = extracted.Assets.Count == 0
                ? "strategicview-static-chain-unavailable"
                : uiIconCount > 0
                    ? "partial-strategicview-and-plain-ui"
                    : "partial-strategicview-only",
            Diagnostics = diagnostics,
            MaxReferenceDepth = extracted.MaxReferenceDepth,
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
