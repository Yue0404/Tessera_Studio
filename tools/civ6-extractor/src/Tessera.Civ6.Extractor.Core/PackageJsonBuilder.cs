using System.Globalization;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Text.RegularExpressions;

namespace Tessera.Civ6.Extractor.Core;

internal sealed record GeneratedPackage(IReadOnlyDictionary<string, byte[]> Files, int ElementCount, int ResourceCount);

internal static partial class PackageJsonBuilder
{
    private const string ModuleId = "tessera.civ6";
    private const char NamespaceSeparator = (char)58;
    private static readonly string[] Authors = ["Tessera Studio"];
    private static readonly string[] SupportedGrids = ["hex-pointy"];
    private static readonly string[] ElementFiles = ["elements/content.json"];
    private static readonly string[] ConstraintFiles = ["constraints/content.json"];
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
        IReadOnlyList<SourceFileFact> sourceFiles,
        IReadOnlyList<GeneratedArtAsset> artAssets)
    {
        EnsureSemVer(moduleVersion, "moduleVersion");
        EnsureSemVer(generatorVersion, "generatorVersion");
        var timestamp = generatedAt.ToUniversalTime().ToString("O");
        var assetsByContent = artAssets.ToDictionary(value => value.ContentId, StringComparer.Ordinal);
        var definitions = source.Objects.Concat(CoreDefinitions()).ToArray();
        var elements = definitions.Select(value => BuildElement(value, source, timestamp, assetsByContent))
            .OrderBy(value => value.ElementId, StringComparer.Ordinal)
            .ToArray();
        var constraints = BuildConstraints(elements, source.RulesetId);
        var locale = BuildLocale(source, definitions);
        var files = new SortedDictionary<string, byte[]>(StringComparer.Ordinal)
        {
            ["locales/zh-CN.json"] = JsonBytes(locale),
            ["elements/content.json"] = JsonBytes(elements),
            ["constraints/content.json"] = JsonBytes(constraints),
        };
        foreach (var asset in artAssets.OrderBy(value => value.PackagePath, StringComparer.Ordinal))
        {
            files.Add(asset.PackagePath, asset.Bytes);
        }

        var categories = definitions
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
            constraintFiles = ConstraintFiles,
            migrationFiles = Array.Empty<string>(),
            catalogManifestPath = "catalog/content-catalog.json",
            defaultLanguage = "zh-CN",
            locales = new Dictionary<string, string> { ["zh-CN"] = "locales/zh-CN.json" },
            resources = artAssets.OrderBy(value => value.ResourceId, StringComparer.Ordinal).Select(value => new
            {
                resourceId = value.ResourceId,
                path = value.PackagePath,
                mimeType = value.MimeType,
                bytes = value.Bytes.Length,
                license = new
                {
                    status = "local-only",
                    sourceName = "Sid Meier's Civilization VI formal game files",
                },
            }),
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

        return new GeneratedPackage(files, elements.Length, artAssets.Count);
    }

    private static SortedDictionary<string, string> BuildLocale(
        Civ6SourceInfo source,
        IReadOnlyList<Civ6ContentDefinition> definitions)
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
            ["category.river"] = "河流",
            ["category.cliff"] = "悬崖",
            ["category.yield"] = "收益",
            ["category.planning"] = "规划状态",
            ["constraint.slot.terrain"] = "同一地块存在多个地形记录。",
            ["constraint.slot.feature"] = "同一地块存在多个地貌记录。",
            ["constraint.slot.resource"] = "同一地块存在多个资源记录。",
            ["constraint.slot.occupation"] = "同一地块存在多个主要占用对象。",
            ["constraint.slot.route"] = "同一地块存在多个路线状态。",
            ["constraint.slot.river"] = "同一条边存在多个河流段记录。",
            ["constraint.slot.cliff"] = "同一条边存在多个悬崖段记录。",
            ["constraint.slot.plan-state"] = "同一锚点存在多个规划状态。",
            ["constraint.slot.yield"] = "同一地块存在重复的同类收益标注。",
            ["constraint.static-yield"] = "该收益是目录提供的静态规划值，不代表完整游戏结算结果。",
            ["constraint.plan-state"] = "规划状态仅用于提示，不会自动删除或移动对象。",
        };
        foreach (var value in definitions)
        {
            var slug = ElementSlug(value);
            locale[$"element.{slug}.name"] = ResolveDefinitionText(source, value, description: false);
            locale[$"element.{slug}.description"] = ResolveDefinitionText(source, value, description: true);
        }

        return locale;
    }

    private static ElementJson BuildElement(
        Civ6ContentDefinition value,
        Civ6SourceInfo source,
        string timestamp,
        Dictionary<string, GeneratedArtAsset> artAssets)
    {
        var slug = ElementSlug(value);
        var (primitive, layerId, style) = VisualSemantics(value);
        artAssets.TryGetValue(value.Id, out var asset);
        var occupancy = Occupancy(value);
        return new(
            ElementId(value),
            CategoryId(value.Category),
            Key($"element.{slug}.name"),
            Key($"element.{slug}.description"),
            primitive,
            layerId,
            Anchors(value),
            SupportedGrids,
            style,
            AttributeSchema(value),
            occupancy,
            ConstraintIds(value, occupancy),
            asset is null ? [] : [asset.ResourceId],
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
            Group(value),
            asset is null
                ? new Dictionary<string, object?>(StringComparer.Ordinal)
                {
                    ["generatedPlaceholder"] = true,
                    ["hasExtractedArt"] = false,
                }
                : new Dictionary<string, object?>(StringComparer.Ordinal)
                {
                    ["generatedPlaceholder"] = false,
                    ["hasExtractedArt"] = true,
                    ["assetWidth"] = asset.Width,
                    ["assetHeight"] = asset.Height,
                    ["assetSourceEntry"] = asset.SourceEntryName,
                });
    }

    private static (string Primitive, string LayerId, object Style) VisualSemantics(
        Civ6ContentDefinition value)
    {
        if (IsMultiCellNaturalWonder(value))
        {
            return (
                "domain-object",
                "tessera.civ6.cell.feature",
                new { representation = "marker", style = MarkerStyle("diamond", "#4CA77BFF") });
        }

        return value.Category switch
        {
            "terrain" => ("cell-style", "tessera.civ6.cell.terrain", CellStyle("#748F58FF", 1)),
            "feature" => ("cell-style", "tessera.civ6.cell.feature", CellStyle("#3F7650FF", 0.82)),
            "route" => ("cell-style", "tessera.civ6.cell.route", CellStyle("#A97B50FF", 0.72)),
            "resource" => ("marker", "tessera.civ6.cell.resource", MarkerStyle("diamond", "#D6AF4BFF")),
            "improvement" => ("marker", "tessera.civ6.cell.occupation", MarkerStyle("circle", "#69A9C4FF")),
            "district" => ("marker", "tessera.civ6.cell.occupation", MarkerStyle("circle", "#A984D2FF")),
            "wonder" => ("marker", "tessera.civ6.cell.occupation", MarkerStyle("diamond", "#E1C66FFF")),
            "city" => ("marker", "tessera.civ6.cell.occupation", MarkerStyle("pin", "#E26B5BFF")),
            "river" => ("edge-style", "tessera.civ6.edge.river", EdgeStyle("#4B8ED6FF", 3)),
            "cliff" => ("edge-style", "tessera.civ6.edge.cliff", EdgeStyle("#705A49FF", 4)),
            "yield" => ("text", "tessera.civ6.annotation.yield", TextStyle()),
            "planning" => ("marker", "tessera.civ6.plan.validation", MarkerStyle("diamond", "#D47AC9FF")),
            _ => throw new ExtractionException(
                "input-content-category-invalid",
                "内容类别没有对应的渲染语义。",
                value.Category),
        };
    }

    private static object CellStyle(string fillColor, double fillOpacity) => new { fillColor, fillOpacity };

    private static object EdgeStyle(string strokeColor, double strokeWidth) => new
    {
        strokeColor,
        strokeOpacity = 1,
        strokeWidth,
        lineCap = "round",
    };

    private static object MarkerStyle(string shape, string color) => new
    {
        shape,
        color,
        opacity = 1,
        displaySize = 18,
        rotation = 0,
    };

    private static object TextStyle() => new
    {
        color = "#F4F1E8FF",
        opacity = 1,
        fontSize = 16,
        fontWeight = "bold",
        align = "center",
        rotation = 0,
        backgroundColor = "#20242CCC",
        wrapWidth = 96,
    };

    private static object AttributeSchema(Civ6ContentDefinition value)
    {
        return value.Category switch
        {
            "city" => Schema(
                Properties(
                    ("name", StringProperty("未命名城市", 0, 256)),
                    ("planState", EnumProperty("candidate", PlanStates())),
                    ("notes", StringProperty(string.Empty, 0, 2048)),
                    ("civilization", StringProperty(string.Empty, 0, 128)),
                    ("player", StringProperty(string.Empty, 0, 128))),
                "name", "planState", "notes"),
            "district" => PlanObjectSchema("districtType", value.Id),
            "improvement" => PlanObjectSchema("improvementType", value.Id),
            "wonder" => PlanObjectSchema("wonderType", value.Id),
            "terrain" => Schema(
                Properties(
                    ("terrainType", StringProperty(value.Id)),
                    ("isWater", BooleanProperty(IsTrue(value.Attributes.GetValueOrDefault("Water")))),
                    ("isMountain", BooleanProperty(IsTrue(value.Attributes.GetValueOrDefault("Mountain")))),
                    ("isHills", BooleanProperty(IsTrue(value.Attributes.GetValueOrDefault("Hills"))))),
                "terrainType", "isWater", "isMountain", "isHills"),
            "feature" => Schema(
                Properties(
                    ("featureType", StringProperty(value.Id)),
                    ("isNaturalWonder", BooleanProperty(IsTrue(
                        value.Attributes.GetValueOrDefault("NaturalWonder")))),
                    ("recommendedMemberCount", IntegerProperty(
                        IsTrue(value.Attributes.GetValueOrDefault("NaturalWonder"))
                            ? Math.Clamp(MemberCount(value), 2, 64)
                            : 2,
                        2,
                        64))),
                IsMultiCellNaturalWonder(value)
                    ? ["featureType", "isNaturalWonder", "recommendedMemberCount"]
                    : ["featureType", "isNaturalWonder"]),
            "resource" => Schema(
                Properties(
                    ("resourceType", StringProperty(value.Id)),
                    ("resourceClass", StringProperty(
                        value.Attributes.GetValueOrDefault("ResourceClassType") ?? "unknown")),
                    ("visibility", EnumProperty("visible", ["visible", "revealed", "hidden"]))),
                "resourceType", "resourceClass", "visibility"),
            "route" => Schema(
                Properties(
                    ("routeType", StringProperty(value.Id)),
                    ("routeState", EnumProperty("planned", ["existing", "planned"]))),
                "routeType", "routeState"),
            "river" or "cliff" => Schema(
                Properties(
                    ("edgeFeatureType", StringProperty(value.Id)),
                    ("groupId", StringProperty(string.Empty, 0, 128)),
                    ("name", StringProperty(string.Empty, 0, 256))),
                "edgeFeatureType"),
            "yield" => Schema(
                Properties(
                    ("text", StringProperty(YieldText(value.Id), 1, 256)),
                    ("yieldType", StringProperty(value.Id)),
                    ("amount", NumberProperty(1, -1000, 1000)),
                    ("ruleId", StringProperty("tessera.civ6:rule.static-yield")),
                    ("severity", EnumProperty("info", ["error", "warning", "info"])),
                    ("calculationVersion", StringProperty("static-v1"))),
                "text", "yieldType", "amount", "ruleId", "severity", "calculationVersion"),
            "planning" => Schema(
                Properties(
                    ("planState", EnumProperty(PlanState(value.Id), PlanStates())),
                    ("ruleId", StringProperty("tessera.civ6:rule.plan-state")),
                    ("severity", EnumProperty("info", ["error", "warning", "info"])),
                    ("calculationVersion", StringProperty("planning-v1"))),
                "planState", "ruleId", "severity", "calculationVersion"),
            _ => throw new ExtractionException(
                "input-content-category-invalid",
                "内容类别没有属性语义。",
                value.Category),
        };
    }

    private static object PlanObjectSchema(string typeProperty, string typeValue) => Schema(
        Properties(
            (typeProperty, StringProperty(typeValue)),
            ("planState", EnumProperty("candidate", PlanStates())),
            ("notes", StringProperty(string.Empty, 0, 2048))),
        typeProperty, "planState", "notes");

    private static object Schema(
        IReadOnlyDictionary<string, object> properties,
        params string[] required) => new
        {
            type = "object",
            properties,
            required,
            additionalProperties = false,
        };

    private static Dictionary<string, object> Properties(
        params (string Name, object Schema)[] values) =>
        values.ToDictionary(value => value.Name, value => value.Schema, StringComparer.Ordinal);

    private static object StringProperty(
        string defaultValue,
        int minLength = 1,
        int maxLength = 128) => new
        {
            type = "string",
            minLength,
            maxLength,
            @default = defaultValue,
        };

    private static object EnumProperty(string defaultValue, string[] values) => new
    {
        type = "string",
        minLength = 1,
        maxLength = 128,
        @enum = values,
        @default = defaultValue,
    };

    private static object BooleanProperty(bool defaultValue) => new
    {
        type = "boolean",
        @default = defaultValue,
    };

    private static object IntegerProperty(int defaultValue, int minimum, int maximum) => new
    {
        type = "integer",
        minimum,
        maximum,
        @default = defaultValue,
    };

    private static object NumberProperty(double defaultValue, double minimum, double maximum) => new
    {
        type = "number",
        minimum,
        maximum,
        @default = defaultValue,
    };

    private static string[] Anchors(Civ6ContentDefinition value) =>
        value.Category is "river" or "cliff" ? ["edge"] : ["cell"];

    private static OccupancyJson[] Occupancy(Civ6ContentDefinition value)
    {
        var (slot, anchor, conflict) = value.Category switch
        {
            "terrain" => ("terrain", "cell", "warning"),
            "feature" => ("feature", "cell", "warning"),
            "resource" => ("resource", "cell", "warning"),
            "improvement" or "district" or "wonder" or "city" =>
                ("occupation", "cell", "error"),
            "route" => ("route", "cell", "warning"),
            "river" => ("river", "edge", "warning"),
            "cliff" => ("cliff", "edge", "warning"),
            "planning" => ("plan-state", "cell", "warning"),
            "yield" => ($"yield.{Slug(value.Id)}", "cell", "warning"),
            _ => throw new ExtractionException(
                "input-content-category-invalid",
                "内容类别没有占用语义。",
                value.Category),
        };
        return
        [
            new($"{ModuleId}:{slot}", anchor, 0, 1, conflict, EmptyObject()),
        ];
    }

    private static string[] ConstraintIds(
        Civ6ContentDefinition value,
        IReadOnlyList<OccupancyJson> occupancy)
    {
        var ids = new List<string>
        {
            SlotConstraintId(occupancy[0].SlotId),
        };
        if (value.Category == "yield")
        {
            ids.Add($"{ModuleId}:constraint.static-yield");
        }
        if (value.Category is "city" or "district" or "improvement" or "wonder" or "planning")
        {
            ids.Add($"{ModuleId}:constraint.plan-state");
        }

        return ids.ToArray();
    }

    private static object[] BuildConstraints(
        IReadOnlyList<ElementJson> elements,
        string rulesetVersion)
    {
        var constraints = new List<object>();
        foreach (var group in elements
                     .GroupBy(value => value.Occupancy[0].SlotId, StringComparer.Ordinal)
                     .OrderBy(value => value.Key, StringComparer.Ordinal))
        {
            var slotName = group.Key[(group.Key.IndexOf(NamespaceSeparator) + 1)..];
            constraints.Add(new
            {
                constraintId = SlotConstraintId(group.Key),
                severity = slotName == "occupation" ? "error" : "warning",
                messageKey = Key($"constraint.slot.{SlotMessageKey(slotName)}"),
                appliesTo = group.Select(value => value.ElementId)
                    .OrderBy(value => value, StringComparer.Ordinal)
                    .ToArray(),
                maxRadius = 0,
                rulesetVersion,
                condition = (object)new
                {
                    op = "occupancy-count",
                    slotId = group.Key,
                    min = 2,
                    max = 65536,
                },
                extensions = EmptyObject(),
            });
        }

        constraints.Add(new
        {
            constraintId = $"{ModuleId}:constraint.static-yield",
            severity = "info",
            messageKey = Key("constraint.static-yield"),
            appliesTo = ElementsInCategories(elements, "yield"),
            maxRadius = 0,
            rulesetVersion,
            condition = (object)new { op = "grid-is", grids = SupportedGrids },
            extensions = EmptyObject(),
        });
        constraints.Add(new
        {
            constraintId = $"{ModuleId}:constraint.plan-state",
            severity = "info",
            messageKey = Key("constraint.plan-state"),
            appliesTo = ElementsInCategories(
                elements,
                "city", "district", "improvement", "wonder", "planning"),
            maxRadius = 0,
            rulesetVersion,
            condition = (object)new { op = "grid-is", grids = SupportedGrids },
            extensions = EmptyObject(),
        });
        return constraints.OrderBy(
            value => JsonSerializer.Serialize(value, JsonOptions),
            StringComparer.Ordinal).ToArray();
    }

    private static string[] ElementsInCategories(
        IReadOnlyList<ElementJson> elements,
        params string[] categories)
    {
        var ids = categories.Select(CategoryId).ToHashSet(StringComparer.Ordinal);
        return elements.Where(value => ids.Contains(value.CategoryId))
            .Select(value => value.ElementId)
            .OrderBy(value => value, StringComparer.Ordinal)
            .ToArray();
    }

    private static string SlotConstraintId(string slotId) =>
        $"{ModuleId}:constraint.slot.{slotId[(slotId.IndexOf(NamespaceSeparator) + 1)..]}";

    private static string SlotMessageKey(string slotName) =>
        slotName.StartsWith("yield.", StringComparison.Ordinal) ? "yield" : slotName;

    private static object? Group(Civ6ContentDefinition value)
    {
        if (!IsMultiCellNaturalWonder(value))
        {
            return null;
        }

        return new
        {
            minMembers = 2,
            maxMembers = 64,
            connectivity = "edge",
            memberRules = new[]
            {
                "edge-connected",
                $"recommended-member-count:{MemberCount(value)}",
            },
            extensions = EmptyObject(),
        };
    }

    private static IEnumerable<Civ6ContentDefinition> CoreDefinitions()
    {
        yield return CoreDefinition("EDGE_RIVER", "river");
        yield return CoreDefinition("EDGE_CLIFF", "cliff");
        foreach (var id in new[]
                 {
                     "YIELD_FOOD",
                     "YIELD_PRODUCTION",
                     "YIELD_GOLD",
                     "YIELD_SCIENCE",
                     "YIELD_CULTURE",
                     "YIELD_FAITH",
                 })
        {
            yield return CoreDefinition(id, "yield");
        }
        foreach (var id in new[]
                 {
                     "PLAN_CANDIDATE",
                     "PLAN_PLANNED",
                     "PLAN_CONFIRMED",
                     "PLAN_EXCLUDED",
                 })
        {
            yield return CoreDefinition(id, "planning");
        }
    }

    private static Civ6ContentDefinition CoreDefinition(string id, string category) => new(
        id,
        category,
        $"LOC_TESSERA_CIV6_{id}_NAME",
        $"LOC_TESSERA_CIV6_{id}_DESCRIPTION",
        "generated/core-definitions-v1",
        new Dictionary<string, string>(StringComparer.Ordinal));

    private static string ResolveDefinitionText(
        Civ6SourceInfo source,
        Civ6ContentDefinition value,
        bool description)
    {
        var coreText = (value.Id, description) switch
        {
            ("EDGE_RIVER", false) => "河流段",
            ("EDGE_RIVER", true) => "沿项目边记录的河流要素，可与悬崖和基础边界共存。",
            ("EDGE_CLIFF", false) => "悬崖段",
            ("EDGE_CLIFF", true) => "沿项目边记录的悬崖要素，可与河流和基础边界共存。",
            ("YIELD_FOOD", false) => "食物收益",
            ("YIELD_FOOD", true) => "静态食物收益规划标注，不包含完整游戏状态计算。",
            ("YIELD_PRODUCTION", false) => "生产力收益",
            ("YIELD_PRODUCTION", true) => "静态生产力收益规划标注，不包含完整游戏状态计算。",
            ("YIELD_GOLD", false) => "金币收益",
            ("YIELD_GOLD", true) => "静态金币收益规划标注，不包含完整游戏状态计算。",
            ("YIELD_SCIENCE", false) => "科技值收益",
            ("YIELD_SCIENCE", true) => "静态科技值收益规划标注，不包含完整游戏状态计算。",
            ("YIELD_CULTURE", false) => "文化值收益",
            ("YIELD_CULTURE", true) => "静态文化值收益规划标注，不包含完整游戏状态计算。",
            ("YIELD_FAITH", false) => "信仰值收益",
            ("YIELD_FAITH", true) => "静态信仰值收益规划标注，不包含完整游戏状态计算。",
            ("PLAN_CANDIDATE", false) => "候选",
            ("PLAN_CANDIDATE", true) => "把对象标记为仍在探索的候选方案。",
            ("PLAN_PLANNED", false) => "已计划",
            ("PLAN_PLANNED", true) => "把对象标记为计划采用但尚未确认。",
            ("PLAN_CONFIRMED", false) => "已确认",
            ("PLAN_CONFIRMED", true) => "把对象标记为已确认方案。",
            ("PLAN_EXCLUDED", false) => "已排除",
            ("PLAN_EXCLUDED", true) => "把对象标记为不采用但仍保留在工程中。",
            _ => null,
        };
        if (coreText is not null)
        {
            return coreText;
        }

        var key = description ? value.DescriptionKey ?? value.NameKey : value.NameKey;
        return ResolveText(source.ChineseText, key);
    }

    private static bool IsMultiCellNaturalWonder(Civ6ContentDefinition value) =>
        value.Category == "feature" &&
        IsTrue(value.Attributes.GetValueOrDefault("NaturalWonder")) &&
        MemberCount(value) >= 2;

    private static int MemberCount(Civ6ContentDefinition value)
    {
        if (!int.TryParse(
                value.Attributes.GetValueOrDefault("Tiles"),
                NumberStyles.Integer,
                CultureInfo.InvariantCulture,
                out var count))
        {
            return 1;
        }
        if (count is < 1 or > 64)
        {
            throw new ExtractionException(
                "input-content-group-size-invalid",
                "自然奇观成员数必须在 1–64 之间，多格域组必须在 2–64 之间。",
                value.SourceRelativePath);
        }

        return count;
    }

    private static bool IsTrue(string? value) =>
        value is not null &&
        (value.Equals("true", StringComparison.OrdinalIgnoreCase) || value == "1");

    private static string[] PlanStates() => ["candidate", "planned", "confirmed", "excluded"];

    private static string PlanState(string id) => id switch
    {
        "PLAN_CANDIDATE" => "candidate",
        "PLAN_PLANNED" => "planned",
        "PLAN_CONFIRMED" => "confirmed",
        "PLAN_EXCLUDED" => "excluded",
        _ => throw new ExtractionException(
            "input-content-id-invalid",
            "未知的规划状态核心定义。",
            id),
    };

    private static string YieldText(string id) => id switch
    {
        "YIELD_FOOD" => "+1 食物",
        "YIELD_PRODUCTION" => "+1 生产力",
        "YIELD_GOLD" => "+1 金币",
        "YIELD_SCIENCE" => "+1 科技值",
        "YIELD_CULTURE" => "+1 文化值",
        "YIELD_FAITH" => "+1 信仰值",
        _ => throw new ExtractionException(
            "input-content-id-invalid",
            "未知的收益核心定义。",
            id),
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
        OccupancyJson[] Occupancy,
        string[] ConstraintIds,
        string[] ResourceIds,
        SourceJson Source,
        object? Group,
        Dictionary<string, object?> Extensions);

    private sealed record OccupancyJson(
        string SlotId,
        string Anchor,
        int Min,
        int Max,
        string Conflict,
        Dictionary<string, object?> Extensions);

    private sealed record SourceJson(
        string SourceId,
        string RulesetId,
        string ContentVersion,
        string RetrievedAt,
        Dictionary<string, object?> Extensions);
}
