namespace Tessera.Civ6.Extractor.Core;

/// <summary>
/// 生成目录只存在于唯一 staging 中；正式用户制品只有归档，既有同名目录永不移动或覆盖。
/// </summary>
internal static class AtomicArchivePublisher
{
    public static async Task PublishAsync(
        string stagingBasePath,
        string archivePath,
        Func<string, Task> buildDirectory,
        CancellationToken cancellationToken)
    {
        var stagingBase = NormalizeStagingBase(stagingBasePath);
        var archive = NormalizeArchivePath(archivePath, stagingBase);
        var parent = Directory.GetParent(stagingBase)!.FullName;
        Directory.CreateDirectory(parent);
        var nonce = Guid.NewGuid().ToString("N");
        var stagingDirectory = Path.Combine(parent, $".{Path.GetFileName(stagingBase)}.staging-{nonce}");
        var stagingArchive = Path.Combine(parent, $".{Path.GetFileName(archive)}.staging-{nonce}");
        var promoted = false;

        try
        {
            Directory.CreateDirectory(stagingDirectory);
            await buildDirectory(stagingDirectory);
            cancellationToken.ThrowIfCancellationRequested();
            await PackageArchiveBuilder.CreateAndValidateAsync(
                stagingDirectory,
                stagingArchive,
                cancellationToken);
            cancellationToken.ThrowIfCancellationRequested();

            if (File.Exists(archive))
            {
                File.Replace(stagingArchive, archive, destinationBackupFileName: null, ignoreMetadataErrors: true);
            }
            else
            {
                File.Move(stagingArchive, archive);
            }
            promoted = true;
        }
        catch (OperationCanceledException)
        {
            throw;
        }
        catch (ExtractionException)
        {
            throw;
        }
        catch (Exception error)
        {
            throw new ExtractionException(
                "output-publish-failed",
                "无法原子发布导入归档，旧归档和既有输出目录均未改变。",
                "archivePath",
                error);
        }
        finally
        {
            DeleteDirectoryBestEffort(stagingDirectory);
            if (!promoted)
            {
                DeleteFileBestEffort(stagingArchive);
            }
        }
    }

    private static string NormalizeStagingBase(string path)
    {
        if (string.IsNullOrWhiteSpace(path))
        {
            throw new ExtractionException("output-directory-required", "必须明确指定输出位置。", "outputDirectory");
        }

        var fullPath = Path.TrimEndingDirectorySeparator(Path.GetFullPath(path));
        if (Directory.GetParent(fullPath) is null)
        {
            throw new ExtractionException("output-directory-invalid", "输出位置不能是文件系统根目录。", "outputDirectory");
        }
        return fullPath;
    }

    private static string NormalizeArchivePath(string path, string stagingBase)
    {
        var archive = Path.GetFullPath(path);
        if (!archive.EndsWith(".tessera-module.zip", StringComparison.Ordinal) ||
            !string.Equals(
                Path.GetDirectoryName(archive),
                Directory.GetParent(stagingBase)!.FullName,
                StringComparison.OrdinalIgnoreCase))
        {
            throw new ExtractionException(
                "output-archive-invalid",
                "导入归档必须使用 .tessera-module.zip 扩展名并位于所选输出位置。",
                "archivePath");
        }
        return archive;
    }

    private static void DeleteDirectoryBestEffort(string path)
    {
        if (!Directory.Exists(path)) return;
        try { Directory.Delete(path, recursive: true); }
        catch (IOException) { /* 临时目录被占用时不触碰既有用户输出。 */ }
        catch (UnauthorizedAccessException) { /* 清理失败不扩大到其他路径。 */ }
    }

    private static void DeleteFileBestEffort(string path)
    {
        if (!File.Exists(path)) return;
        try { File.Delete(path); }
        catch (IOException) { /* 临时文件被占用时不触碰旧归档。 */ }
        catch (UnauthorizedAccessException) { /* 清理失败不扩大到其他路径。 */ }
    }
}
