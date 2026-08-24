namespace Tessera.Civ6.Extractor.Core;

internal static class AtomicDirectoryPublisher
{
    public static async Task PublishAsync(
        string outputDirectory,
        Func<string, Task> buildStaging,
        CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(outputDirectory))
        {
            throw new ExtractionException("output-directory-required", "必须明确指定输出目录。", "outputDirectory");
        }

        var output = Path.TrimEndingDirectorySeparator(Path.GetFullPath(outputDirectory));
        var parent = Directory.GetParent(output)?.FullName
            ?? throw new ExtractionException("output-directory-invalid", "输出目录不能是文件系统根目录。", "outputDirectory");
        Directory.CreateDirectory(parent);
        var name = Path.GetFileName(output);
        var nonce = Guid.NewGuid().ToString("N");
        var staging = Path.Combine(parent, $".{name}.staging-{nonce}");
        var backup = Path.Combine(parent, $".{name}.backup-{nonce}");
        var movedExisting = false;
        var promoted = false;

        try
        {
            Directory.CreateDirectory(staging);
            await buildStaging(staging);
            cancellationToken.ThrowIfCancellationRequested();
            if (Directory.Exists(output))
            {
                Directory.Move(output, backup);
                movedExisting = true;
            }

            try
            {
                Directory.Move(staging, output);
                promoted = true;
            }
            catch
            {
                if (movedExisting && !Directory.Exists(output) && Directory.Exists(backup))
                {
                    Directory.Move(backup, output);
                    movedExisting = false;
                }

                throw;
            }

            if (movedExisting)
            {
                try
                {
                    Directory.Delete(backup, recursive: true);
                }
                catch (IOException)
                {
                    // 新目录已经发布成功；旧备份清理失败不能把成功误报为生成失败。
                }
                catch (UnauthorizedAccessException)
                {
                    // 杀毒软件短暂占用备份时保留可恢复副本，后续运行可安全清理。
                }

                movedExisting = false;
            }
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
            throw new ExtractionException("output-publish-failed", "无法原子发布生成包，旧输出已保留。", "outputDirectory", error);
        }
        finally
        {
            if (!promoted && Directory.Exists(staging))
            {
                Directory.Delete(staging, recursive: true);
            }

            if (movedExisting && Directory.Exists(backup) && !Directory.Exists(output))
            {
                Directory.Move(backup, output);
            }
        }
    }
}
