using System.Globalization;
using System.Xml.Linq;

namespace Tessera.Civ6.Extractor.Core;

/// <summary>按正式 IconDefinitions 与 IconTextureAtlases 表补齐仍为空的内容预览。</summary>
internal static class Civ6UiIconExtractor
{
    private const int MaximumIconSize = 256;
    private const int MaximumAssets = 2048;
    private const long MaximumTotalAssetBytes = 512L * 1024 * 1024;

    public static async Task<GeneratedArtExtraction> FillPlaceholdersAsync(
        SafeInputRoot input,
        IReadOnlyList<Civ6ContentDefinition> definitions,
        GeneratedArtExtraction strategic,
        CancellationToken cancellationToken)
    {
        var catalog = await LoadCatalogAsync(input, cancellationToken);
        var assets = strategic.Assets.ToList();
        var strategicIds = strategic.Assets.Select(value => value.ContentId)
            .ToHashSet(StringComparer.Ordinal);
        var uiIds = new HashSet<string>(StringComparer.Ordinal);
        var diagnostics = strategic.Diagnostics.ToList();
        var sources = strategic.SourceFiles.ToDictionary(value => value.RelativePath, StringComparer.Ordinal);
        foreach (var source in catalog.SourceFiles)
        {
            sources[source.RelativePath] = source;
        }

        var containers = new Dictionary<string, Civ6BlpContainer>(StringComparer.Ordinal);
        var decodedAtlases = new Dictionary<string, DecodedAtlas>(StringComparer.Ordinal);
        var unsupportedAtlases = new HashSet<string>(StringComparer.Ordinal);
        long totalBytes = strategic.Assets.Sum(value => (long)value.Bytes.Length);

        foreach (var definition in definitions.OrderBy(value => value.Id, StringComparer.Ordinal))
        {
            cancellationToken.ThrowIfCancellationRequested();
            if (strategicIds.Contains(definition.Id))
            {
                continue;
            }

            var iconName = $"ICON_{definition.Id}";
            var iconRows = catalog.Definitions.Values
                .Where(value => value.Name == iconName)
                .OrderBy(value => value.Atlas, StringComparer.Ordinal)
                .ToArray();
            if (iconRows.Length == 0)
            {
                diagnostics.Add(Placeholder(
                    "ui-icon-definition-missing",
                    "正式 IconDefinitions 没有该内容的精确图标行，保留预览占位。",
                    definition.Id));
                continue;
            }

            if (iconRows.Length != 1)
            {
                diagnostics.Add(Placeholder(
                    "ui-icon-definition-ambiguous",
                    "正式 IconDefinitions 对同一内容给出多个 atlas，未猜测选择。",
                    definition.Id));
                continue;
            }

            var icon = iconRows[0];
            var atlasRows = catalog.Atlases.Values
                .Where(value => value.Name == icon.Atlas && value.IconSize <= MaximumIconSize)
                .OrderByDescending(value => value.IconSize)
                .ThenBy(value => value.Filename, StringComparer.Ordinal)
                .ToArray();
            if (atlasRows.Length == 0)
            {
                diagnostics.Add(Placeholder(
                    "ui-icon-atlas-missing",
                    "正式 IconTextureAtlases 没有安全尺寸内的对应 atlas，保留预览占位。",
                    definition.Id));
                continue;
            }

            var atlas = atlasRows[0];
            var sameSize = atlasRows.Where(value => value.IconSize == atlas.IconSize).ToArray();
            if (sameSize.Length != 1)
            {
                diagnostics.Add(Placeholder(
                    "ui-icon-atlas-ambiguous",
                    "同一 atlas 与尺寸存在多个正式文件定义，未猜测选择。",
                    definition.Id));
                continue;
            }

            if (icon.Index < 0 || icon.Index >= checked(atlas.IconsPerRow * atlas.IconsPerColumn))
            {
                diagnostics.Add(Placeholder(
                    "ui-icon-index-out-of-range",
                    "正式图标索引超出 atlas 行列边界，保留预览占位。",
                    definition.Id));
                continue;
            }

            var containerPath = ResolveContainerPath(atlas.SourceRelativePath);
            if (!input.TryResolveExistingFile(containerPath, out _))
            {
                diagnostics.Add(Placeholder(
                    "ui-icon-container-missing",
                    "正式图标 atlas 的 UI/Icons.blp 容器缺失，保留预览占位。",
                    definition.Id));
                continue;
            }

            var entryName = NormalizeEntryName(atlas.Filename, atlas.SourceRelativePath);
            var cacheKey = $"{containerPath}\u001f{entryName}";
            if (unsupportedAtlases.Contains(cacheKey))
            {
                diagnostics.Add(Placeholder(
                    "asset-ui-packed-layout-unsupported",
                    "正式 UI atlas 使用尚未解码的 ForgeUI BC 打包布局，保留预览占位。",
                    definition.Id));
                continue;
            }

            if (!decodedAtlases.TryGetValue(cacheKey, out var decoded))
            {
                if (!containers.TryGetValue(containerPath, out var container))
                {
                    container = await Civ6BlpContainer.OpenAsync(input, containerPath, cancellationToken);
                    containers.Add(containerPath, container);
                    sources[containerPath] = new(
                        containerPath,
                        "tessera.civ6:source.ui-icon-container",
                        new FileInfo(input.ResolveExistingFile(containerPath)).Length);
                }

                Civ6BlpTexture texture;
                try
                {
                    texture = await container.ReadPackageTextureAsync(
                        entryName,
                        "UITexture",
                        cancellationToken);
                }
                catch (ExtractionException error)
                    when (error.Code == "asset-ui-packed-layout-unsupported")
                {
                    unsupportedAtlases.Add(cacheKey);
                    diagnostics.Add(Placeholder(
                        error.Code,
                        "正式 UI atlas 使用尚未解码的 ForgeUI BC 打包布局，保留预览占位。",
                        definition.Id));
                    continue;
                }

                decoded = new(
                    texture.Width,
                    texture.Height,
                    Civ6TexturePixelDecoder.DecodeFirstSlice(texture, cancellationToken));
                decodedAtlases.Add(cacheKey, decoded);
            }

            var rgba = Crop(decoded, atlas, icon.Index, definition.Id, cancellationToken);
            var png = PngEncoder.EncodeRgba(atlas.IconSize, atlas.IconSize, rgba);
            totalBytes = CheckedAdd(totalBytes, png.Length, definition.Id);
            if (assets.Count >= MaximumAssets || totalBytes > MaximumTotalAssetBytes)
            {
                throw new ExtractionException(
                    "asset-output-limit-exceeded",
                    "预览资源数量或总字节超过安全上限。",
                    definition.Id);
            }

            var slug = definition.Id.ToLowerInvariant().Replace('_', '-');
            assets.Add(new(
                definition.Id,
                $"tessera.civ6:asset.{definition.Category}.{slug}",
                $"assets/previews/{definition.Category}/{slug}.png",
                "image/png",
                atlas.IconSize,
                atlas.IconSize,
                containerPath,
                entryName,
                png));
            uiIds.Add(definition.Id);
        }

        var categories = definitions.GroupBy(value => value.Category, StringComparer.Ordinal)
            .OrderBy(group => group.Key, StringComparer.Ordinal)
            .Select(group =>
            {
                var strategicCount = group.Count(value => strategicIds.Contains(value.Id));
                var uiCount = group.Count(value => uiIds.Contains(value.Id));
                return new Civ6GeneratedArtCategoryCount(
                    group.Key,
                    group.Count(),
                    strategicCount + uiCount,
                    group.Count() - strategicCount - uiCount,
                    strategicCount,
                    uiCount);
            })
            .ToArray();
        return new(
            assets.OrderBy(value => value.ContentId, StringComparer.Ordinal).ToArray(),
            sources.Values.OrderBy(value => value.RelativePath, StringComparer.Ordinal).ToArray(),
            diagnostics.OrderBy(value => value.Code, StringComparer.Ordinal)
                .ThenBy(value => value.RelativePath, StringComparer.Ordinal)
                .ToArray(),
            categories,
            strategic.MaxReferenceDepth);
    }

    private static async Task<IconCatalog> LoadCatalogAsync(
        SafeInputRoot input,
        CancellationToken cancellationToken)
    {
        var atlases = new Dictionary<(string Name, int Size), MutableAtlas>();
        var definitions = new Dictionary<(string Name, string Atlas), MutableDefinition>();
        var sourceFiles = new List<SourceFileFact>();
        foreach (var relativePath in ExtractionLayout.IconTablePaths)
        {
            cancellationToken.ThrowIfCancellationRequested();
            var bytes = await input.ReadAllBytesAsync(relativePath, cancellationToken);
            sourceFiles.Add(new(
                relativePath,
                "tessera.civ6:source.ui-icon-table",
                bytes.LongLength));
            var root = SecureXml.Parse(bytes, relativePath).Root;
            if (root?.Name.LocalName != "GameInfo")
            {
                throw Invalid("正式图标 XML 根必须是 GameInfo。", relativePath);
            }

            ApplyAtlasOperations(root.Element("IconTextureAtlases"), relativePath, atlases);
            ApplyDefinitionOperations(root.Element("IconDefinitions"), relativePath, definitions);
        }

        return new(atlases, definitions, sourceFiles);
    }

    private static void ApplyAtlasOperations(
        XElement? table,
        string path,
        Dictionary<(string Name, int Size), MutableAtlas> rows)
    {
        if (table is null)
        {
            return;
        }

        foreach (var operation in table.Elements())
        {
            var kind = operation.Name.LocalName;
            if (kind is "Row" or "Replace")
            {
                var row = ParseAtlas(Values(operation), path);
                var key = (row.Name, row.IconSize);
                if (kind == "Row" && !rows.TryAdd(key, row))
                {
                    throw Invalid("IconTextureAtlases Row 主键重复；覆盖必须使用 Replace 或 Update。", $"{path}/{row.Name}/{row.IconSize}");
                }

                rows[key] = row;
            }
            else if (kind == "Update")
            {
                UpdateAtlases(operation, path, rows);
            }
            else if (kind == "Delete")
            {
                DeleteRows(operation, path, rows, AtlasValues);
            }
            else
            {
                throw Invalid("IconTextureAtlases 包含不支持的操作。", $"{path}/{kind}");
            }
        }
    }

    private static void ApplyDefinitionOperations(
        XElement? table,
        string path,
        Dictionary<(string Name, string Atlas), MutableDefinition> rows)
    {
        if (table is null)
        {
            return;
        }

        foreach (var operation in table.Elements())
        {
            var kind = operation.Name.LocalName;
            if (kind is "Row" or "Replace")
            {
                var row = ParseDefinition(Values(operation), path);
                var key = (row.Name, row.Atlas);
                if (kind == "Row" && !rows.TryAdd(key, row))
                {
                    throw Invalid("IconDefinitions Row 主键重复；覆盖必须使用 Replace 或 Update。", $"{path}/{row.Name}/{row.Atlas}");
                }

                rows[key] = row;
            }
            else if (kind == "Update")
            {
                UpdateDefinitions(operation, path, rows);
            }
            else if (kind == "Delete")
            {
                DeleteRows(operation, path, rows, DefinitionValues);
            }
            else
            {
                throw Invalid("IconDefinitions 包含不支持的操作。", $"{path}/{kind}");
            }
        }
    }

    private static void UpdateAtlases(
        XElement operation,
        string path,
        Dictionary<(string Name, int Size), MutableAtlas> rows)
    {
        var (where, set) = UpdateValues(operation, path);
        if (set.ContainsKey("Name") || set.ContainsKey("IconSize"))
        {
            throw Invalid("IconTextureAtlases Update 不能修改复合主键。", path);
        }

        var matches = rows.Where(value => Matches(AtlasValues(value.Value), where)).Select(value => value.Key).ToArray();
        RequireMatches(matches.Length, path);
        foreach (var key in matches)
        {
            var values = AtlasValues(rows[key]);
            foreach (var pair in set)
            {
                values[pair.Key] = pair.Value;
            }

            rows[key] = ParseAtlas(values, path);
        }
    }

    private static void UpdateDefinitions(
        XElement operation,
        string path,
        Dictionary<(string Name, string Atlas), MutableDefinition> rows)
    {
        var (where, set) = UpdateValues(operation, path);
        if (set.ContainsKey("Name") || set.ContainsKey("Atlas"))
        {
            throw Invalid("IconDefinitions Update 不能修改复合主键。", path);
        }

        var matches = rows.Where(value => Matches(DefinitionValues(value.Value), where))
            .Select(value => value.Key)
            .ToArray();
        RequireMatches(matches.Length, path);
        foreach (var key in matches)
        {
            var values = DefinitionValues(rows[key]);
            foreach (var pair in set)
            {
                values[pair.Key] = pair.Value;
            }

            rows[key] = ParseDefinition(values, path);
        }
    }

    private static void DeleteRows<TKey, TRow>(
        XElement operation,
        string path,
        Dictionary<TKey, TRow> rows,
        Func<TRow, Dictionary<string, string>> values)
        where TKey : notnull
    {
        var where = Values(operation.Element("Where") ?? operation);
        if (where.Count == 0)
        {
            throw Invalid("图标 Delete 缺少谓词。", path);
        }

        var matches = rows.Where(value => Matches(values(value.Value), where))
            .Select(value => value.Key)
            .ToArray();
        RequireMatches(matches.Length, path);
        foreach (var key in matches)
        {
            rows.Remove(key);
        }
    }

    private static (Dictionary<string, string> Where, Dictionary<string, string> Set) UpdateValues(
        XElement operation,
        string path)
    {
        var where = Values(operation.Element("Where")
            ?? throw Invalid("图标 Update 缺少 Where。", path));
        var set = Values(operation.Element("Set")
            ?? throw Invalid("图标 Update 缺少 Set。", path));
        if (where.Count == 0 || set.Count == 0)
        {
            throw Invalid("图标 Update 谓词或修改字段为空。", path);
        }

        return (where, set);
    }

    private static MutableAtlas ParseAtlas(Dictionary<string, string> values, string path)
    {
        var name = Required(values, "Name", path);
        var filename = Required(values, "Filename", path);
        var iconSize = PositiveInt(values, "IconSize", MaximumIconSize, path);
        var iconsPerRow = PositiveInt(values, "IconsPerRow", 256, path);
        var iconsPerColumn = PositiveInt(values, "IconsPerColumn", 256, path);
        var offsetH = NonNegativeInt(values, "OffsetH", 8192, path, defaultValue: 0);
        var offsetV = NonNegativeInt(values, "OffsetV", 8192, path, defaultValue: 0);
        _ = NonNegativeInt(values, "Baseline", 8192, path, defaultValue: 0);
        var allowed = new HashSet<string>(
            ["Name", "IconSize", "IconsPerRow", "IconsPerColumn", "Filename", "OffsetH", "OffsetV", "Baseline"],
            StringComparer.OrdinalIgnoreCase);
        if (values.Keys.Any(value => !allowed.Contains(value)))
        {
            throw Invalid("IconTextureAtlases 包含未验证字段。", path);
        }

        _ = checked(iconsPerRow * iconsPerColumn);
        return new(name, iconSize, iconsPerRow, iconsPerColumn, filename, offsetH, offsetV, path);
    }

    private static MutableDefinition ParseDefinition(Dictionary<string, string> values, string path)
    {
        var allowed = new HashSet<string>(["Name", "Atlas", "Index"], StringComparer.OrdinalIgnoreCase);
        if (values.Keys.Any(value => !allowed.Contains(value)))
        {
            throw Invalid("IconDefinitions 包含未验证字段。", path);
        }

        return new(
            Required(values, "Name", path),
            Required(values, "Atlas", path),
            NonNegativeInt(values, "Index", 65535, path),
            path);
    }

    private static Dictionary<string, string> AtlasValues(MutableAtlas row) => new(StringComparer.OrdinalIgnoreCase)
    {
        ["Name"] = row.Name,
        ["IconSize"] = row.IconSize.ToString(CultureInfo.InvariantCulture),
        ["IconsPerRow"] = row.IconsPerRow.ToString(CultureInfo.InvariantCulture),
        ["IconsPerColumn"] = row.IconsPerColumn.ToString(CultureInfo.InvariantCulture),
        ["Filename"] = row.Filename,
        ["OffsetH"] = row.OffsetH.ToString(CultureInfo.InvariantCulture),
        ["OffsetV"] = row.OffsetV.ToString(CultureInfo.InvariantCulture),
        ["Baseline"] = "0",
    };

    private static Dictionary<string, string> DefinitionValues(MutableDefinition row) => new(StringComparer.OrdinalIgnoreCase)
    {
        ["Name"] = row.Name,
        ["Atlas"] = row.Atlas,
        ["Index"] = row.Index.ToString(CultureInfo.InvariantCulture),
    };

    private static Dictionary<string, string> Values(XElement element)
    {
        var result = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        foreach (var attribute in element.Attributes())
        {
            if (!result.TryAdd(attribute.Name.LocalName, attribute.Value.Trim()))
            {
                throw Invalid("图标操作包含重复字段。", attribute.Name.LocalName);
            }
        }

        foreach (var child in element.Elements())
        {
            if (!result.TryAdd(child.Name.LocalName, child.Value.Trim()))
            {
                throw Invalid("图标操作包含重复字段。", child.Name.LocalName);
            }
        }

        return result;
    }

    private static bool Matches(
        Dictionary<string, string> values,
        IReadOnlyDictionary<string, string> predicate) =>
        predicate.All(value =>
            values.TryGetValue(value.Key, out var actual) &&
            string.Equals(actual, value.Value, StringComparison.Ordinal));

    private static void RequireMatches(int count, string path)
    {
        if (count == 0)
        {
            throw Invalid("图标 Update/Delete 没有匹配到既有行。", path);
        }
    }

    private static string Required(Dictionary<string, string> values, string key, string path) =>
        values.TryGetValue(key, out var value) && !string.IsNullOrWhiteSpace(value)
            ? value
            : throw Invalid("图标行缺少必需字段。", $"{path}/{key}");

    private static int PositiveInt(
        Dictionary<string, string> values,
        string key,
        int maximum,
        string path) =>
        ParseInt(Required(values, key, path), key, 1, maximum, path);

    private static int NonNegativeInt(
        Dictionary<string, string> values,
        string key,
        int maximum,
        string path,
        int? defaultValue = null)
    {
        if (!values.TryGetValue(key, out var value))
        {
            return defaultValue
                ?? throw Invalid("图标行缺少必需整数字段。", $"{path}/{key}");
        }

        return ParseInt(value, key, 0, maximum, path);
    }

    private static int ParseInt(string value, string key, int minimum, int maximum, string path)
    {
        if (!int.TryParse(value, NumberStyles.None, CultureInfo.InvariantCulture, out var result) ||
            result < minimum || result > maximum)
        {
            throw Invalid("图标整数超出安全范围。", $"{path}/{key}");
        }

        return result;
    }

    private static string ResolveContainerPath(string sourceRelativePath)
    {
        if (sourceRelativePath.StartsWith("DLC/Expansion2/", StringComparison.Ordinal))
        {
            return "DLC/Expansion2/Platforms/Windows/BLPs/UI/Icons.blp";
        }

        if (sourceRelativePath.StartsWith("DLC/Expansion1/", StringComparison.Ordinal))
        {
            return "DLC/Expansion1/Platforms/Windows/BLPs/UI/Icons.blp";
        }

        return "Base/Platforms/Windows/BLPs/UI/Icons.blp";
    }

    private static string NormalizeEntryName(string filename, string path)
    {
        var normalized = filename.Replace('\\', '/');
        if (normalized.Contains('/') || Path.IsPathFullyQualified(filename) ||
            string.IsNullOrWhiteSpace(filename))
        {
            throw Invalid("IconTextureAtlas Filename 必须是无目录的正式逻辑名。", path);
        }

        var entryName = filename.EndsWith(".dds", StringComparison.OrdinalIgnoreCase)
            ? filename[..^4]
            : filename;
        if (entryName.Length == 0 || entryName.Any(value => value is < ' ' or > '~'))
        {
            throw Invalid("IconTextureAtlas Filename 不是受支持的 ASCII 逻辑名。", path);
        }

        return entryName;
    }

    private static byte[] Crop(
        DecodedAtlas decoded,
        MutableAtlas atlas,
        int index,
        string path,
        CancellationToken cancellationToken)
    {
        int x;
        int y;
        int right;
        int bottom;
        int outputBytes;
        try
        {
            x = checked(atlas.OffsetH + index % atlas.IconsPerRow * atlas.IconSize);
            y = checked(atlas.OffsetV + index / atlas.IconsPerRow * atlas.IconSize);
            right = checked(x + atlas.IconSize);
            bottom = checked(y + atlas.IconSize);
            outputBytes = checked(atlas.IconSize * atlas.IconSize * 4);
        }
        catch (OverflowException error)
        {
            throw Invalid("图标 atlas 裁切边界发生整数溢出。", path, error);
        }

        if (right > decoded.Width || bottom > decoded.Height ||
            decoded.Rgba.Length != checked(decoded.Width * decoded.Height * 4))
        {
            throw Invalid("图标 atlas 尺寸与行列、偏移或索引不闭合。", path);
        }

        var result = new byte[outputBytes];
        var rowBytes = checked(atlas.IconSize * 4);
        for (var row = 0; row < atlas.IconSize; row++)
        {
            if ((row & 31) == 0)
            {
                cancellationToken.ThrowIfCancellationRequested();
            }

            decoded.Rgba.AsSpan(checked(((y + row) * decoded.Width + x) * 4), rowBytes)
                .CopyTo(result.AsSpan(row * rowBytes, rowBytes));
        }

        return result;
    }

    private static long CheckedAdd(long left, int right, string path)
    {
        try
        {
            return checked(left + right);
        }
        catch (OverflowException error)
        {
            throw new ExtractionException("asset-output-limit-exceeded", "预览资源总字节发生整数溢出。", path, error);
        }
    }

    private static Civ6InstallationDiagnostic Placeholder(string code, string message, string path) =>
        new(code, "warning", message, path);

    private static ExtractionException Invalid(string message, string path, Exception? inner = null) =>
        new("input-icon-structure-invalid", message, path, inner);

    private sealed record IconCatalog(
        IReadOnlyDictionary<(string Name, int Size), MutableAtlas> Atlases,
        IReadOnlyDictionary<(string Name, string Atlas), MutableDefinition> Definitions,
        IReadOnlyList<SourceFileFact> SourceFiles);

    private sealed record MutableAtlas(
        string Name,
        int IconSize,
        int IconsPerRow,
        int IconsPerColumn,
        string Filename,
        int OffsetH,
        int OffsetV,
        string SourceRelativePath);

    private sealed record MutableDefinition(
        string Name,
        string Atlas,
        int Index,
        string SourceRelativePath);

    private sealed record DecodedAtlas(int Width, int Height, byte[] Rgba);
}
