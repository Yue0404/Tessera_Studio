using System.Buffers.Binary;

namespace Tessera.Civ6.Extractor.Core;

internal static class Civ6TextureContainerProbe
{
    private const int MaxPayloadBytes = 64 * 1024 * 1024;
    private static readonly string[] CivBigSamples =
    [
        "Base/Platforms/Windows/BLPs/SHARED_DATA/TEXTURE_Terrain_Generic_Resource",
        "Base/Platforms/Windows/BLPs/SHARED_DATA/TEXTURE_Decals_Rail_Tracks_B",
        "Base/Platforms/Windows/BLPs/SHARED_DATA/TEXTURE_FX_TrailWhite_01",
        "Base/Platforms/Windows/BLPs/SHARED_DATA/TEXTURE_Nuclear_Submarine_n0",
    ];

    public static async Task<Civ6TextureContainerInspection> InspectAsync(
        SafeInputRoot input,
        string gameVersion,
        CancellationToken cancellationToken)
    {
        var blp = await Civ6BlpTextureExtractor.InspectRailroadTextureAsync(input, cancellationToken);
        var civBig = new List<Civ6CivBigTextureInspection>();
        foreach (var relativePath in CivBigSamples)
        {
            cancellationToken.ThrowIfCancellationRequested();
            if (input.TryResolveExistingFile(relativePath, out _))
            {
                civBig.Add(await InspectCivBigAsync(input, relativePath, cancellationToken));
            }
        }

        return new(gameVersion, blp, civBig);
    }

    internal static async Task<Civ6CivBigTextureInspection> InspectCivBigAsync(
        SafeInputRoot input,
        string relativePath,
        CancellationToken cancellationToken)
    {
        var fullPath = input.ResolveExistingFile(relativePath);
        await using var stream = new FileStream(
            fullPath,
            FileMode.Open,
            FileAccess.Read,
            FileShare.Read,
            bufferSize: 4096,
            FileOptions.Asynchronous | FileOptions.SequentialScan);
        if (stream.Length is < 44 or > MaxPayloadBytes)
        {
            throw Invalid("CIVBIG 文件为空、截断或超过 64 MiB。", relativePath);
        }

        var header = new byte[44];
        await stream.ReadExactlyAsync(header, cancellationToken);
        if (!header.AsSpan(0, 8).SequenceEqual("CIVBIG\u0000\u0000"u8))
        {
            throw Invalid("文件头不是 CIVBIG。", relativePath);
        }

        var payloadBytes = ReadUInt32(header, 8);
        var arraySize = ReadUInt16(header, 32);
        var mipCount = ReadUInt16(header, 34);
        var format = ReadUInt16(header, 36);
        var height = ReadUInt16(header, 38);
        var width = ReadUInt16(header, 40);
        var depth = ReadUInt16(header, 42);
        var headerBytes = checked(stream.Length - payloadBytes);
        if (arraySize == 0 || mipCount == 0 || mipCount > 16 || width == 0 || height == 0 || depth != 1 ||
            headerBytes is < 16 or > 4096 || headerBytes % 8 != 0)
        {
            throw Invalid("CIVBIG 头部尺寸或载荷边界不在已验证范围。", relativePath);
        }

        var blockBytes = format switch
        {
            71 or 72 or 80 or 81 => 8,
            74 or 75 or 77 or 78 or 83 or 84 => 16,
            _ => throw Invalid("CIVBIG DXGI 格式不在已验证的 BCn 集合。", relativePath),
        };
        var expectedBytes = ExpectedBlockBytes(width, height, arraySize, mipCount, blockBytes);
        if (payloadBytes != expectedBytes)
        {
            throw Invalid("CIVBIG 声明载荷与 BCn 块尺寸公式不一致。", relativePath);
        }

        return new(relativePath, format, width, height, arraySize, mipCount, payloadBytes, headerBytes);
    }

    private static long ExpectedBlockBytes(int width, int height, int arraySize, int mipCount, int blockBytes)
    {
        long total = 0;
        var mipWidth = width;
        var mipHeight = height;
        for (var mip = 0; mip < mipCount; mip++)
        {
            total = checked(total + checked(((mipWidth + 3L) / 4) * ((mipHeight + 3L) / 4) * blockBytes));
            mipWidth = Math.Max(1, mipWidth / 2);
            mipHeight = Math.Max(1, mipHeight / 2);
        }

        return checked(total * arraySize);
    }

    private static ushort ReadUInt16(ReadOnlySpan<byte> bytes, int offset) =>
        BinaryPrimitives.ReadUInt16LittleEndian(bytes[offset..]);

    private static uint ReadUInt32(ReadOnlySpan<byte> bytes, int offset) =>
        BinaryPrimitives.ReadUInt32LittleEndian(bytes[offset..]);

    private static ExtractionException Invalid(string message, string path) =>
        new("asset-civbig-structure-invalid", message, path);
}
