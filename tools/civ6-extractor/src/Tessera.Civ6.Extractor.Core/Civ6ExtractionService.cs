namespace Tessera.Civ6.Extractor.Core;

public sealed class Civ6ExtractionService
{
    private readonly TimeProvider timeProvider;
    private readonly IPackageOutputValidator outputValidator;

    public Civ6ExtractionService(TimeProvider? timeProvider = null, IPackageOutputValidator? outputValidator = null)
    {
        this.timeProvider = timeProvider ?? TimeProvider.System;
        this.outputValidator = outputValidator ?? new PackageOutputValidator();
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

        var rulesBytes = await input.ReadAllBytesAsync(ExtractionLayout.RulesPath, cancellationToken);
        var artDefBytes = await input.ReadAllBytesAsync(ExtractionLayout.ArtDefPath, cancellationToken);
        var source = Civ6RulesParser.Parse(rulesBytes, ExtractionLayout.RulesPath);
        var artAssets = ArtDefParser.Parse(artDefBytes, ExtractionLayout.ArtDefPath);
        var images = new Dictionary<string, PngImage>(StringComparer.Ordinal);
        foreach (var imagePath in source.Objects.Select(value =>
            artAssets.TryGetValue(value.ArtDefId, out var asset)
                ? asset.ImagePath
                : throw new ExtractionException("input-artdef-reference-missing", "规则对象引用了不存在的 ArtDef 资产。", value.ArtDefId))
            .Distinct(StringComparer.Ordinal)
            .Order(StringComparer.Ordinal))
        {
            var bytes = await input.ReadAllBytesAsync(imagePath, cancellationToken);
            images[imagePath] = PngFixtureParser.Parse(bytes, imagePath);
        }

        var sourceFiles = new List<SourceFileFact>
        {
            new(ExtractionLayout.RulesPath, "tessera.civ6:source.rules", rulesBytes.LongLength),
            new(ExtractionLayout.ArtDefPath, "tessera.civ6:source.artdef", artDefBytes.LongLength),
        };
        sourceFiles.AddRange(images.Select((pair, index) =>
            new SourceFileFact(pair.Key, $"tessera.civ6:source.image-{index + 1}", pair.Value.Bytes.LongLength)));
        var package = PackageJsonBuilder.Build(
            source,
            artAssets,
            images,
            request.ModuleVersion,
            request.GeneratorVersion,
            timeProvider.GetUtcNow(),
            sourceFiles);

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
