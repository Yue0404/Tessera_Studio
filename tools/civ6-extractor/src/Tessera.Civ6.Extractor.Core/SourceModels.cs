namespace Tessera.Civ6.Extractor.Core;

internal sealed record Civ6SourceInfo(
    string SourceBuild,
    string RulesetId,
    string ArtDefVersion,
    IReadOnlyList<string> DlcIds,
    IReadOnlyList<Civ6ContentDefinition> Objects,
    IReadOnlyDictionary<string, string> ChineseText);

internal sealed record Civ6ContentDefinition(
    string Id,
    string Category,
    string NameKey,
    string? DescriptionKey,
    string SourceRelativePath,
    IReadOnlyDictionary<string, string> Attributes);

internal sealed record SourceFileFact(string RelativePath, string ResourceId, long Bytes);

internal sealed record Civ6ContentScanResult(
    IReadOnlyList<Civ6ContentDefinition> Definitions,
    IReadOnlyDictionary<string, string> ChineseText,
    IReadOnlyList<SourceFileFact> SourceFiles,
    IReadOnlyList<Civ6InstallationDiagnostic> Diagnostics);

internal sealed record Civ6ContentTableSpec(
    string Category,
    string TableName,
    string PrimaryKey,
    IReadOnlyList<string> RelativePaths);

internal static class ExtractionLayout
{
    public static readonly Civ6ContentTableSpec[] ContentTables =
    [
        new("terrain", "Terrains", "TerrainType",
        ["Base/Assets/Gameplay/Data/Terrains.xml"]),
        new("feature", "Features", "FeatureType",
        [
            "Base/Assets/Gameplay/Data/Features.xml",
            "DLC/Expansion1/Data/Expansion1_Features.xml",
            "DLC/Expansion2/Data/Expansion2_Features.xml",
        ]),
        new("resource", "Resources", "ResourceType",
        [
            "Base/Assets/Gameplay/Data/Resources.xml",
            "DLC/Expansion1/Data/Expansion1_Resources.xml",
            "DLC/Expansion2/Data/Expansion2_Resources.xml",
        ]),
        new("improvement", "Improvements", "ImprovementType",
        [
            "Base/Assets/Gameplay/Data/Improvements.xml",
            "DLC/Expansion1/Data/Expansion1_Improvements.xml",
            "DLC/Expansion2/Data/Expansion2_Improvements.xml",
        ]),
        new("district", "Districts", "DistrictType",
        [
            "Base/Assets/Gameplay/Data/Districts.xml",
            "DLC/Expansion1/Data/Expansion1_Districts.xml",
            "DLC/Expansion2/Data/Expansion2_Districts.xml",
        ]),
        new("route", "Routes", "RouteType",
        [
            "Base/Assets/Gameplay/Data/Routes.xml",
            "DLC/Expansion2/Data/Expansion2_Routes.xml",
        ]),
        new("building", "Buildings", "BuildingType",
        [
            "Base/Assets/Gameplay/Data/Buildings.xml",
            "DLC/Expansion1/Data/Expansion1_Buildings.xml",
            "DLC/Expansion2/Data/Expansion2_Buildings.xml",
        ]),
    ];

    public static readonly string[] ChineseTextPaths =
    [
        "Base/Assets/Text/Vanilla_zh_Hans_CN.xml",
        "DLC/Expansion1/Text/Expansion1_Translations_Text.xml",
        "DLC/Expansion1/Text/Expansion1_Translations_Major_Text.xml",
        "DLC/Expansion2/Text/Expansion2_Translations_Text.xml",
    ];
}
