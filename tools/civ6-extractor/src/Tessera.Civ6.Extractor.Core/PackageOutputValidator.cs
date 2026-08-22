using System.Text.Json;

namespace Tessera.Civ6.Extractor.Core;

public interface IPackageOutputValidator
{
    Task ValidateAsync(string packageDirectory, CancellationToken cancellationToken);
}

public sealed class PackageOutputValidator : IPackageOutputValidator
{
    private static readonly HashSet<string> AllowedExtensions = new(StringComparer.OrdinalIgnoreCase)
    {
        ".json",
        ".png",
        ".webp",
    };

    public async Task ValidateAsync(string packageDirectory, CancellationToken cancellationToken)
    {
        var files = Directory.EnumerateFiles(packageDirectory, "*", SearchOption.AllDirectories).ToArray();
        if (files.Length == 0 || files.Any(path => !AllowedExtensions.Contains(Path.GetExtension(path))))
        {
            throw new ExtractionException("output-content-forbidden", "生成包只能包含静态 PNG/WebP 与 JSON。", "package");
        }

        foreach (var required in new[]
        {
            "module.json",
            "catalog/content-catalog.json",
            "provenance/source-manifest.json",
            "elements/content.json",
            "locales/zh-CN.json",
        })
        {
            if (!File.Exists(Path.Combine(packageDirectory, required.Replace('/', Path.DirectorySeparatorChar))))
            {
                throw new ExtractionException("output-file-missing", "生成包缺少必需文件。", required);
            }
        }

        foreach (var path in files.Where(path => Path.GetExtension(path).Equals(".json", StringComparison.OrdinalIgnoreCase)))
        {
            await using var stream = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.Read, 64 * 1024, FileOptions.Asynchronous);
            try
            {
                using var document = await JsonDocument.ParseAsync(stream, cancellationToken: cancellationToken);
                if (document.RootElement.ValueKind is not (JsonValueKind.Object or JsonValueKind.Array))
                {
                    throw new JsonException("JSON 根必须是对象或数组。");
                }
            }
            catch (JsonException error)
            {
                throw new ExtractionException("output-json-invalid", "生成的 JSON 无效。", Path.GetRelativePath(packageDirectory, path), error);
            }
        }

        using var module = JsonDocument.Parse(await File.ReadAllBytesAsync(Path.Combine(packageDirectory, "module.json"), cancellationToken));
        var root = module.RootElement;
        if (root.GetProperty("kind").GetString() != "module" ||
            root.GetProperty("moduleId").GetString() != "tessera.civ6" ||
            root.GetProperty("packageSource").GetProperty("kind").GetString() != "generated-local")
        {
            throw new ExtractionException("output-module-invalid", "生成的模块清单身份或来源无效。", "module.json");
        }
    }
}
