using System.Text.Json;
using System.Text.Json.Serialization;
using System.Text.RegularExpressions;

namespace Tessera.Civ6.Extractor.Core;

internal sealed record GeneratedPackage(IReadOnlyDictionary<string, byte[]> Files, int ElementCount, int ResourceCount);

internal static partial class PackageJsonBuilder
{
    private const string ModuleId = "tessera.civ6";
    private static readonly string[] Authors = ["Tessera Studio"];
    private static readonly string[] SupportedGrids = ["hex-pointy"];
    private static readonly string[] ElementFiles = ["elements/content.json"];
    private static readonly string[] Capabilities =
    [
        "cell-style", "edge-style", "anchored-overlay", "domain-object", "declarative-constraints", "content-catalog",
    ];
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        WriteIndented = true,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
    };

    public static GeneratedPackage Build(
        Civ6SourceInfo source,
        string moduleVersion,
        string generatorVersion,
        DateTimeOffset generatedAt,
        IReadOnlyList<SourceFileFact> sourceFiles)
    {
        EnsureSemVer(moduleVersion, "moduleVersion");
        EnsureSemVer(generatorVersion, "generatorVersion");
        var timestamp = generatedAt.ToUniversalTime().ToString("O");
        var elements = source.Objects.Select(value => BuildElement(value, source, timestamp))
            .OrderBy(value => value.ElementId, StringComparer.Ordinal)
            .ToArray();
        var locale = BuildLocale(source);
        var files = new SortedDictionary<string, byte[]>(StringComparer.Ordinal)
        {
            ["locales/zh-CN.json"] = JsonBytes(locale),
            ["elements/content.json"] = JsonBytes(elements),
        };

        var categories = source.Objects
            .GroupBy(value => value.Category, StringComparer.Ordinal)
            .OrderBy(group => group.Key, StringComparer.Ordinal)
            .Select(group => new
            {
                categoryId = CategoryId(group.Key),
                nameKey = Key($"category.{group.Key}"),
                count = group.Count(),
                extensions = EmptyObject(),
            })
            .ToArray();
        var entries = elements.Select(element => new
        {
            elementId = element.ElementId,
            categoryId = element.CategoryId,
            sourceId = element.Source.SourceId,
            contentVersion = element.Source.ContentVersion,
            resourceIds = element.ResourceIds,
            extensions = EmptyObject(),
        }).OrderBy(value => value.elementId, StringComparer.Ordinal).ToArray();
        files["catalog/content-catalog.json"] = JsonBytes(new
        {
            kind = "content-catalog",
            formatVersion = "1",
            moduleId = ModuleId,
            moduleVersion,
            catalogId = "tessera.civ6:catalog.main",
            catalogVersion = moduleVersion,
            catalogSource = new
            {
                profileId = "tessera.civ6-extractor",
                metadata = new { sourceBuild = source.SourceBuild, rulesetId = source.RulesetId },
                extensions = EmptyObject(),
            },
            categories,
            entries,
            extensions = EmptyObject(),
        });
        files["provenance/source-manifest.json"] = JsonBytes(new
        {
            kind = "generated-source-manifest",
            formatVersion = "1",
            generatorId = "tessera.civ6-extractor",
            files = sourceFiles.OrderBy(value => value.RelativePath, StringComparer.Ordinal).Select(value => new
            {
                relativePath = value.RelativePath,
                resourceId = value.ResourceId,
                bytes = value.Bytes,
                extensions = EmptyObject(),
            }),
            extensions = EmptyObject(),
        });

        files["module.json"] = JsonBytes(new
        {
            formatVersion = "1",
            kind = "module",
            moduleId = ModuleId,
            version = moduleVersion,
            nameKey = Key("module.name"),
            descriptionKey = Key("module.description"),
            authors = Authors,
            appVersion = new { min = "0.1.0" },
            supportedGrids = SupportedGrids,
            dependencies = new[]
            {
                new { moduleId = "tessera.basic", versionRange = "^1.0.0", optional = false },
            },
            layers = ModuleLayers(),
            elementFiles = ElementFiles,
            constraintFiles = Array.Empty<string>(),
            migrationFiles = Array.Empty<string>(),
            catalogManifestPath = "catalog/content-catalog.json",
            defaultLanguage = "zh-CN",
            locales = new Dictionary<string, string> { ["zh-CN"] = "locales/zh-CN.json" },
            resources = Array.Empty<object>(),
            capabilities = Capabilities,
            packageSource = new
            {
                kind = "generated-local",
                generatorId = "tessera.civ6-extractor",
                generatorVersion,
                generatedAt = timestamp,
                sourceProduct = "Sid Meier's Civilization VI",
                sourceManifestPath = "provenance/source-manifest.json",
                sourceMetadata = new
                {
                    sourceBuild = source.SourceBuild,
                    rulesetId = source.RulesetId,
                    dlcIds = source.DlcIds,
                    artDefVersion = source.ArtDefVersion,
                    extensions = EmptyObject(),
                },
                extensions = EmptyObject(),
            },
            extensions = EmptyObject(),
        });

        return new GeneratedPackage(files, elements.Length, 0);
    }

    private static SortedDictionary<string, string> BuildLocale(Civ6SourceInfo source)
    {
        var locale = new SortedDictionary<string, string>(StringComparer.Ordinal)
        {
            ["module.name"] = "文明 6",
            ["module.description"] = "由本机文明 6 正式游戏文件生成的地图规划模块。",
            ["layer.terrain"] = "地形",
            ["layer.feature"] = "地貌",
            ["layer.resource"] = "资源",
            ["layer.river"] = "河流",
            ["layer.cliff"] = "悬崖",
            ["layer.route"] = "道路",
            ["layer.occupation"] = "占用物",
            ["layer.validation"] = "规划校验",
            ["layer.yield"] = "产出",
            ["category.terrain"] = "地形",
            ["category.feature"] = "地貌",
            ["category.resource"] = "资源",
            ["category.improvement"] = "改良",
            ["category.district"] = "区域",
            ["category.route"] = "路线",
            ["category.wonder"] = "奇观",
            ["category.city"] = "城市核心",
        };
        foreach (var value in source.Objects)
        {
            var slug = ElementSlug(value);
            locale[$"element.{slug}.name"] = ResolveText(source.ChineseText, value.NameKey);
            locale[$"element.{slug}.description"] = ResolveText(
                source.ChineseText,
                value.DescriptionKey ?? value.NameKey);
        }

        return locale;
    }

    private static ElementJson BuildElement(Civ6ContentDefinition value, Civ6SourceInfo source, string timestamp)
    {
        var slug = ElementSlug(value);
        var (primitive, layerId, style) = VisualSemantics(value.Category);
        return new(
            ElementId(value),
            CategoryId(value.Category),
            Key($"element.{slug}.name"),
            Key($"element.{slug}.description"),
            primitive,
            layerId,
            ["cell"],
            SupportedGrids,
            style,
            EmptyAttributeSchema(),
            Array.Empty<object>(),
            Array.Empty<string>(),
            Array.Empty<string>(),
            new SourceJson(
                $"tessera.civ6:source.{slug}",
                source.RulesetId,
                source.SourceBuild,
                timestamp,
                new Dictionary<string, object?>(StringComparer.Ordinal)
                {
                    ["gameNameKey"] = value.NameKey,
                    ["gameDescriptionKey"] = value.DescriptionKey,
                    ["sourceRelativePath"] = value.SourceRelativePath,
                }),
            null,
            new Dictionary<string, object?>(StringComparer.Ordinal)
            {
                ["generatedPlaceholder"] = true,
                ["hasExtractedArt"] = false,
            });
    }

    private static (string Primitive, string LayerId, object Style) VisualSemantics(string category) => category switch
    {
        "terrain" => ("cell-style", "tessera.civ6.cell.terrain", CellStyle("#748F58FF", 1)),
        "feature" => ("cell-style", "tessera.civ6.cell.feature", CellStyle("#3F7650FF", 0.82)),
        "route" => ("cell-style", "tessera.civ6.cell.route", CellStyle("#A97B50FF", 0.72)),
        "resource" => ("marker", "tessera.civ6.cell.resource", MarkerStyle("diamond", "#D6AF4BFF")),
        "improvement" => ("marker", "tessera.civ6.cell.occupation", MarkerStyle("circle", "#69A9C4FF")),
        "district" => ("marker", "tessera.civ6.cell.occupation", MarkerStyle("circle", "#A984D2FF")),
        "wonder" => ("marker", "tessera.civ6.cell.occupation", MarkerStyle("diamond", "#E1C66FFF")),
        "city" => ("marker", "tessera.civ6.cell.occupation", MarkerStyle("pin", "#E26B5BFF")),
        _ => throw new ExtractionException("input-content-category-invalid", "内容类别没有对应的渲染语义。", category),
    };

    private static object CellStyle(string fillColor, double fillOpacity) => new { fillColor, fillOpacity };

    private static object MarkerStyle(string shape, string color) => new
    {
        shape,
        color,
        opacity = 1,
        displaySize = 18,
        rotation = 0,
    };

    private static object EmptyAttributeSchema() => new
    {
        type = "object",
        properties = EmptyObject(),
        required = Array.Empty<string>(),
        additionalProperties = false,
    };

    private static object[] ModuleLayers() =>
    [
        Layer("cell.terrain", "terrain", 200, ["cell-style"], ["cell"]),
        Layer("cell.feature", "feature", 300, ["cell-style", "domain-object"], ["cell"]),
        Layer("cell.resource", "resource", 400, ["domain-object", "marker"], ["cell"]),
        Layer("edge.river", "river", 1200, ["edge-style"], ["edge"]),
        Layer("edge.cliff", "cliff", 1250, ["edge-style"], ["edge"]),
        Layer("cell.route", "route", 2100, ["cell-style"], ["cell"]),
        Layer("cell.occupation", "occupation", 2200, ["marker", "domain-object"], ["cell"]),
        Layer("plan.validation", "validation", 3200, ["marker", "text"], ["cell", "map-point"]),
        Layer("annotation.yield", "yield", 4100, ["text"], ["cell", "map-point"]),
    ];

    private static object Layer(string id, string localeId, int zIndex, string[] primitives, string[] anchors) => new
    {
        layerId = $"tessera.civ6.{id}",
        nameKey = Key($"layer.{localeId}"),
        zIndex,
        allowedPrimitives = primitives,
        allowedAnchors = anchors,
        defaultVisible = true,
        defaultLocked = false,
        defaultOpacity = 1,
        extensions = EmptyObject(),
    };

    private static Dictionary<string, object?> EmptyObject() => new(StringComparer.Ordinal);

    private static object Key(string key) => new { kind = "key", key };

    private static string ResolveText(IReadOnlyDictionary<string, string> text, string key) =>
        text.TryGetValue(key, out var value) ? value : key;

    private static string CategoryId(string category) => $"tessera.civ6:category.{category}";

    private static string ElementId(Civ6ContentDefinition value) => $"tessera.civ6:object.{ElementSlug(value)}";

    private static string ElementSlug(Civ6ContentDefinition value) => $"{value.Category}.{Slug(value.Id)}";

    private static string Slug(string value) => value.ToLowerInvariant().Replace('_', '-');

    private static byte[] JsonBytes<T>(T value) => JsonSerializer.SerializeToUtf8Bytes(value, JsonOptions);

    private static void EnsureSemVer(string value, string fieldPath)
    {
        if (!SemVerPattern().IsMatch(value))
        {
            throw new ExtractionException("version-invalid", "版本必须是严格 SemVer。", fieldPath);
        }
    }

    [GeneratedRegex("^(0|[1-9]\\d*)\\.(0|[1-9]\\d*)\\.(0|[1-9]\\d*)(?:-[0-9A-Za-z-]+(?:\\.[0-9A-Za-z-]+)*)?(?:\\+[0-9A-Za-z-]+(?:\\.[0-9A-Za-z-]+)*)?$", RegexOptions.CultureInvariant)]
    private static partial Regex SemVerPattern();

    private sealed record ElementJson(
        string ElementId,
        string CategoryId,
        object NameKey,
        object DescriptionKey,
        string Primitive,
        string LayerId,
        string[] Anchors,
        string[] SupportedGrids,
        object DefaultStyle,
        object AttributeSchema,
        object[] Occupancy,
        string[] ConstraintIds,
        string[] ResourceIds,
        SourceJson Source,
        object? Group,
        Dictionary<string, object?> Extensions);

    private sealed record SourceJson(
        string SourceId,
        string RulesetId,
        string ContentVersion,
        string RetrievedAt,
        Dictionary<string, object?> Extensions);
}
