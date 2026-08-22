using System.Buffers.Binary;
using System.Text.RegularExpressions;

namespace Tessera.Civ6.Extractor.Core;

internal static partial class Civ6RulesParser
{
    private static readonly string[] RequiredDlcIds = ["Expansion1", "Expansion2"];
    private static readonly HashSet<string> CurrentLabels = new(StringComparer.OrdinalIgnoreCase)
    {
        "current",
        "latest",
        "unknown",
    };

    public static Civ6SourceInfo Parse(byte[] bytes, string fieldPath)
    {
        var root = SecureXml.Parse(bytes, fieldPath).Root
            ?? throw Invalid(fieldPath, "规则 XML 缺少根元素。");
        var sourceBuild = RequiredAttribute(root, "sourceBuild", fieldPath);
        var rulesetId = RequiredAttribute(root, "rulesetId", fieldPath);
        var artDefVersion = RequiredAttribute(root, "artDefVersion", fieldPath);
        var dlcIds = RequiredAttribute(root, "dlcIds", fieldPath)
            .Split(';', StringSplitOptions.TrimEntries | StringSplitOptions.RemoveEmptyEntries)
            .Distinct(StringComparer.Ordinal)
            .Order(StringComparer.Ordinal)
            .ToArray();
        if (CurrentLabels.Contains(sourceBuild) || RequiredDlcIds.Except(dlcIds, StringComparer.Ordinal).Any())
        {
            throw new ExtractionException(
                "input-baseline-incomplete",
                "输入必须具有明确游戏版本，并包含 Rise and Fall 与 Gathering Storm 基线。",
                fieldPath);
        }
        var objects = root.Descendants("Object")
            .Select((element, index) => new Civ6ObjectDefinition(
                RequiredAttribute(element, "id", $"{fieldPath}/Object/{index}"),
                RequiredAttribute(element, "category", $"{fieldPath}/Object/{index}"),
                RequiredAttribute(element, "name", $"{fieldPath}/Object/{index}"),
                RequiredAttribute(element, "description", $"{fieldPath}/Object/{index}"),
                RequiredAttribute(element, "artDef", $"{fieldPath}/Object/{index}")))
            .OrderBy(value => value.Id, StringComparer.Ordinal)
            .ToArray();

        if (objects.Length == 0 || objects.Select(value => value.Id).Distinct(StringComparer.Ordinal).Count() != objects.Length)
        {
            throw Invalid(fieldPath, "规则 XML 必须包含至少一个且 ID 唯一的对象。");
        }

        foreach (var value in objects)
        {
            if (!SourceIdPattern().IsMatch(value.Id) ||
                !SourceIdPattern().IsMatch(value.ArtDefId) ||
                !CategoryPattern().IsMatch(value.Category))
            {
                throw Invalid(fieldPath, "对象与 ArtDef ID 只能包含大写字母、数字和下划线。");
            }
        }

        return new Civ6SourceInfo(sourceBuild, rulesetId, artDefVersion, dlcIds, objects);
    }

    private static string RequiredAttribute(System.Xml.Linq.XElement element, string name, string path)
    {
        var value = (string?)element.Attribute(name);
        return string.IsNullOrWhiteSpace(value)
            ? throw Invalid($"{path}/@{name}", "规则 XML 缺少必填属性。")
            : value.Trim();
    }

    private static ExtractionException Invalid(string path, string message) =>
        new("input-rules-invalid", message, path);

    [GeneratedRegex("^[A-Z][A-Z0-9_]{0,127}$", RegexOptions.CultureInvariant)]
    private static partial Regex SourceIdPattern();

    [GeneratedRegex("^[A-Za-z][A-Za-z0-9_]{0,63}$", RegexOptions.CultureInvariant)]
    private static partial Regex CategoryPattern();
}

internal static class ArtDefParser
{
    public static IReadOnlyDictionary<string, ArtDefAsset> Parse(byte[] bytes, string fieldPath)
    {
        var root = SecureXml.Parse(bytes, fieldPath).Root
            ?? throw new ExtractionException("input-artdef-invalid", "ArtDef 缺少根元素。", fieldPath);
        var assets = root.Descendants("Asset")
            .Select((element, index) =>
            {
                var path = $"{fieldPath}/Asset/{index}";
                var id = ((string?)element.Attribute("id"))?.Trim();
                var imagePath = ((string?)element.Attribute("imagePath"))?.Trim();
                if (string.IsNullOrWhiteSpace(id) || string.IsNullOrWhiteSpace(imagePath))
                {
                    throw new ExtractionException("input-artdef-invalid", "ArtDef 资产缺少 id 或 imagePath。", path);
                }

                return new ArtDefAsset(id, NormalizeRelativePath(imagePath, path));
            })
            .ToArray();
        if (assets.Length == 0 || assets.Select(value => value.Id).Distinct(StringComparer.Ordinal).Count() != assets.Length)
        {
            throw new ExtractionException("input-artdef-invalid", "ArtDef 必须包含至少一个且 ID 唯一的资产。", fieldPath);
        }

        return assets.ToDictionary(value => value.Id, StringComparer.Ordinal);
    }

    private static string NormalizeRelativePath(string value, string fieldPath)
    {
        var normalized = value.Replace('\\', '/');
        if (Path.IsPathFullyQualified(value) || normalized.StartsWith('/') || normalized.Split('/').Contains(".."))
        {
            throw new ExtractionException("input-artdef-path-invalid", "ArtDef 图片必须使用游戏根目录相对路径。", fieldPath);
        }

        return normalized;
    }
}

internal static class PngFixtureParser
{
    private static readonly byte[] Signature = [137, 80, 78, 71, 13, 10, 26, 10];

    public static PngImage Parse(byte[] bytes, string fieldPath)
    {
        if (bytes.Length < 33 || !bytes.AsSpan(0, 8).SequenceEqual(Signature) ||
            !bytes.AsSpan(12, 4).SequenceEqual("IHDR"u8))
        {
            throw new ExtractionException("input-image-invalid", "图片不是有效的静态 PNG。", fieldPath);
        }

        var width = BinaryPrimitives.ReadInt32BigEndian(bytes.AsSpan(16, 4));
        var height = BinaryPrimitives.ReadInt32BigEndian(bytes.AsSpan(20, 4));
        if (width is <= 0 or > 4096 || height is <= 0 or > 4096 || (long)width * height > 16_777_216)
        {
            throw new ExtractionException("input-image-dimensions-invalid", "PNG 尺寸超过安全边界。", fieldPath);
        }

        if (bytes.AsSpan().IndexOf("acTL"u8) >= 0)
        {
            throw new ExtractionException("input-image-animated", "不允许输出动画 PNG。", fieldPath);
        }

        return new PngImage(width, height, bytes);
    }
}
