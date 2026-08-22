using System.Text;
using System.Xml.Linq;

namespace Tessera.Civ6.Extractor.Core;

internal static class Civ6ArtAssetProbe
{
    private const long MaxContainerBytes = 512L * 1024 * 1024;
    private const int MaxAssetReferences = 100_000;

    public static async Task<Civ6ArtAssetInspection> InspectAsync(
        SafeInputRoot input,
        string gameVersion,
        IReadOnlyList<Civ6ContentDefinition> definitions,
        CancellationToken cancellationToken)
    {
        var documents = new Dictionary<string, XDocument>(StringComparer.Ordinal);
        var categoryMappings = new List<ContentMapping>();
        var diagnostics = new List<Civ6InstallationDiagnostic>();
        var referenceCount = 0;

        foreach (var spec in ExtractionLayout.ArtDefTables)
        {
            cancellationToken.ThrowIfCancellationRequested();
            var categoryDefinitions = definitions
                .Where(value => value.Category == spec.Category)
                .OrderBy(value => value.Id, StringComparer.Ordinal)
                .ToArray();
            var indexes = new List<(string RelativePath, Dictionary<string, XElement> Elements)>();
            foreach (var relativePath in spec.RelativePaths)
            {
                cancellationToken.ThrowIfCancellationRequested();
                var document = await LoadDocumentAsync(input, relativePath, documents, cancellationToken);
                indexes.Add((relativePath, IndexRootCollection(document, spec.RootCollection, relativePath)));
            }

            foreach (var definition in categoryDefinitions)
            {
                cancellationToken.ThrowIfCancellationRequested();
                var variants = indexes
                    .Where(value => value.Elements.ContainsKey(definition.Id))
                    .Select(value => (value.RelativePath, Element: value.Elements[definition.Id]))
                    .ToArray();
                if (variants.Length == 0)
                {
                    diagnostics.Add(new(
                        "artdef-content-unmapped",
                        "warning",
                        "正式规则内容没有同名 ArtDef 元素，保留无图占位。",
                        definition.Id));
                    categoryMappings.Add(new(definition.Id, definition.Category, null, []));
                    continue;
                }

                var assets = new List<Civ6ArtAssetReference>();
                foreach (var variant in variants)
                {
                    var references = CollectBlpReferences(variant.Element, variant.RelativePath).ToList();
                    foreach (var artDefReference in CollectArtDefReferences(variant.Element, variant.RelativePath))
                    {
                        cancellationToken.ThrowIfCancellationRequested();
                        var target = await ResolveArtDefReferenceAsync(
                            input,
                            artDefReference,
                            documents,
                            cancellationToken);
                        if (target is null)
                        {
                            diagnostics.Add(new(
                                "artdef-reference-target-missing",
                                "warning",
                                "ArtDef 引用缺少可证目标名称，未猜测资产。",
                                artDefReference.SourceRelativePath));
                            continue;
                        }

                        references.AddRange(CollectBlpReferences(target.Value.Element, target.Value.RelativePath));
                    }

                    foreach (var reference in references
                        .DistinctBy(ReferenceIdentity)
                        .OrderBy(value => value.BlpPackage, StringComparer.Ordinal)
                        .ThenBy(value => value.EntryName, StringComparer.Ordinal))
                    {
                        cancellationToken.ThrowIfCancellationRequested();
                        referenceCount++;
                        if (referenceCount > MaxAssetReferences)
                        {
                            throw new ExtractionException(
                                "artdef-reference-limit-exceeded",
                                "ArtDef 资产引用数量超过安全上限。",
                                reference.SourceRelativePath);
                        }

                        var resolved = await ResolveContainerAsync(input, reference, cancellationToken);
                        if (resolved is null)
                        {
                            diagnostics.Add(new(
                                "asset-container-missing",
                                "warning",
                                "ArtDef 引用的正式 BLP 容器不存在于允许的 Base/Expansion 范围。",
                                reference.SourceRelativePath));
                            continue;
                        }

                        assets.Add(resolved);
                    }
                }

                categoryMappings.Add(new(
                    definition.Id,
                    definition.Category,
                    variants[^1].RelativePath,
                    assets.DistinctBy(AssetIdentity)
                        .OrderBy(value => value.ContainerRelativePath, StringComparer.Ordinal)
                        .ThenBy(value => value.EntryName, StringComparer.Ordinal)
                        .ToArray()));
            }
        }

        diagnostics.Add(new(
            "art-static-image-extraction-unavailable",
            "warning",
            "当前可证链路落到 CIVBLP/CIVBIG 专有容器，不是 SkiaSharp 可直接解码的静态图片；本检查点不伪造输出。",
            null));

        var categories = categoryMappings
            .GroupBy(value => value.Category, StringComparer.Ordinal)
            .OrderBy(value => value.Key, StringComparer.Ordinal)
            .Select(group => new Civ6ArtCategoryInspection(
                group.Key,
                group.Count(),
                group.Count(value => value.ArtDefRelativePath is not null),
                group.Sum(value => value.Assets.Count),
                group.SelectMany(value => value.Assets)
                    .Select(value => value.ContainerRelativePath).Distinct(StringComparer.Ordinal).Count()))
            .ToArray();
        var samples = categoryMappings
            .Where(value => value.ArtDefRelativePath is not null && value.Assets.Count > 0)
            .GroupBy(value => value.Category, StringComparer.Ordinal)
            .OrderBy(value => value.Key, StringComparer.Ordinal)
            .SelectMany(group => group.OrderBy(value => value.ContentId, StringComparer.Ordinal).Take(2))
            .Select(value => new Civ6ArtAssetSample(
                value.ContentId,
                value.Category,
                value.ArtDefRelativePath!,
                value.ContentId,
                value.Assets.Take(4).ToArray()))
            .ToArray();

        return new(
            gameVersion,
            categories,
            categoryMappings.Count,
            categoryMappings.Count(value => value.ArtDefRelativePath is not null),
            categoryMappings.SelectMany(value => value.Assets)
                .Select(value => value.ContainerRelativePath).Distinct(StringComparer.Ordinal).Count(),
            false,
            "firaxis-container-decoder-unavailable",
            samples,
            diagnostics.DistinctBy(value => $"{value.Code}\u001f{value.RelativePath}")
                .OrderBy(value => value.Code, StringComparer.Ordinal)
                .ThenBy(value => value.RelativePath, StringComparer.Ordinal)
                .ToArray());
    }

    private static async Task<XDocument> LoadDocumentAsync(
        SafeInputRoot input,
        string relativePath,
        IDictionary<string, XDocument> documents,
        CancellationToken cancellationToken)
    {
        if (documents.TryGetValue(relativePath, out var existing))
        {
            return existing;
        }

        var bytes = await input.ReadAllBytesAsync(relativePath, cancellationToken);
        var document = SecureXml.Parse(bytes, relativePath);
        if (document.Root?.Name.LocalName != "AssetObjects..ArtDefSet")
        {
            throw new ExtractionException(
                "input-artdef-schema-unsupported",
                "ArtDef 根元素不是受支持的 AssetObjects..ArtDefSet。",
                relativePath);
        }

        var version = document.Root.Element("m_Version");
        var templateName = TextAttribute(document.Root.Element("m_TemplateName"));
        if (!int.TryParse(version?.Element("major")?.Value, out var major) ||
            major is not (3 or 4) ||
            !int.TryParse(version?.Element("minor")?.Value, out var minor) ||
            minor != 0 ||
            string.IsNullOrWhiteSpace(templateName))
        {
            throw new ExtractionException(
                "input-artdef-schema-unsupported",
                "ArtDef 版本或模板声明不在已验证的 Civ6 正式结构范围。",
                relativePath);
        }

        documents.Add(relativePath, document);
        return document;
    }

    private static Dictionary<string, XElement> IndexRootCollection(
        XDocument document,
        string collectionName,
        string relativePath)
    {
        var collections = document.Root?.Element("m_RootCollections")?.Elements("Element")
            .Where(value => TextAttribute(value.Element("m_CollectionName")) == collectionName)
            .ToArray() ?? [];
        if (collections.Length == 0)
        {
            throw new ExtractionException(
                "input-artdef-collection-missing",
                "ArtDef 缺少预期的根集合。",
                $"{relativePath}/{collectionName}");
        }

        if (collections.Length > 1)
        {
            throw new ExtractionException(
                "input-artdef-collection-duplicate",
                "ArtDef 中存在重复根集合。",
                $"{relativePath}/{collectionName}");
        }

        var collection = collections[0];

        var result = new Dictionary<string, XElement>(StringComparer.Ordinal);
        foreach (var element in collection.Elements("Element"))
        {
            var name = TextAttribute(element.Element("m_Name"));
            if (string.IsNullOrWhiteSpace(name))
            {
                throw new ExtractionException(
                    "input-artdef-element-name-missing",
                    "ArtDef 集合元素缺少稳定名称。",
                    relativePath);
            }

            if (!result.TryAdd(name, element))
            {
                throw new ExtractionException(
                    "input-artdef-element-duplicate",
                    "同一个 ArtDef 文件内存在重复元素名称。",
                    $"{relativePath}/{name}");
            }
        }

        return result;
    }

    private static IEnumerable<RawBlpReference> CollectBlpReferences(XElement element, string sourceRelativePath)
    {
        foreach (var value in element.Descendants("Element")
            .Where(value => (string?)value.Attribute("class") == "AssetObjects..BLPEntryValue"))
        {
            var entryName = RequiredText(value, "m_EntryName", sourceRelativePath);
            var xlpClass = RequiredText(value, "m_XLPClass", sourceRelativePath);
            var xlpPath = RequiredText(value, "m_XLPPath", sourceRelativePath);
            var blpPackage = RequiredText(value, "m_BLPPackage", sourceRelativePath);
            var libraryName = RequiredText(value, "m_LibraryName", sourceRelativePath);
            var parameterName = RequiredText(value, "m_ParamName", sourceRelativePath);
            ValidatePackagePath(blpPackage, sourceRelativePath);
            ValidatePackagePath(xlpPath, sourceRelativePath);
            yield return new(
                entryName,
                xlpClass,
                xlpPath,
                blpPackage,
                libraryName,
                parameterName,
                sourceRelativePath);
        }
    }

    private static IEnumerable<RawArtDefReference> CollectArtDefReferences(XElement element, string sourceRelativePath)
    {
        foreach (var value in element.Descendants("Element")
            .Where(value => (string?)value.Attribute("class") == "AssetObjects..ArtDefReferenceValue"))
        {
            var artDefPath = TextAttribute(value.Element("m_ArtDefPath"));
            if (string.IsNullOrWhiteSpace(artDefPath))
            {
                continue;
            }

            if (artDefPath.Contains('/') || artDefPath.Contains('\\') ||
                !ExtractionLayout.ReferencedArtDefFileNames.Contains(artDefPath))
            {
                throw new ExtractionException(
                    "input-artdef-reference-outside-whitelist",
                    "ArtDef 引用越过了固定正式文件白名单。",
                    $"{sourceRelativePath}/{artDefPath}");
            }

            var targetName = TextAttribute(value.Element("m_ElementName"));
            if (string.IsNullOrWhiteSpace(targetName) &&
                TextAttribute(value.Element("m_ParamName")) == "Xref")
            {
                targetName = value.Parent?.Elements("Element")
                    .FirstOrDefault(candidate =>
                        TextAttribute(candidate.Element("m_ParamName")) == "XrefName")?
                    .Element("m_Value")?.Attribute("text")?.Value ?? string.Empty;
            }

            yield return new(
                artDefPath,
                TextAttribute(value.Element("m_RootCollectionName")),
                targetName,
                sourceRelativePath);
        }
    }

    private static async Task<(string RelativePath, XElement Element)?> ResolveArtDefReferenceAsync(
        SafeInputRoot input,
        RawArtDefReference reference,
        IDictionary<string, XDocument> documents,
        CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(reference.TargetName))
        {
            return null;
        }

        var candidates = ScopeCandidates(reference.SourceRelativePath)
            .Select(scope => $"{scope}/ArtDefs/{reference.ArtDefFileName}")
            .ToArray();
        var existingPaths = candidates.Where(candidate => input.TryResolveExistingFile(candidate, out _)).ToArray();
        if (existingPaths.Length == 0)
        {
            throw new ExtractionException(
                "input-artdef-reference-file-missing",
                "ArtDef 引用的正式白名单文件不存在。",
                $"{reference.SourceRelativePath}/{reference.ArtDefFileName}");
        }

        foreach (var relativePath in existingPaths)
        {
            cancellationToken.ThrowIfCancellationRequested();
            var document = await LoadDocumentAsync(input, relativePath, documents, cancellationToken);
            var rootCollections = document.Root?.Element("m_RootCollections")?.Elements("Element") ?? [];
            var selectedCollections = string.IsNullOrWhiteSpace(reference.RootCollectionName)
                ? rootCollections
                : rootCollections.Where(value =>
                    TextAttribute(value.Element("m_CollectionName")) == reference.RootCollectionName);
            var matches = selectedCollections.SelectMany(value => value.Elements("Element"))
                .Where(value => TextAttribute(value.Element("m_Name")) == reference.TargetName)
                .ToArray();
            if (matches.Length > 1)
            {
                throw new ExtractionException(
                    "input-artdef-reference-target-ambiguous",
                    "ArtDef 引用目标不唯一，不能猜测变体。",
                    $"{relativePath}/{reference.TargetName}");
            }

            if (matches.Length == 1)
            {
                return (relativePath, matches[0]);
            }
        }

        throw new ExtractionException(
            "input-artdef-reference-target-missing",
            "ArtDef 引用目标不存在。",
            $"{existingPaths[^1]}/{reference.TargetName}");
    }

    private static async Task<Civ6ArtAssetReference?> ResolveContainerAsync(
        SafeInputRoot input,
        RawBlpReference reference,
        CancellationToken cancellationToken)
    {
        var candidates = ScopeCandidates(reference.SourceRelativePath)
            .Select(scope => $"{scope}/Platforms/Windows/BLPs/{reference.BlpPackage}.blp")
            .ToArray();
        var relativePath = candidates.FirstOrDefault(candidate => input.TryResolveExistingFile(candidate, out _));
        if (relativePath is null)
        {
            return null;
        }

        var fullPath = input.ResolveExistingFile(relativePath);
        var file = new FileInfo(fullPath);
        if (file.Length < 8 || file.Length > MaxContainerBytes)
        {
            throw new ExtractionException(
                "asset-container-size-invalid",
                "正式资产容器为空或超过 512 MiB 安全上限。",
                relativePath);
        }

        var header = new byte[8];
        await using (var stream = new FileStream(
            fullPath,
            FileMode.Open,
            FileAccess.Read,
            FileShare.Read,
            bufferSize: 4096,
            FileOptions.Asynchronous | FileOptions.SequentialScan))
        {
            await stream.ReadExactlyAsync(header, cancellationToken);
        }

        var format = Encoding.ASCII.GetString(header) switch
        {
            "CIVBLP\u0002\u0000" => "firaxis-civblp-v2",
            "CIVBIG\u0000\u0000" => "firaxis-civbig",
            _ => throw new ExtractionException(
                "asset-container-format-unknown",
                "正式资产容器文件头不是受支持的只读探针格式。",
                relativePath),
        };

        return new(
            reference.EntryName,
            reference.XlpClass,
            reference.XlpPath,
            reference.BlpPackage,
            relativePath,
            format,
            file.Length,
            false);
    }

    private static IEnumerable<string> ScopeCandidates(string relativePath)
    {
        if (relativePath.StartsWith("DLC/Expansion2/", StringComparison.Ordinal))
        {
            yield return "DLC/Expansion2";
            yield return "DLC/Expansion1";
        }
        else if (relativePath.StartsWith("DLC/Expansion1/", StringComparison.Ordinal))
        {
            yield return "DLC/Expansion1";
        }

        yield return "Base";
    }

    private static void ValidatePackagePath(string value, string sourceRelativePath)
    {
        var normalized = value.Replace('\\', '/');
        var segments = normalized.Split('/');
        if (Path.IsPathFullyQualified(value) || value != normalized ||
            segments.Any(segment => segment is "" or "." or "..") ||
            segments.Any(segment => segment.IndexOfAny(Path.GetInvalidFileNameChars()) >= 0))
        {
            throw new ExtractionException(
                "input-artdef-package-path-invalid",
                "ArtDef 的 BLP 包路径不是规范相对路径。",
                sourceRelativePath);
        }
    }

    private static string RequiredText(XElement element, string childName, string sourceRelativePath)
    {
        var value = TextAttribute(element.Element(childName));
        if (string.IsNullOrWhiteSpace(value))
        {
            throw new ExtractionException(
                "input-artdef-blp-reference-invalid",
                "BLPEntryValue 缺少必需字段。",
                $"{sourceRelativePath}/{childName}");
        }

        return value;
    }

    private static string TextAttribute(XElement? element) =>
        element?.Attribute("text")?.Value ?? string.Empty;

    private static string ReferenceIdentity(RawBlpReference value) =>
        $"{value.SourceRelativePath}\u001f{value.BlpPackage}\u001f{value.EntryName}\u001f{value.XlpClass}";

    private static string AssetIdentity(Civ6ArtAssetReference value) =>
        $"{value.ContainerRelativePath}\u001f{value.EntryName}\u001f{value.XlpClass}";

    private sealed record ContentMapping(
        string ContentId,
        string Category,
        string? ArtDefRelativePath,
        IReadOnlyList<Civ6ArtAssetReference> Assets);

    private sealed record RawBlpReference(
        string EntryName,
        string XlpClass,
        string XlpPath,
        string BlpPackage,
        string LibraryName,
        string ParameterName,
        string SourceRelativePath);

    private sealed record RawArtDefReference(
        string ArtDefFileName,
        string RootCollectionName,
        string TargetName,
        string SourceRelativePath);
}
