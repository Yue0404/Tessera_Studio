using System.Text;
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
    private static readonly string[] ElementFiles = ["elements/occupation.json"];
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
        IReadOnlyDictionary<string, ArtDefAsset> artAssets,
        IReadOnlyDictionary<string, PngImage> images,
        string moduleVersion,
        string generatorVersion,
        DateTimeOffset generatedAt,
        IReadOnlyList<SourceFileFact> sourceFiles)
    {
        EnsureSemVer(moduleVersion, "moduleVersion");
        EnsureSemVer(generatorVersion, "generatorVersion");
        var timestamp = generatedAt.ToUniversalTime().ToString("O");
        var elements = source.Objects.Select(value => BuildElement(value, source, artAssets, timestamp)).ToArray();
        var locale = new SortedDictionary<string, string>(StringComparer.Ordinal)
        {
            ["module.name"] = "文明 6",
            ["module.description"] = "由本机文明 6 正式游戏文件生成的地图规划模块。",
            ["layer.occupation"] = "占用物",
            ["category.city"] = "城市与区域",
        };
        foreach (var (key, text) in new[]
        {
            ("layer.terrain", "地形"), ("layer.feature", "地貌"), ("layer.resource", "资源"),
            ("layer.river", "河流"), ("layer.cliff", "悬崖"), ("layer.route", "道路"),
            ("layer.validation", "规划校验"), ("layer.yield", "产出"),
        })
        {
            locale[key] = text;
        }
        foreach (var value in source.Objects)
        {
            var slug = Slug(value.Id);
            locale[$"element.{slug}.name"] = value.Name;
            locale[$"element.{slug}.description"] = value.Description;
        }
        foreach (var category in source.Objects.Select(value => value.Category).Distinct(StringComparer.Ordinal))
        {
            locale[$"category.{Slug(category)}"] = category;
        }

        var files = new SortedDictionary<string, byte[]>(StringComparer.Ordinal);
        foreach (var (relativePath, image) in images.OrderBy(item => item.Key, StringComparer.Ordinal))
        {
            if (!files.TryAdd(OutputImagePath(relativePath), image.Bytes))
            {
                throw new ExtractionException("output-path-collision", "两个来源图片会映射到同一输出路径。", relativePath);
            }
        }

        var mapping = source.Objects.Select(value =>
        {
            var asset = artAssets[value.ArtDefId];
            var image = images[asset.ImagePath];
            return new
            {
                elementId = ElementId(value.Id),
                sourceObjectId = value.Id,
                artDefId = value.ArtDefId,
                resourceId = ResourceId(value.Id),
                width = image.Width,
                height = image.Height,
                extensions = EmptyObject(),
            };
        }).ToArray();
        files["assets/mappings/artdef-map.json"] = JsonBytes(mapping);
        files["locales/zh-CN.json"] = JsonBytes(locale);
        files["elements/occupation.json"] = JsonBytes(elements);

        var categories = source.Objects
            .GroupBy(value => value.Category, StringComparer.Ordinal)
            .OrderBy(group => group.Key, StringComparer.Ordinal)
            .Select(group => new
            {
                categoryId = CategoryId(group.Key),
                nameKey = Key($"category.{Slug(group.Key)}"),
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

        var resources = source.Objects.Select(value =>
        {
            var asset = artAssets[value.ArtDefId];
            var image = images[asset.ImagePath];
            return Resource(ResourceId(value.Id), OutputImagePath(asset.ImagePath), "image/png", image.Bytes.LongLength);
        }).Append(Resource(
            "tessera.civ6:map.artdef",
            "assets/mappings/artdef-map.json",
            "application/json",
            files["assets/mappings/artdef-map.json"].LongLength))
        .OrderBy(value => value.ResourceId, StringComparer.Ordinal)
        .ToArray();

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
            resources,
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

        return new GeneratedPackage(files, elements.Length, resources.Length);
    }

    private static ElementJson BuildElement(
        Civ6ObjectDefinition value,
        Civ6SourceInfo source,
        IReadOnlyDictionary<string, ArtDefAsset> artAssets,
        string timestamp)
    {
        if (!artAssets.TryGetValue(value.ArtDefId, out _))
        {
            throw new ExtractionException("input-artdef-reference-missing", "规则对象引用了不存在的 ArtDef 资产。", value.ArtDefId);
        }

        var slug = Slug(value.Id);
        return new ElementJson(
            ElementId(value.Id),
            CategoryId(value.Category),
            Key($"element.{slug}.name"),
            Key($"element.{slug}.description"),
            "marker",
            "tessera.civ6.cell.occupation",
            ["cell"],
            ["hex-pointy"],
            new { shape = "circle", resourceId = ResourceId(value.Id), color = "#FFFFFFFF", opacity = 1, displaySize = 32, rotation = 0 },
            new { type = "object", properties = EmptyObject(), required = Array.Empty<string>(), additionalProperties = false },
            Array.Empty<object>(),
            Array.Empty<string>(),
            [ResourceId(value.Id)],
            new SourceJson($"tessera.civ6:source.{slug}", source.RulesetId, source.SourceBuild, timestamp),
            null,
            EmptyObject());
    }

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

    private static ResourceJson Resource(string id, string path, string mimeType, long bytes) =>
        new(id, path, mimeType, bytes, new { status = "local-only", sourceName = "Sid Meier's Civilization VI" }, EmptyObject());

    private static Dictionary<string, object?> EmptyObject() => new(StringComparer.Ordinal);

    private static object Key(string key) => new { kind = "key", key };

    private static string CategoryId(string category) => $"tessera.civ6:category.{Slug(category)}";

    private static string ElementId(string sourceId) => $"tessera.civ6:object.{Slug(sourceId)}";

    private static string ResourceId(string sourceId) => $"tessera.civ6:asset.{Slug(sourceId)}";

    private static string Slug(string value) => value.ToLowerInvariant().Replace('_', '-');

    private static string OutputImagePath(string sourceRelativePath)
    {
        var withoutExtension = sourceRelativePath.Replace('\\', '/');
        withoutExtension = withoutExtension[..^Path.GetExtension(withoutExtension).Length];
        var segments = withoutExtension.Split('/', StringSplitOptions.RemoveEmptyEntries)
            .Select(segment => OutputPathSegmentPattern().Replace(segment.ToLowerInvariant(), "-").Trim('-'))
            .ToArray();
        if (segments.Length == 0 || segments.Any(string.IsNullOrEmpty))
        {
            throw new ExtractionException("input-artdef-path-invalid", "ArtDef 图片路径无法安全映射到输出。", sourceRelativePath);
        }

        return $"assets/{string.Join('/', segments)}.png";
    }

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

    [GeneratedRegex("[^a-z0-9-]+", RegexOptions.CultureInvariant)]
    private static partial Regex OutputPathSegmentPattern();

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

    private sealed record SourceJson(string SourceId, string RulesetId, string ContentVersion, string RetrievedAt);

    private sealed record ResourceJson(
        string ResourceId,
        string Path,
        string MimeType,
        long Bytes,
        object License,
        Dictionary<string, object?> Extensions);
}
