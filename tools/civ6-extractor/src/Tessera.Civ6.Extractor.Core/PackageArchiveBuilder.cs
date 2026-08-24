using System.Buffers.Binary;
using System.IO.Compression;
using System.Text;

namespace Tessera.Civ6.Extractor.Core;

/// <summary>
/// 从已验证目录创建网站文件选择器可导入的稳定归档。
/// .NET 在发布前验证归档结构与目录字节等价；Module Format 的唯一事实仍由跨语言门禁和网站导入复验。
/// </summary>
internal static class PackageArchiveBuilder
{
    private const int BufferBytes = 64 * 1024;
    private static readonly DateTimeOffset StableTimestamp = new(1980, 1, 1, 0, 0, 0, TimeSpan.Zero);
    private static readonly UTF8Encoding StrictUtf8 = new(false, true);

    public static async Task CreateAndValidateAsync(
        string packageDirectory,
        string archivePath,
        CancellationToken cancellationToken,
        PackageArchiveLimits? limits = null)
    {
        limits ??= PackageArchiveLimits.Default;
        var files = EnumerateFiles(packageDirectory, limits, cancellationToken);
        await CreateArchiveAsync(files, archivePath, cancellationToken);
        await ValidateArchiveAsync(files, archivePath, limits, cancellationToken);
    }

    internal static Task ValidateExistingAsync(
        string packageDirectory,
        string archivePath,
        CancellationToken cancellationToken,
        PackageArchiveLimits? limits = null)
    {
        limits ??= PackageArchiveLimits.Default;
        return ValidateArchiveAsync(
            EnumerateFiles(packageDirectory, limits, cancellationToken),
            archivePath,
            limits,
            cancellationToken);
    }

    private static PackageFile[] EnumerateFiles(
        string packageDirectory,
        PackageArchiveLimits limits,
        CancellationToken cancellationToken)
    {
        var root = Path.TrimEndingDirectorySeparator(Path.GetFullPath(packageDirectory));
        var pending = new Stack<string>();
        var files = new List<PackageFile>();
        var exactPaths = new HashSet<string>(StringComparer.Ordinal);
        var foldedPaths = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        long totalBytes = 0;
        pending.Push(root);

        while (pending.Count > 0)
        {
            cancellationToken.ThrowIfCancellationRequested();
            var directory = pending.Pop();
            foreach (var entry in new DirectoryInfo(directory).EnumerateFileSystemInfos()
                         .OrderBy(value => value.Name, StringComparer.Ordinal))
            {
                cancellationToken.ThrowIfCancellationRequested();
                if ((entry.Attributes & FileAttributes.ReparsePoint) != 0)
                {
                    throw Invalid("生成目录不能包含重解析点。", Relative(root, entry.FullName));
                }

                if (entry is DirectoryInfo child)
                {
                    pending.Push(child.FullName);
                    continue;
                }

                if (entry is not FileInfo file)
                {
                    throw Invalid("生成目录只能包含普通文件和目录。", Relative(root, entry.FullName));
                }

                var path = Relative(root, file.FullName);
                ValidatePath(path);
                if (!exactPaths.Add(path) || !foldedPaths.Add(path))
                {
                    throw Invalid("生成目录包含重复或大小写冲突的归档路径。", path);
                }

                totalBytes = checked(totalBytes + file.Length);
                if (files.Count >= limits.MaxFiles || totalBytes > limits.MaxExpandedBytes)
                {
                    throw Invalid("生成目录超过归档文件数或展开体积上限。", "package");
                }

                files.Add(new(path, file.FullName, file.Length));
            }
        }

        if (files.Count == 0)
        {
            throw Invalid("生成目录不能为空。", "package");
        }

        return files.OrderBy(value => value.Path, StringComparer.Ordinal).ToArray();
    }

    private static async Task CreateArchiveAsync(
        IReadOnlyList<PackageFile> files,
        string archivePath,
        CancellationToken cancellationToken)
    {
        await using var output = new FileStream(
            archivePath,
            FileMode.CreateNew,
            FileAccess.ReadWrite,
            FileShare.None,
            BufferBytes,
            FileOptions.Asynchronous | FileOptions.SequentialScan);
        using var archive = new ZipArchive(output, ZipArchiveMode.Create, leaveOpen: true, StrictUtf8);
        foreach (var file in files)
        {
            cancellationToken.ThrowIfCancellationRequested();
            var entry = archive.CreateEntry(file.Path, CompressionLevel.SmallestSize);
            entry.LastWriteTime = StableTimestamp;
            entry.ExternalAttributes = 0;
            await using var source = new FileStream(
                file.FullPath,
                FileMode.Open,
                FileAccess.Read,
                FileShare.Read,
                BufferBytes,
                FileOptions.Asynchronous | FileOptions.SequentialScan);
            await using var destination = entry.Open();
            await source.CopyToAsync(destination, BufferBytes, cancellationToken);
        }
    }

    private static async Task ValidateArchiveAsync(
        IReadOnlyList<PackageFile> expected,
        string archivePath,
        PackageArchiveLimits limits,
        CancellationToken cancellationToken)
    {
        await ValidateCentralDirectoryAsync(archivePath, expected, limits, cancellationToken);
        await using var stream = new FileStream(
            archivePath,
            FileMode.Open,
            FileAccess.Read,
            FileShare.Read,
            BufferBytes,
            FileOptions.Asynchronous | FileOptions.RandomAccess);
        using var archive = new ZipArchive(stream, ZipArchiveMode.Read, leaveOpen: true, StrictUtf8);
        if (archive.Entries.Count != expected.Count)
        {
            throw Invalid("归档条目数量与生成目录不一致。", "archive");
        }

        for (var index = 0; index < expected.Count; index++)
        {
            cancellationToken.ThrowIfCancellationRequested();
            var expectedFile = expected[index];
            var actual = archive.Entries[index];
            if (actual.Name.Length == 0 || actual.FullName != expectedFile.Path || actual.Length != expectedFile.Bytes)
            {
                throw Invalid("归档条目与生成目录不一致。", actual.FullName);
            }

            await using var source = new FileStream(
                expectedFile.FullPath,
                FileMode.Open,
                FileAccess.Read,
                FileShare.Read,
                BufferBytes,
                FileOptions.Asynchronous | FileOptions.SequentialScan);
            await using var archived = actual.Open();
            await EnsureStreamsEqualAsync(source, archived, actual.FullName, cancellationToken);
        }
    }

    internal static async Task EnsureStreamsEqualAsync(
        Stream expected,
        Stream actual,
        string path,
        CancellationToken cancellationToken)
    {
        var expectedBuffer = new byte[BufferBytes];
        var actualBuffer = new byte[BufferBytes];
        while (true)
        {
            // FileStream 与 DeflateStream 可在不同边界返回短读；填满缓冲区后再比较才是真正的字节等价。
            var expectedRead = await FillBufferAsync(expected, expectedBuffer, cancellationToken);
            var actualRead = await FillBufferAsync(actual, actualBuffer, cancellationToken);
            if (expectedRead != actualRead ||
                !expectedBuffer.AsSpan(0, expectedRead).SequenceEqual(actualBuffer.AsSpan(0, actualRead)))
            {
                throw Invalid("归档内容与生成目录不一致。", path);
            }
            if (expectedRead == 0) return;
        }
    }

    private static async Task<int> FillBufferAsync(
        Stream stream,
        byte[] buffer,
        CancellationToken cancellationToken)
    {
        var total = 0;
        while (total < buffer.Length)
        {
            var read = await stream.ReadAsync(buffer.AsMemory(total), cancellationToken);
            if (read == 0) break;
            total += read;
        }
        return total;
    }

    private static async Task ValidateCentralDirectoryAsync(
        string archivePath,
        IReadOnlyList<PackageFile> expected,
        PackageArchiveLimits limits,
        CancellationToken cancellationToken)
    {
        await using var stream = new FileStream(
            archivePath, FileMode.Open, FileAccess.Read, FileShare.Read, BufferBytes,
            FileOptions.Asynchronous | FileOptions.RandomAccess);
        if (stream.Length < 22 || stream.Length > limits.MaxExpandedBytes)
            throw Invalid("归档体积无效。", "archive");

        var tailBytes = checked((int)Math.Min(stream.Length, 65_557));
        var tail = new byte[tailBytes];
        stream.Position = stream.Length - tailBytes;
        await stream.ReadExactlyAsync(tail, cancellationToken);
        var eocd = FindEndOfCentralDirectory(tail);
        if (eocd < 0) throw Invalid("归档缺少有效中央目录。", "archive");

        var view = tail.AsSpan(eocd);
        var entryCount = ReadUInt16(view, 10);
        var centralBytes = ReadUInt32(view, 12);
        var centralOffset = ReadUInt32(view, 16);
        if (ReadUInt16(view, 4) != 0 || ReadUInt16(view, 6) != 0 ||
            ReadUInt16(view, 8) != entryCount || entryCount != expected.Count ||
            checked((long)centralOffset + centralBytes) > stream.Length - 22)
        {
            throw Invalid("归档中央目录边界或计数无效。", "archive");
        }

        stream.Position = centralOffset;
        var exactPaths = new HashSet<string>(StringComparer.Ordinal);
        var foldedPaths = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var filePaths = new HashSet<string>(StringComparer.Ordinal);
        var directoryPaths = new HashSet<string>(StringComparer.Ordinal);
        for (var index = 0; index < entryCount; index++)
        {
            cancellationToken.ThrowIfCancellationRequested();
            var header = new byte[46];
            await stream.ReadExactlyAsync(header, cancellationToken);
            if (ReadUInt32(header, 0) != 0x02014b50) throw Invalid("归档中央目录条目无效。", "archive");
            var flags = ReadUInt16(header, 8);
            var method = ReadUInt16(header, 10);
            var pathBytes = ReadUInt16(header, 28);
            var extraBytes = ReadUInt16(header, 30);
            var commentBytes = ReadUInt16(header, 32);
            if ((flags & 1) != 0 || method is not (0 or 8) || pathBytes == 0 || pathBytes > 512)
                throw Invalid("归档使用了不允许的加密、压缩方法或路径长度。", "archive");

            var encodedPath = new byte[pathBytes];
            await stream.ReadExactlyAsync(encodedPath, cancellationToken);
            string path;
            try { path = StrictUtf8.GetString(encodedPath); }
            catch (DecoderFallbackException error) { throw Invalid("归档路径不是有效 UTF-8。", "archive", error); }
            ValidatePath(path);
            if (!exactPaths.Add(path) || !foldedPaths.Add(path))
                throw Invalid("归档包含重复或大小写冲突的路径。", path);
            var segments = path.Split('/');
            for (var segment = 1; segment < segments.Length; segment++)
            {
                var directory = string.Join('/', segments.AsSpan(0, segment).ToArray());
                if (filePaths.Contains(directory))
                    throw Invalid("归档中文件和目录路径发生歧义。", path);
                directoryPaths.Add(directory);
            }
            if (directoryPaths.Contains(path))
                throw Invalid("归档中文件和目录路径发生歧义。", path);
            filePaths.Add(path);
            if (path != expected[index].Path) throw Invalid("归档条目顺序或路径不稳定。", path);
            stream.Seek(checked(extraBytes + commentBytes), SeekOrigin.Current);
        }

        if (stream.Position != checked((long)centralOffset + centralBytes))
            throw Invalid("归档中央目录长度不闭合。", "archive");
    }

    private static int FindEndOfCentralDirectory(ReadOnlySpan<byte> tail)
    {
        for (var offset = tail.Length - 22; offset >= 0; offset--)
        {
            if (ReadUInt32(tail, offset) == 0x06054b50 &&
                offset + 22 + ReadUInt16(tail, offset + 20) == tail.Length)
                return offset;
        }
        return -1;
    }

    private static void ValidatePath(string path)
    {
        if (string.IsNullOrEmpty(path) || path.Length > 512 || path[0] == '/' || path[^1] == '/' ||
            path.Contains('\\', StringComparison.Ordinal) || path.Contains('\0', StringComparison.Ordinal) ||
            Path.IsPathFullyQualified(path) || path.Split('/').Any(value => value is "" or "." or ".."))
            throw Invalid("归档路径不是规范相对路径。", path);
    }

    private static string Relative(string root, string path) =>
        Path.GetRelativePath(root, path).Replace('\\', '/');

    private static ushort ReadUInt16(ReadOnlySpan<byte> value, int offset) =>
        BinaryPrimitives.ReadUInt16LittleEndian(value[offset..]);

    private static uint ReadUInt32(ReadOnlySpan<byte> value, int offset) =>
        BinaryPrimitives.ReadUInt32LittleEndian(value[offset..]);

    private static ExtractionException Invalid(string message, string path, Exception? inner = null) =>
        new("output-archive-invalid", message, path, inner);

    private sealed record PackageFile(string Path, string FullPath, long Bytes);
}

internal sealed record PackageArchiveLimits(int MaxFiles, long MaxExpandedBytes)
{
    public static PackageArchiveLimits Default { get; } = new(65_535, 2L * 1024 * 1024 * 1024);
}
