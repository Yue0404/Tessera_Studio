namespace Tessera.Civ6.Extractor.Core;

/// <summary>提取失败时对 CLI 和后续 GUI 保持稳定的错误。</summary>
public sealed class ExtractionException : Exception
{
    public ExtractionException(string code, string message, string? fieldPath = null, Exception? innerException = null)
        : base(message, innerException)
    {
        Code = code;
        FieldPath = fieldPath;
    }

    public string Code { get; }

    public string? FieldPath { get; }
}

public sealed record ExtractionRequest(
    string InputDirectory,
    string OutputDirectory,
    string ModuleVersion = "1.0.0",
    string GeneratorVersion = "1.0.0");

public sealed record ExtractionResult(
    string OutputDirectory,
    string ModuleId,
    string ModuleVersion,
    int ElementCount,
    int ResourceCount);

public sealed record Civ6CatalogCategoryCount(string Category, int Count, IReadOnlyList<string> SampleIds);

public sealed record Civ6CatalogInspection(
    string GameVersion,
    IReadOnlyList<Civ6CatalogCategoryCount> Categories,
    int TotalCount,
    int ChineseNameCount,
    int FallbackNameCount,
    IReadOnlyList<Civ6InstallationDiagnostic> Diagnostics);

public sealed record Civ6ArtCategoryInspection(
    string Category,
    int ContentCount,
    int MappedContentCount,
    int ReferencedAssetCount,
    int ResolvedContainerCount);

public sealed record Civ6ArtAssetReference(
    string EntryName,
    string XlpClass,
    string XlpPath,
    string BlpPackage,
    string ContainerRelativePath,
    string ContainerFormat,
    long ContainerBytes,
    bool DirectStaticImage);

public sealed record Civ6ArtAssetSample(
    string ContentId,
    string Category,
    string ArtDefRelativePath,
    string ArtDefName,
    IReadOnlyList<Civ6ArtAssetReference> Assets);

public sealed record Civ6ArtAssetInspection(
    string GameVersion,
    IReadOnlyList<Civ6ArtCategoryInspection> Categories,
    int TotalContentCount,
    int MappedContentCount,
    int ResolvedContainerCount,
    bool StaticImageExtractionAvailable,
    string StaticImageBlockerCode,
    IReadOnlyList<Civ6ArtAssetSample> Samples,
    IReadOnlyList<Civ6InstallationDiagnostic> Diagnostics);
