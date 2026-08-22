using System.Xml.Linq;

namespace Tessera.Civ6.Extractor.Core;

/// <summary>从内容 ArtDef 到 StrategicView 2D 条目建立可证链，并生成本地预览资源。</summary>
internal static class Civ6StaticPreviewExtractor
{
    private const int MaxAssets = 2048;
    private const long MaxTotalAssetBytes = 512L * 1024 * 1024;
    private static readonly HashSet<string> SupportedXlpClasses = new(StringComparer.Ordinal)
    {
        "StrategicView_Sprite",
        "StrategicView_Route",
    };

    public static async Task<GeneratedArtExtraction> ExtractAsync(
        SafeInputRoot input,
        IReadOnlyList<Civ6ContentDefinition> definitions,
        CancellationToken cancellationToken)
    {
        var documents = new Dictionary<string, XDocument>(StringComparer.Ordinal);
        var containers = new Dictionary<string, Civ6BlpContainer>(StringComparer.Ordinal);
        var assets = new List<GeneratedArtAsset>();
        var sources = new SortedSet<string>(StringComparer.Ordinal);
        var diagnostics = new List<Civ6InstallationDiagnostic>();
        var traversal = new ReferenceTraversalStats();
        long totalAssetBytes = 0;

        foreach (var spec in ExtractionLayout.ArtDefTables)
        {
            cancellationToken.ThrowIfCancellationRequested();
            var indexes = new List<(string RelativePath, Dictionary<string, XElement> Elements)>();
            foreach (var relativePath in spec.RelativePaths)
            {
                var document = await LoadDocumentAsync(input, relativePath, documents, cancellationToken);
                indexes.Add((relativePath, IndexRootCollection(document, spec.RootCollection, relativePath)));
            }

            foreach (var definition in definitions
                .Where(value => value.Category == spec.Category)
                .OrderBy(value => value.Id, StringComparer.Ordinal))
            {
                cancellationToken.ThrowIfCancellationRequested();
                var variants = indexes.Where(value => value.Elements.ContainsKey(definition.Id)).ToArray();
                if (variants.Length == 0)
                {
                    diagnostics.Add(Placeholder(
                        "art-preview-content-artdef-missing",
                        "内容没有同名正式 ArtDef，保留预览占位。",
                        definition.Id));
                    continue;
                }

                PreviewCandidate[] candidates = [];
                foreach (var variant in variants)
                {
                    var discovered = await DiscoverCandidatesAsync(
                        input,
                        variant.RelativePath,
                        variant.Elements[definition.Id],
                        documents,
                        traversal,
                        cancellationToken);
                    // 扩展 ArtDef 常只覆盖局部字段；没有新 2D 链时继承较早版本，
                    // 明确给出新链时才替换 Base 候选。
                    if (discovered.Length > 0)
                    {
                        candidates = discovered;
                    }
                }

                var selected = SelectCandidate(definition, candidates, diagnostics);
                if (selected is null)
                {
                    continue;
                }

                if (!containers.TryGetValue(selected.ContainerRelativePath, out var container))
                {
                    container = await Civ6BlpContainer.OpenAsync(
                        input,
                        selected.ContainerRelativePath,
                        cancellationToken);
                    containers.Add(selected.ContainerRelativePath, container);
                }

                var texture = await container.ReadPackageTextureAsync(
                    selected.EntryName,
                    selected.XlpClass,
                    cancellationToken);
                var rgba = BcTextureDecoder.DecodeFirstSlice(texture, cancellationToken);
                var png = PngEncoder.EncodeRgba(texture.Width, texture.Height, rgba);
                totalAssetBytes = CheckedAdd(totalAssetBytes, png.Length, definition.Id);
                if (assets.Count >= MaxAssets || totalAssetBytes > MaxTotalAssetBytes)
                {
                    throw new ExtractionException(
                        "asset-output-limit-exceeded",
                        "预览资源数量或总字节超过安全上限。",
                        definition.Id);
                }

                var slug = Slug(definition.Id);
                assets.Add(new(
                    definition.Id,
                    $"tessera.civ6:asset.{definition.Category}.{slug}",
                    $"assets/previews/{definition.Category}/{slug}.png",
                    "image/png",
                    texture.Width,
                    texture.Height,
                    selected.ContainerRelativePath,
                    texture.EntryName,
                    png));
                sources.Add(selected.ContentArtDefRelativePath);
                sources.Add(selected.StrategicArtDefRelativePath);
                sources.Add(selected.ContainerRelativePath);
            }
        }

        var categories = CountCategories(definitions, assets);
        var sourceFacts = sources.Select(path => new SourceFileFact(
            path,
            "tessera.civ6:source.art-preview",
            new FileInfo(input.ResolveExistingFile(path)).Length)).ToArray();
        return new(
            assets.OrderBy(value => value.ContentId, StringComparer.Ordinal).ToArray(),
            sourceFacts,
            diagnostics.OrderBy(value => value.Code, StringComparer.Ordinal)
                .ThenBy(value => value.RelativePath, StringComparer.Ordinal)
                .ToArray(),
            categories,
            traversal.MaximumDepth);
    }

    internal static Civ6GeneratedArtCategoryCount[] CountCategories(
        IReadOnlyList<Civ6ContentDefinition> definitions,
        IReadOnlyList<GeneratedArtAsset> assets)
    {
        var extractedIds = assets.Select(value => value.ContentId).ToHashSet(StringComparer.Ordinal);
        return definitions
            .GroupBy(value => value.Category, StringComparer.Ordinal)
            .OrderBy(group => group.Key, StringComparer.Ordinal)
            .Select(group =>
            {
                var extracted = group.Count(value => extractedIds.Contains(value.Id));
                return new Civ6GeneratedArtCategoryCount(
                    group.Key,
                    group.Count(),
                    extracted,
                    group.Count() - extracted,
                    StrategicCount: extracted);
            })
            .ToArray();
    }

    private static async Task<PreviewCandidate[]> DiscoverCandidatesAsync(
        SafeInputRoot input,
        string sourceRelativePath,
        XElement sourceElement,
        Dictionary<string, XDocument> documents,
        ReferenceTraversalStats traversal,
        CancellationToken cancellationToken)
    {
        var result = new List<PreviewCandidate>();
        foreach (var reference in CollectStrategicReferences(sourceElement, sourceRelativePath))
        {
            cancellationToken.ThrowIfCancellationRequested();
            var target = await ResolveReferenceAsync(input, reference, documents, cancellationToken);
            var targetDocument = documents[target.RelativePath];
            foreach (var value in CollectBlpValues(
                targetDocument,
                target.Element,
                target.RelativePath,
                depth: 0,
                new HashSet<string>(StringComparer.Ordinal),
                traversal))
            {
                var xlpClass = RequiredText(value, "m_XLPClass", target.RelativePath);
                if (!SupportedXlpClasses.Contains(xlpClass))
                {
                    continue;
                }

                var parameterName = RequiredText(value, "m_ParamName", target.RelativePath);
                var entryName = RequiredText(value, "m_EntryName", target.RelativePath);
                var priority = CandidatePriority(xlpClass, parameterName, entryName);
                if (priority is null)
                {
                    continue;
                }

                var blpPackage = RequiredText(value, "m_BLPPackage", target.RelativePath);
                ValidatePackagePath(blpPackage, target.RelativePath);
                var containerPath = ResolveContainerPath(input, target.RelativePath, blpPackage);
                if (containerPath is null)
                {
                    continue;
                }

                result.Add(new(
                    priority.Value,
                    entryName,
                    xlpClass,
                    parameterName,
                    sourceRelativePath,
                    target.RelativePath,
                    containerPath));
            }
        }

        return result.Distinct().OrderBy(value => value.Priority)
            .ThenBy(value => value.ContainerRelativePath, StringComparer.Ordinal)
            .ThenBy(value => value.EntryName, StringComparer.Ordinal)
            .ToArray();
    }

    private static IEnumerable<XElement> CollectBlpValues(
        XDocument document,
        XElement element,
        string relativePath,
        int depth,
        HashSet<string> stack,
        ReferenceTraversalStats traversal)
    {
        traversal.Observe(depth);
        if (depth > 8)
        {
            throw new ExtractionException(
                "art-preview-reference-depth-exceeded",
                "StrategicView 引用深度超过安全上限。",
                relativePath);
        }

        foreach (var value in element.Descendants("Element")
            .Where(value => (string?)value.Attribute("class") == "AssetObjects..BLPEntryValue"))
        {
            yield return value;
        }

        foreach (var reference in element.Descendants("Element")
            .Where(value =>
                (string?)value.Attribute("class") == "AssetObjects..ArtDefReferenceValue" &&
                Text(value, "m_ArtDefPath") == "StrategicView.artdef"))
        {
            var rootName = Text(reference, "m_RootCollectionName");
            var targetName = Text(reference, "m_ElementName");
            if (string.IsNullOrWhiteSpace(targetName))
            {
                continue;
            }

            var identity = $"{rootName}\u001f{targetName}";
            if (!stack.Add(identity))
            {
                throw new ExtractionException(
                    "art-preview-reference-cycle",
                    "StrategicView 引用形成循环。",
                    $"{relativePath}/{rootName}/{targetName}");
            }

            var collections = document.Root?.Element("m_RootCollections")?.Elements("Element") ?? [];
            var selected = string.IsNullOrWhiteSpace(rootName)
                ? collections
                : collections.Where(value => Text(value, "m_CollectionName") == rootName);
            var matches = selected.SelectMany(value => value.Elements("Element"))
                .Where(value => Text(value, "m_Name") == targetName)
                .ToArray();
            if (matches.Length > 1)
            {
                throw new ExtractionException(
                    "art-preview-reference-invalid",
                    "StrategicView 内部引用目标缺失或不唯一。",
                    $"{relativePath}/{rootName}/{targetName}");
            }

            if (matches.Length == 0)
            {
                // PositionSet 等辅助引用可由较低范围继承，但不承载当前预览纹理；
                // 本层没有可证目标时不跨类别猜测，继续检查其他显式引用。
                continue;
            }

            foreach (var nested in CollectBlpValues(
                document,
                matches[0],
                relativePath,
                depth + 1,
                stack,
                traversal))
            {
                yield return nested;
            }

            stack.Remove(identity);
        }
    }

    private static PreviewCandidate? SelectCandidate(
        Civ6ContentDefinition definition,
        IReadOnlyList<PreviewCandidate> candidates,
        List<Civ6InstallationDiagnostic> diagnostics)
    {
        if (candidates.Count == 0)
        {
            diagnostics.Add(Placeholder(
                "art-preview-2d-chain-unavailable",
                "内容没有完整的 StrategicView 2D 静态纹理链，保留预览占位。",
                definition.Id));
            return null;
        }

        var priority = candidates.Min(value => value.Priority);
        var best = candidates.Where(value => value.Priority == priority).ToArray();
        var identities = best.Select(value =>
            $"{value.ContainerRelativePath}{value.EntryName}{value.XlpClass}")
            .Distinct(StringComparer.Ordinal)
            .ToArray();
        if (identities.Length != 1)
        {
            diagnostics.Add(Placeholder(
                "art-preview-selection-ambiguous",
                "同一内容存在多个语义不同的同优先级 2D 预览，未猜测选择。",
                definition.Id));
            return null;
        }

        if (best.Length > 1)
        {
            diagnostics.Add(new(
                "art-preview-equivalent-candidates-collapsed",
                "info",
                "多个显式候选指向同一纹理，已按稳定身份折叠。",
                definition.Id));
        }

        return best[0];
    }

    private static IEnumerable<StrategicReference> CollectStrategicReferences(
        XElement element,
        string sourceRelativePath)
    {
        foreach (var value in element.Descendants("Element")
            .Where(value =>
                (string?)value.Attribute("class") == "AssetObjects..ArtDefReferenceValue" &&
                Text(value, "m_ArtDefPath") == "StrategicView.artdef"))
        {
            var targetName = Text(value, "m_ElementName");
            if (string.IsNullOrWhiteSpace(targetName) && Text(value, "m_ParamName") == "Xref")
            {
                targetName = value.Parent?.Elements("Element")
                    .FirstOrDefault(candidate => Text(candidate, "m_ParamName") == "XrefName")?
                    .Element("m_Value")?.Attribute("text")?.Value ?? string.Empty;
            }

            if (string.IsNullOrWhiteSpace(targetName))
            {
                continue;
            }

            yield return new(
                Text(value, "m_RootCollectionName"),
                targetName,
                sourceRelativePath);
        }
    }

    private static async Task<(string RelativePath, XElement Element)> ResolveReferenceAsync(
        SafeInputRoot input,
        StrategicReference reference,
        Dictionary<string, XDocument> documents,
        CancellationToken cancellationToken)
    {
        foreach (var scope in ScopeCandidates(reference.SourceRelativePath))
        {
            var path = $"{scope}/ArtDefs/StrategicView.artdef";
            if (!input.TryResolveExistingFile(path, out _))
            {
                continue;
            }

            var document = await LoadDocumentAsync(input, path, documents, cancellationToken);
            var collections = document.Root?.Element("m_RootCollections")?.Elements("Element") ?? [];
            var selected = string.IsNullOrWhiteSpace(reference.RootCollectionName)
                ? collections
                : collections.Where(value => Text(value, "m_CollectionName") == reference.RootCollectionName);
            var matches = selected.SelectMany(value => value.Elements("Element"))
                .Where(value => Text(value, "m_Name") == reference.TargetName)
                .ToArray();
            if (matches.Length > 1)
            {
                throw new ExtractionException(
                    "art-preview-reference-ambiguous",
                    "StrategicView 引用目标不唯一。",
                    $"{path}/{reference.TargetName}");
            }

            if (matches.Length == 1)
            {
                return (path, matches[0]);
            }
        }

        throw new ExtractionException(
            "art-preview-reference-missing",
            "StrategicView 引用目标不存在于固定 Base/Expansion 白名单。",
            $"{reference.SourceRelativePath}/{reference.TargetName}");
    }

    private static async Task<XDocument> LoadDocumentAsync(
        SafeInputRoot input,
        string relativePath,
        Dictionary<string, XDocument> documents,
        CancellationToken cancellationToken)
    {
        if (documents.TryGetValue(relativePath, out var existing))
        {
            return existing;
        }

        var document = SecureXml.Parse(
            await input.ReadAllBytesAsync(relativePath, cancellationToken),
            relativePath);
        var version = document.Root?.Element("m_Version");
        if (document.Root?.Name.LocalName != "AssetObjects..ArtDefSet" ||
            !int.TryParse(version?.Element("major")?.Value, out var major) ||
            major is not (3 or 4) ||
            !int.TryParse(version?.Element("minor")?.Value, out var minor) ||
            minor != 0)
        {
            throw new ExtractionException(
                "input-artdef-schema-unsupported",
                "ArtDef 根或版本不在已验证的正式 Civ6 范围。",
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
            .Where(value => Text(value, "m_CollectionName") == collectionName)
            .ToArray() ?? [];
        if (collections.Length != 1)
        {
            throw new ExtractionException(
                "input-artdef-collection-invalid",
                "ArtDef 根集合缺失或不唯一。",
                $"{relativePath}/{collectionName}");
        }

        var result = new Dictionary<string, XElement>(StringComparer.Ordinal);
        foreach (var element in collections[0].Elements("Element"))
        {
            var name = Text(element, "m_Name");
            if (string.IsNullOrWhiteSpace(name) || !result.TryAdd(name, element))
            {
                throw new ExtractionException(
                    "input-artdef-element-duplicate",
                    "ArtDef 元素名称缺失或重复。",
                    $"{relativePath}/{name}");
            }
        }

        return result;
    }

    internal static int? CandidatePriority(string xlpClass, string parameterName, string entryName)
    {
        if (entryName == "DoNotRender")
        {
            // 正式 StrategicView 用该哨兵表示有意不渲染，不能把透明占位纹理冒充内容预览。
            return null;
        }

        var statePenalty = entryName.EndsWith("_Pillaged", StringComparison.Ordinal) ||
            entryName.Contains("_Pillaged_", StringComparison.Ordinal)
            ? 2
            : 0;
        var basePriority = (xlpClass, parameterName) switch
        {
            ("StrategicView_Sprite", "Visible_XLPEntry") => 0,
            ("StrategicView_Route", "RouteXLPEntry") => 0,
            ("StrategicView_Sprite", "Primary_XLPEntry") => 0,
            ("StrategicView_Sprite", "Revealed_XLPEntry") => 1,
            _ => (int?)null,
        };
        return basePriority is null ? null : basePriority + statePenalty;
    }

    private static string? ResolveContainerPath(
        SafeInputRoot input,
        string sourceRelativePath,
        string blpPackage)
    {
        foreach (var scope in ScopeCandidates(sourceRelativePath))
        {
            var path = $"{scope}/Platforms/Windows/BLPs/{blpPackage}.blp";
            if (input.TryResolveExistingFile(path, out _))
            {
                return path;
            }
        }

        return null;
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
                "StrategicView 的 BLP 包路径不是规范相对路径。",
                sourceRelativePath);
        }
    }

    private static string RequiredText(XElement element, string childName, string path)
    {
        var value = Text(element, childName);
        if (string.IsNullOrWhiteSpace(value))
        {
            throw new ExtractionException(
                "input-artdef-blp-reference-invalid",
                "StrategicView BLP 引用缺少必需字段。",
                $"{path}/{childName}");
        }

        return value;
    }

    private static string Text(XElement element, string childName) =>
        element.Element(childName)?.Attribute("text")?.Value ?? string.Empty;

    private static Civ6InstallationDiagnostic Placeholder(string code, string message, string path) =>
        new(code, "warning", message, path);

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

    private static string Slug(string value) => value.ToLowerInvariant().Replace('_', '-');

    private sealed record StrategicReference(
        string RootCollectionName,
        string TargetName,
        string SourceRelativePath);

    private sealed record PreviewCandidate(
        int Priority,
        string EntryName,
        string XlpClass,
        string ParameterName,
        string ContentArtDefRelativePath,
        string StrategicArtDefRelativePath,
        string ContainerRelativePath);

    private sealed class ReferenceTraversalStats
    {
        public int MaximumDepth { get; private set; }

        public void Observe(int depth) => MaximumDepth = Math.Max(MaximumDepth, depth);
    }
}
