namespace Tessera.Civ6.Extractor.Core;

internal sealed class SafeInputRoot
{
    private static readonly HashSet<string> ForbiddenSegments = new(StringComparer.OrdinalIgnoreCase)
    {
        "SDK",
        "SDK Assets",
        "ModBuddy",
        "Mods",
    };

    private readonly string rootWithSeparator;

    private SafeInputRoot(string root)
    {
        Root = root;
        rootWithSeparator = root.EndsWith(Path.DirectorySeparatorChar)
            ? root
            : root + Path.DirectorySeparatorChar;
    }

    public string Root { get; }

    public static SafeInputRoot Open(string path)
    {
        if (string.IsNullOrWhiteSpace(path))
        {
            throw new ExtractionException("input-directory-required", "必须明确指定正式游戏输入目录。", "inputDirectory");
        }

        var root = Path.GetFullPath(path);
        if (!Directory.Exists(root))
        {
            throw new ExtractionException("input-directory-not-found", "输入目录不存在。", "inputDirectory");
        }

        if (root.Split(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar)
            .Any(ForbiddenSegments.Contains))
        {
            throw new ExtractionException("input-directory-forbidden", "输入目录不能是 SDK、ModBuddy 或模组目录。", "inputDirectory");
        }

        EnsureNotReparsePoint(root, "inputDirectory");
        return new SafeInputRoot(root);
    }

    public string ResolveExistingFile(string relativePath)
    {
        if (Path.IsPathFullyQualified(relativePath) || relativePath.Contains("..", StringComparison.Ordinal))
        {
            throw new ExtractionException("input-path-invalid", "输入文件路径必须是游戏根目录下的规范相对路径。", relativePath);
        }

        var fullPath = Path.GetFullPath(Path.Combine(Root, relativePath.Replace('/', Path.DirectorySeparatorChar)));
        if (!fullPath.StartsWith(rootWithSeparator, StringComparison.OrdinalIgnoreCase) || !File.Exists(fullPath))
        {
            throw new ExtractionException("input-file-missing", "缺少提取所需的正式游戏输入文件。", relativePath);
        }

        EnsurePathHasNoReparsePoint(fullPath, relativePath);
        return fullPath;
    }

    public async Task<byte[]> ReadAllBytesAsync(string relativePath, CancellationToken cancellationToken)
    {
        var fullPath = ResolveExistingFile(relativePath);
        await using var stream = new FileStream(
            fullPath,
            FileMode.Open,
            FileAccess.Read,
            FileShare.Read,
            bufferSize: 64 * 1024,
            FileOptions.Asynchronous | FileOptions.SequentialScan);
        if (stream.Length > 64 * 1024 * 1024)
        {
            throw new ExtractionException("input-file-too-large", "单个提取输入文件超过 64 MiB 安全上限。", relativePath);
        }

        var bytes = new byte[stream.Length];
        await stream.ReadExactlyAsync(bytes, cancellationToken);
        return bytes;
    }

    private static void EnsurePathHasNoReparsePoint(string fullPath, string fieldPath)
    {
        var current = new FileInfo(fullPath);
        EnsureNotReparsePoint(current.FullName, fieldPath);
        for (var parent = current.Directory; parent is not null; parent = parent.Parent)
        {
            EnsureNotReparsePoint(parent.FullName, fieldPath);
        }
    }

    private static void EnsureNotReparsePoint(string path, string fieldPath)
    {
        if ((File.GetAttributes(path) & FileAttributes.ReparsePoint) != 0)
        {
            throw new ExtractionException("input-path-reparse-point", "输入路径不能穿过符号链接或重解析点。", fieldPath);
        }
    }
}
