using System.Collections.ObjectModel;
using System.Xml.Linq;

namespace Tessera.Civ6.Extractor.Core;

/// <summary>扫描正式 GameInfo 表并按 Base、Expansion1、Expansion2 顺序合并。</summary>
internal static class Civ6ContentScanner
{
    public static async Task<Civ6ContentScanResult> ScanAsync(
        SafeInputRoot input,
        CancellationToken cancellationToken)
    {
        var definitions = new List<Civ6ContentDefinition>();
        var sourceFiles = new SortedDictionary<string, long>(StringComparer.Ordinal);
        var diagnostics = new List<Civ6InstallationDiagnostic>();
        foreach (var spec in ExtractionLayout.ContentTables)
        {
            var rows = new Dictionary<string, MutableContentRow>(StringComparer.Ordinal);
            var knownTypes = new HashSet<string>(StringComparer.Ordinal);
            foreach (var relativePath in spec.RelativePaths)
            {
                cancellationToken.ThrowIfCancellationRequested();
                var bytes = await input.ReadAllBytesAsync(relativePath, cancellationToken);
                sourceFiles[relativePath] = bytes.LongLength;
                ApplyDocument(bytes, relativePath, spec, rows, knownTypes, diagnostics);
            }

            foreach (var row in rows.Values.OrderBy(value => value.Id, StringComparer.Ordinal))
            {
                if (!knownTypes.Contains(row.Id))
                {
                    throw new ExtractionException(
                        "input-content-type-reference-missing",
                        "内容行引用了 Types 表中不存在的类型。",
                        $"{row.SourceRelativePath}/{spec.TableName}/{row.Id}");
                }

                var nameKey = RequiredValue(row, "Name", spec);
                var category = spec.Category switch
                {
                    "district" when IsTrue(row.Attributes.GetValueOrDefault("CityCenter")) => "city",
                    "building" when IsTrue(row.Attributes.GetValueOrDefault("IsWonder")) => "wonder",
                    "building" => null,
                    _ => spec.Category,
                };
                if (category is null)
                {
                    continue;
                }

                definitions.Add(new(
                    row.Id,
                    category,
                    nameKey,
                    row.Attributes.GetValueOrDefault("Description"),
                    row.SourceRelativePath,
                    new ReadOnlyDictionary<string, string>(new SortedDictionary<string, string>(row.Attributes, StringComparer.Ordinal))));
            }
        }

        var text = new Dictionary<string, string>(StringComparer.Ordinal);
        foreach (var relativePath in ExtractionLayout.ChineseTextPaths)
        {
            cancellationToken.ThrowIfCancellationRequested();
            var bytes = await input.ReadAllBytesAsync(relativePath, cancellationToken);
            sourceFiles[relativePath] = bytes.LongLength;
            ApplyChineseText(bytes, relativePath, text);
        }

        return new(
            definitions.OrderBy(value => value.Category, StringComparer.Ordinal)
                .ThenBy(value => value.Id, StringComparer.Ordinal)
                .ToArray(),
            new ReadOnlyDictionary<string, string>(new SortedDictionary<string, string>(text, StringComparer.Ordinal)),
            sourceFiles.Select((value, index) =>
                new SourceFileFact(value.Key, $"tessera.civ6:source.content-{index + 1:D4}", value.Value)).ToArray(),
            diagnostics.OrderBy(value => value.RelativePath, StringComparer.Ordinal)
                .ThenBy(value => value.Code, StringComparer.Ordinal)
                .ToArray());
    }

    private static void ApplyDocument(
        byte[] bytes,
        string relativePath,
        Civ6ContentTableSpec spec,
        Dictionary<string, MutableContentRow> rows,
        HashSet<string> knownTypes,
        List<Civ6InstallationDiagnostic> diagnostics)
    {
        var root = SecureXml.Parse(bytes, relativePath).Root;
        if (root?.Name.LocalName != "GameInfo")
        {
            throw new ExtractionException("input-content-root-invalid", "正式规则 XML 根元素必须是 GameInfo。", relativePath);
        }

        ApplyTypes(root.Element("Types"), relativePath, knownTypes);
        var table = root.Element(spec.TableName)
            ?? throw new ExtractionException(
                "input-content-table-missing",
                "正式规则 XML 缺少要求的实体表。",
                $"{relativePath}/{spec.TableName}");
        foreach (var operation in table.Elements())
        {
            switch (operation.Name.LocalName)
            {
                case "Row":
                    AddRow(operation, relativePath, spec, rows);
                    break;
                case "Update":
                    UpdateRows(operation, relativePath, spec, rows, knownTypes, diagnostics);
                    break;
                case "Delete":
                    DeleteRows(operation, relativePath, spec, rows, knownTypes, diagnostics);
                    break;
                default:
                    throw new ExtractionException(
                        "input-content-operation-unsupported",
                        "实体表包含不支持的操作。",
                        $"{relativePath}/{spec.TableName}/{operation.Name.LocalName}");
            }
        }
    }

    private static void ApplyTypes(XElement? table, string relativePath, HashSet<string> knownTypes)
    {
        if (table is null)
        {
            return;
        }

        foreach (var operation in table.Elements())
        {
            var values = Values(operation.Name.LocalName == "Delete"
                ? operation.Element("Where") ?? operation
                : operation);
            if (!values.TryGetValue("Type", out var id) || string.IsNullOrWhiteSpace(id))
            {
                continue;
            }

            switch (operation.Name.LocalName)
            {
                case "Row":
                    if (!knownTypes.Add(id))
                    {
                        throw new ExtractionException("input-content-duplicate-type", "Types 表包含重复 ID。", $"{relativePath}/Types/{id}");
                    }

                    break;
                case "Delete":
                    knownTypes.Remove(id);
                    break;
                case "Update":
                    break;
                default:
                    throw new ExtractionException(
                        "input-content-operation-unsupported",
                        "Types 表包含不支持的操作。",
                        $"{relativePath}/Types/{operation.Name.LocalName}");
            }
        }
    }

    private static void AddRow(
        XElement operation,
        string relativePath,
        Civ6ContentTableSpec spec,
        Dictionary<string, MutableContentRow> rows)
    {
        var values = Values(operation);
        if (!values.TryGetValue(spec.PrimaryKey, out var id) || string.IsNullOrWhiteSpace(id))
        {
            throw new ExtractionException(
                "input-content-primary-key-missing",
                "实体行缺少主键。",
                $"{relativePath}/{spec.TableName}");
        }

        if (!rows.TryAdd(id, new(id, relativePath, values)))
        {
            throw new ExtractionException(
                "input-content-duplicate-id",
                "实体 ID 已存在；覆盖必须使用 Update。",
                $"{relativePath}/{spec.TableName}/{id}");
        }
    }

    private static void UpdateRows(
        XElement operation,
        string relativePath,
        Civ6ContentTableSpec spec,
        Dictionary<string, MutableContentRow> rows,
        HashSet<string> knownTypes,
        List<Civ6InstallationDiagnostic> diagnostics)
    {
        var predicate = Values(operation.Element("Where")
            ?? throw InvalidOperation(relativePath, spec, "Update 缺少 Where。"));
        var changes = Values(operation.Element("Set")
            ?? throw InvalidOperation(relativePath, spec, "Update 缺少 Set。"));
        if (predicate.Count == 0 || changes.Count == 0 || changes.ContainsKey(spec.PrimaryKey))
        {
            throw InvalidOperation(relativePath, spec, "Update 谓词或修改字段无效。");
        }

        var matches = rows.Values.Where(row => Matches(row.Attributes, predicate)).ToArray();
        if (matches.Length == 0)
        {
            if (IsOptionalExternalReference(predicate, spec, knownTypes, out var externalId))
            {
                diagnostics.Add(new(
                    "content-optional-reference-skipped",
                    "warning",
                    "扩展更新引用了当前 Base/Expansion 基线之外的可选正式内容，已跳过。",
                    $"{relativePath}/{spec.TableName}/{externalId}"));
                return;
            }

            throw new ExtractionException(
                "input-content-update-target-missing",
                "Update 未匹配到已存在的实体。",
                $"{relativePath}/{spec.TableName}");
        }

        foreach (var row in matches)
        {
            foreach (var (key, value) in changes)
            {
                row.Attributes[key] = value;
            }

            row.SourceRelativePath = relativePath;
        }
    }

    private static void DeleteRows(
        XElement operation,
        string relativePath,
        Civ6ContentTableSpec spec,
        Dictionary<string, MutableContentRow> rows,
        HashSet<string> knownTypes,
        List<Civ6InstallationDiagnostic> diagnostics)
    {
        var predicate = Values(operation.Element("Where") ?? operation);
        if (predicate.Count == 0)
        {
            throw InvalidOperation(relativePath, spec, "Delete 缺少谓词。");
        }

        var ids = rows.Values.Where(row => Matches(row.Attributes, predicate)).Select(row => row.Id).ToArray();
        if (ids.Length == 0)
        {
            if (IsOptionalExternalReference(predicate, spec, knownTypes, out var externalId))
            {
                diagnostics.Add(new(
                    "content-optional-reference-skipped",
                    "warning",
                    "扩展删除引用了当前 Base/Expansion 基线之外的可选正式内容，已跳过。",
                    $"{relativePath}/{spec.TableName}/{externalId}"));
                return;
            }

            throw new ExtractionException(
                "input-content-delete-target-missing",
                "Delete 未匹配到已存在的实体。",
                $"{relativePath}/{spec.TableName}");
        }

        foreach (var id in ids)
        {
            rows.Remove(id);
        }
    }

    private static void ApplyChineseText(byte[] bytes, string relativePath, Dictionary<string, string> text)
    {
        var root = SecureXml.Parse(bytes, relativePath, 32 * 1024 * 1024).Root;
        var table = root?.Element("LocalizedText")
            ?? throw new ExtractionException("input-localization-table-missing", "中文文本缺少 LocalizedText 表。", relativePath);
        foreach (var operation in table.Elements())
        {
            if (operation.Name.LocalName is not ("Row" or "Replace"))
            {
                throw new ExtractionException(
                    "input-localization-operation-unsupported",
                    "中文文本包含不支持的操作。",
                    $"{relativePath}/{operation.Name.LocalName}");
            }

            var language = ((string?)operation.Attribute("Language"))?.Trim();
            if (!string.Equals(language, "zh_Hans_CN", StringComparison.Ordinal))
            {
                continue;
            }

            var key = ((string?)operation.Attribute("Tag"))?.Trim();
            var value = ((string?)operation.Attribute("Text") ?? (string?)operation.Element("Text"))?.Trim();
            if (string.IsNullOrWhiteSpace(key))
            {
                throw new ExtractionException("input-localization-row-invalid", "中文文本行缺少 Tag。", relativePath);
            }

            if (string.IsNullOrWhiteSpace(value))
            {
                // 正式文本中存在有意留空的条目；使用时按缺失 key 回退。
                continue;
            }

            if (operation.Name.LocalName == "Row" && !text.TryAdd(key, value))
            {
                throw new ExtractionException("input-localization-duplicate-key", "中文文本 Row 包含重复 key。", $"{relativePath}/{key}");
            }

            text[key] = value;
        }
    }

    private static Dictionary<string, string> Values(XElement element)
    {
        var values = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        foreach (var attribute in element.Attributes())
        {
            values[attribute.Name.LocalName] = attribute.Value.Trim();
        }

        foreach (var child in element.Elements())
        {
            if (!values.TryAdd(child.Name.LocalName, child.Value.Trim()))
            {
                throw new ExtractionException("input-content-field-duplicate", "内容操作包含重复字段。", child.Name.LocalName);
            }
        }

        return values;
    }

    private static bool Matches(Dictionary<string, string> values, IReadOnlyDictionary<string, string> predicate) =>
        predicate.All(pair => values.TryGetValue(pair.Key, out var value) && string.Equals(value, pair.Value, StringComparison.Ordinal));

    private static bool IsOptionalExternalReference(
        Dictionary<string, string> predicate,
        Civ6ContentTableSpec spec,
        HashSet<string> knownTypes,
        out string externalId)
    {
        if (predicate.Count == 1 && predicate.TryGetValue(spec.PrimaryKey, out var id) && !knownTypes.Contains(id))
        {
            externalId = id;
            return true;
        }

        externalId = string.Empty;
        return false;
    }

    private static string RequiredValue(MutableContentRow row, string key, Civ6ContentTableSpec spec) =>
        row.Attributes.TryGetValue(key, out var value) && !string.IsNullOrWhiteSpace(value)
            ? value
            : throw new ExtractionException(
                "input-content-name-missing",
                "实体缺少本地化名称 key。",
                $"{row.SourceRelativePath}/{spec.TableName}/{row.Id}/{key}");

    private static bool IsTrue(string? value) => value is "1" || string.Equals(value, "true", StringComparison.OrdinalIgnoreCase);

    private static ExtractionException InvalidOperation(string path, Civ6ContentTableSpec spec, string message) =>
        new("input-content-operation-invalid", message, $"{path}/{spec.TableName}");

    private sealed class MutableContentRow(
        string id,
        string sourceRelativePath,
        Dictionary<string, string> attributes)
    {
        public string Id { get; } = id;

        public string SourceRelativePath { get; set; } = sourceRelativePath;

        public Dictionary<string, string> Attributes { get; } = attributes;
    }
}
