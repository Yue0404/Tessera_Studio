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

internal sealed record GeneratedArtAsset(
    string ContentId,
    string ResourceId,
    string PackagePath,
    string MimeType,
    int Width,
    int Height,
    string SourceRelativePath,
    string SourceEntryName,
    byte[] Bytes);

internal sealed record GeneratedArtExtraction(
    IReadOnlyList<GeneratedArtAsset> Assets,
    IReadOnlyList<SourceFileFact> SourceFiles,
    IReadOnlyList<Civ6InstallationDiagnostic> Diagnostics,
    IReadOnlyList<Civ6GeneratedArtCategoryCount> Categories,
    int MaxReferenceDepth = 0);

internal sealed record Civ6GeneratedArtCategoryCount(
    string Category,
    int ContentCount,
    int ExtractedCount,
    int PlaceholderCount);

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

internal sealed record Civ6ArtDefTableSpec(
    string Category,
    string RootCollection,
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

    public static readonly Civ6ArtDefTableSpec[] ArtDefTables =
    [
        new("terrain", "Terrain", ["Base/ArtDefs/Terrains.artdef", "DLC/Expansion2/ArtDefs/Terrains.artdef"]),
        new("feature", "Feature", ["Base/ArtDefs/Features.artdef", "DLC/Expansion1/ArtDefs/Features.artdef", "DLC/Expansion2/ArtDefs/Features.artdef"]),
        new("resource", "Resource", ["Base/ArtDefs/Resources.artdef", "DLC/Expansion1/ArtDefs/Resources.artdef", "DLC/Expansion2/ArtDefs/Resources.artdef"]),
        new("improvement", "Improvement", ["Base/ArtDefs/Improvements.artdef", "DLC/Expansion1/ArtDefs/Improvements.artdef", "DLC/Expansion2/ArtDefs/Improvements.artdef"]),
        new("district", "District", ["Base/ArtDefs/Districts.artdef", "DLC/Expansion1/ArtDefs/Districts.artdef", "DLC/Expansion2/ArtDefs/Districts.artdef"]),
        new("route", "Route", ["Base/ArtDefs/Routes.artdef", "DLC/Expansion2/ArtDefs/Routes.artdef"]),
        new("wonder", "Building", ["Base/ArtDefs/Buildings.artdef", "DLC/Expansion1/ArtDefs/Buildings.artdef", "DLC/Expansion2/ArtDefs/Buildings.artdef"]),
        new("city", "District", ["Base/ArtDefs/Districts.artdef", "DLC/Expansion1/ArtDefs/Districts.artdef", "DLC/Expansion2/ArtDefs/Districts.artdef"]),
    ];

    public static readonly HashSet<string> ReferencedArtDefFileNames = new(StringComparer.Ordinal)
    {
        "Buildings.artdef",
        "Buildings_Shared.artdef",
        "Cities.artdef",
        "CityGenerators.artdef",
        "Clutter.artdef",
        "Clutter_Shared.artdef",
        "Districts.artdef",
        "Districts_Shared.artdef",
        "Farms.artdef",
        "Features.artdef",
        "Improvements.artdef",
        "Improvements_Shared.artdef",
        "Landmarks.artdef",
        "Landmarks_Shared.artdef",
        "Resources.artdef",
        "Resources_Shared.artdef",
        "Routes.artdef",
        "StrategicView.artdef",
        "StrategicView_Shared.artdef",
        "Terrains.artdef",
        "TerrainStyle.artdef",
        "Walls.artdef",
    };
}
