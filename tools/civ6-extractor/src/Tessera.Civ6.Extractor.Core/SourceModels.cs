namespace Tessera.Civ6.Extractor.Core;

internal sealed record Civ6SourceInfo(
    string SourceBuild,
    string RulesetId,
    string ArtDefVersion,
    IReadOnlyList<string> DlcIds,
    IReadOnlyList<Civ6ObjectDefinition> Objects);

internal sealed record Civ6ObjectDefinition(
    string Id,
    string Category,
    string Name,
    string Description,
    string ArtDefId);

internal sealed record ArtDefAsset(string Id, string ImagePath);

internal sealed record PngImage(int Width, int Height, byte[] Bytes);

internal sealed record SourceFileFact(string RelativePath, string ResourceId, long Bytes);

internal sealed record PackageResource(
    string ResourceId,
    string OutputPath,
    string SourceRelativePath,
    byte[] Bytes,
    int Width,
    int Height);

internal static class ExtractionLayout
{
    public const string RulesPath = "Base/Assets/Gameplay/Data/Districts.xml";
    public const string ArtDefPath = "Base/ArtDefs/Districts.artdef";
}
