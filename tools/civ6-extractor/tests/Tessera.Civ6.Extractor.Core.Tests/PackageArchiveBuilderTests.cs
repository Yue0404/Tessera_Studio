using System.Buffers.Binary;
using System.IO.Compression;

namespace Tessera.Civ6.Extractor.Core.Tests;

public sealed class PackageArchiveBuilderTests
{
    [Fact]
    public async Task 归档按规范路径排序且内容与目录逐字节相同()
    {
        using var fixture = new ArchiveFixture();
        fixture.Write("z-last.bin", [0, 1, 2, 255]);
        fixture.Write("a-first/中文.txt", [0xE4, 0xB8, 0xAD]);

        await PackageArchiveBuilder.CreateAndValidateAsync(
            fixture.PackageDirectory,
            fixture.ArchivePath,
            CancellationToken.None);

        using var archive = ZipFile.OpenRead(fixture.ArchivePath);
        Assert.Equal(["a-first/中文.txt", "z-last.bin"], archive.Entries.Select(value => value.FullName));
        Assert.All(archive.Entries, entry => Assert.NotEmpty(entry.Name));
        foreach (var entry in archive.Entries)
        {
            await using var actual = entry.Open();
            using var buffer = new MemoryStream();
            await actual.CopyToAsync(buffer, CancellationToken.None);
            Assert.Equal(
                await File.ReadAllBytesAsync(
                    Path.Combine(fixture.PackageDirectory, entry.FullName.Replace('/', Path.DirectorySeparatorChar)),
                    CancellationToken.None),
                buffer.ToArray());
        }
    }

    [Fact]
    public async Task 文件数超过前置上限时不创建归档()
    {
        using var fixture = new ArchiveFixture();
        fixture.Write("one.json", [1]);
        fixture.Write("two.json", [2]);

        var error = await Assert.ThrowsAsync<ExtractionException>(() =>
            PackageArchiveBuilder.CreateAndValidateAsync(
                fixture.PackageDirectory,
                fixture.ArchivePath,
                CancellationToken.None,
                new PackageArchiveLimits(1, 1024)));

        Assert.Equal("output-archive-invalid", error.Code);
        Assert.False(File.Exists(fixture.ArchivePath));
    }

    [Fact]
    public async Task 展开字节超过前置上限时不创建归档()
    {
        using var fixture = new ArchiveFixture();
        fixture.Write("large.bin", [1, 2]);

        var error = await Assert.ThrowsAsync<ExtractionException>(() =>
            PackageArchiveBuilder.CreateAndValidateAsync(
                fixture.PackageDirectory,
                fixture.ArchivePath,
                CancellationToken.None,
                new PackageArchiveLimits(10, 1)));

        Assert.Equal("output-archive-invalid", error.Code);
        Assert.False(File.Exists(fixture.ArchivePath));
    }

    [Fact]
    public async Task 归档路径穿越被拒绝()
    {
        using var fixture = new ArchiveFixture();
        fixture.Write("safe.txt", [1]);
        fixture.CreateArchive(("../escape.txt", new byte[] { 1 }));

        var error = await Assert.ThrowsAsync<ExtractionException>(() => fixture.ValidateAsync());

        Assert.Equal("output-archive-invalid", error.Code);
    }

    [Fact]
    public async Task 重复路径被拒绝()
    {
        using var fixture = new ArchiveFixture();
        fixture.Write("dup.txt", [1]);
        fixture.Write("second.txt", [2]);
        fixture.CreateArchive(("dup.txt", new byte[] { 1 }), ("dup.txt", new byte[] { 2 }));

        var error = await Assert.ThrowsAsync<ExtractionException>(() => fixture.ValidateAsync());

        Assert.Equal("output-archive-invalid", error.Code);
    }

    [Fact]
    public async Task 文件和目录路径歧义被拒绝()
    {
        using var fixture = new ArchiveFixture();
        fixture.Write("folder", [1]);
        fixture.Write("other/item.txt", [2]);
        fixture.CreateArchive(("folder", new byte[] { 1 }), ("folder/item.txt", new byte[] { 2 }));

        var error = await Assert.ThrowsAsync<ExtractionException>(() => fixture.ValidateAsync());

        Assert.Equal("output-archive-invalid", error.Code);
    }

    [Fact]
    public async Task 非Store或Deflate压缩方法被拒绝()
    {
        using var fixture = new ArchiveFixture();
        fixture.Write("safe.txt", [1]);
        fixture.CreateArchive(("safe.txt", new byte[] { 1 }));
        var bytes = await File.ReadAllBytesAsync(fixture.ArchivePath, CancellationToken.None);
        var central = FindSignature(bytes, 0x02014b50);
        Assert.True(central >= 0);
        BinaryPrimitives.WriteUInt16LittleEndian(bytes.AsSpan(central + 10, 2), 99);
        await File.WriteAllBytesAsync(fixture.ArchivePath, bytes, CancellationToken.None);

        var error = await Assert.ThrowsAsync<ExtractionException>(() => fixture.ValidateAsync());

        Assert.Equal("output-archive-invalid", error.Code);
    }

    [Fact]
    public async Task 流分块边界不同但内容相同时仍通过()
    {
        var bytes = Enumerable.Range(0, 200_000).Select(value => (byte)(value % 251)).ToArray();
        await using var expected = new ChunkedReadStream(bytes, 37);
        await using var actual = new ChunkedReadStream(bytes, 4_093);

        await PackageArchiveBuilder.EnsureStreamsEqualAsync(
            expected,
            actual,
            "assets/test.png",
            CancellationToken.None);
    }

    [Fact]
    public async Task 流末尾截断被拒绝()
    {
        await using var expected = new ChunkedReadStream([1, 2, 3], 2);
        await using var actual = new ChunkedReadStream([1, 2], 1);

        var error = await Assert.ThrowsAsync<ExtractionException>(() =>
            PackageArchiveBuilder.EnsureStreamsEqualAsync(
                expected,
                actual,
                "assets/test.png",
                CancellationToken.None));

        Assert.Equal("output-archive-invalid", error.Code);
    }

    [Fact]
    public async Task 流单字节差异被拒绝()
    {
        await using var expected = new ChunkedReadStream([1, 2, 3], 1);
        await using var actual = new ChunkedReadStream([1, 9, 3], 2);

        var error = await Assert.ThrowsAsync<ExtractionException>(() =>
            PackageArchiveBuilder.EnsureStreamsEqualAsync(
                expected,
                actual,
                "assets/test.png",
                CancellationToken.None));

        Assert.Equal("output-archive-invalid", error.Code);
    }

    private static int FindSignature(ReadOnlySpan<byte> bytes, uint signature)
    {
        for (var index = 0; index <= bytes.Length - sizeof(uint); index++)
        {
            if (BinaryPrimitives.ReadUInt32LittleEndian(bytes[index..]) == signature) return index;
        }
        return -1;
    }

    private sealed class ArchiveFixture : IDisposable
    {
        private readonly string _root = Path.Combine(Path.GetTempPath(), $"tessera-archive-{Guid.NewGuid():N}");

        public ArchiveFixture()
        {
            PackageDirectory = Path.Combine(_root, "package");
            ArchivePath = Path.Combine(_root, "package.tessera-module.zip");
            Directory.CreateDirectory(PackageDirectory);
        }

        public string PackageDirectory { get; }

        public string ArchivePath { get; }

        public void Write(string relativePath, byte[] bytes)
        {
            var path = Path.Combine(PackageDirectory, relativePath.Replace('/', Path.DirectorySeparatorChar));
            Directory.CreateDirectory(Path.GetDirectoryName(path)!);
            File.WriteAllBytes(path, bytes);
        }

        public void CreateArchive(params (string Path, byte[] Bytes)[] entries)
        {
            using var archive = ZipFile.Open(ArchivePath, ZipArchiveMode.Create);
            foreach (var item in entries)
            {
                var entry = archive.CreateEntry(item.Path, CompressionLevel.NoCompression);
                using var stream = entry.Open();
                stream.Write(item.Bytes);
            }
        }

        public Task ValidateAsync() => PackageArchiveBuilder.ValidateExistingAsync(
            PackageDirectory,
            ArchivePath,
            CancellationToken.None);

        public void Dispose()
        {
            if (Directory.Exists(_root)) Directory.Delete(_root, recursive: true);
        }
    }

    private sealed class ChunkedReadStream(byte[] bytes, int maximumChunkBytes) : MemoryStream(bytes, writable: false)
    {
        public override ValueTask<int> ReadAsync(
            Memory<byte> buffer,
            CancellationToken cancellationToken = default) =>
            base.ReadAsync(buffer[..Math.Min(buffer.Length, maximumChunkBytes)], cancellationToken);
    }
}
