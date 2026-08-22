using System.Buffers.Binary;
using System.IO.Compression;
using System.Text;
using System.Xml.Linq;

namespace Tessera.Civ6.Extractor.Core;

internal static class Civ6BlpTextureExtractor
{
    private const string ContentId = "ROUTE_RAILROAD";
    private const string RouteArtDefPath = "DLC/Expansion2/ArtDefs/Routes.artdef";
    private const string StrategicArtDefPath = "DLC/Expansion2/ArtDefs/StrategicView.artdef";
    private const string ContainerPath = "DLC/Expansion2/Platforms/Windows/BLPs/strategicview/strategicview_routes.blp";
    private const string PackageEntryName = "Railroad";
    private const string TextureEntryName = "Railroad_Visible";
    private const long MaxContainerBytes = 512L * 1024 * 1024;
    private const int MaxMetadataBytes = 16 * 1024 * 1024;
    private const int MaxDecodedBytes = 64 * 1024 * 1024;
    private const int MaxEntryCount = 100_000;
    private const ushort DxgiFormatBc2Unorm = 74;

    public static async Task<GeneratedArtExtraction?> ExtractRailroadPreviewAsync(
        SafeInputRoot input,
        IReadOnlyList<Civ6ContentDefinition> definitions,
        CancellationToken cancellationToken)
    {
        if (!definitions.Any(value => value.Id == ContentId && value.Category == "route"))
        {
            return null;
        }

        await ValidateArtDefChainAsync(input, cancellationToken);
        var descriptor = await ReadTextureDescriptorAsync(input, cancellationToken);
        var rgba = DecodeFirstBc2Slice(descriptor, cancellationToken);
        var png = PngEncoder.EncodeRgba(descriptor.Width, descriptor.Height, rgba);
        var asset = new GeneratedArtAsset(
            ContentId,
            "tessera.civ6:asset.route.railroad-preview",
            "assets/route/railroad-preview.png",
            "image/png",
            descriptor.Width,
            descriptor.Height,
            ContainerPath,
            TextureEntryName,
            png);
        var sourceFiles = new[] { RouteArtDefPath, StrategicArtDefPath, ContainerPath }
            .Select((path, index) => new SourceFileFact(
                path,
                $"tessera.civ6:source.art-{index + 1:D2}",
                new FileInfo(input.ResolveExistingFile(path)).Length))
            .ToArray();
        return new(asset, sourceFiles);
    }

    public static async Task<Civ6BlpTextureInspection> InspectRailroadTextureAsync(
        SafeInputRoot input,
        CancellationToken cancellationToken)
    {
        var descriptor = await ReadTextureDescriptorAsync(input, cancellationToken);
        return new(
            ContainerPath,
            TextureEntryName,
            DxgiFormatBc2Unorm,
            descriptor.Width,
            descriptor.Height,
            descriptor.ArraySize,
            descriptor.MipCount,
            descriptor.PayloadBytes,
            descriptor.SlotOffset,
            descriptor.PrefixBytes);
    }

    private static async Task ValidateArtDefChainAsync(SafeInputRoot input, CancellationToken cancellationToken)
    {
        var routes = SecureXml.Parse(
            await input.ReadAllBytesAsync(RouteArtDefPath, cancellationToken),
            RouteArtDefPath);
        var route = FindRootElement(routes, "Route", ContentId, RouteArtDefPath);
        var routeReferences = route.Descendants("Element")
            .Where(value =>
                (string?)value.Attribute("class") == "AssetObjects..ArtDefReferenceValue" &&
                Text(value, "m_ElementName") == "Railroad_Completed" &&
                Text(value, "m_RootCollectionName") == "Routes" &&
                Text(value, "m_ArtDefPath") == "StrategicView.artdef")
            .ToArray();
        if (routeReferences.Length != 1)
        {
            throw new ExtractionException(
                "asset-artdef-chain-unsupported",
                "铁路 ArtDef 没有已验证的 StrategicView 引用链。",
                RouteArtDefPath);
        }

        var strategic = SecureXml.Parse(
            await input.ReadAllBytesAsync(StrategicArtDefPath, cancellationToken),
            StrategicArtDefPath);
        var completed = FindRootElement(strategic, "Routes", "Railroad_Completed", StrategicArtDefPath);
        var packageReferences = completed.Descendants("Element")
            .Where(value =>
                (string?)value.Attribute("class") == "AssetObjects..BLPEntryValue" &&
                Text(value, "m_EntryName") == PackageEntryName &&
                Text(value, "m_XLPClass") == "StrategicView_Route" &&
                Text(value, "m_XLPPath").Equals("strategicview_routes.xlp", StringComparison.OrdinalIgnoreCase) &&
                Text(value, "m_BLPPackage") == "strategicview/strategicview_routes")
            .ToArray();
        if (packageReferences.Length != 1)
        {
            throw new ExtractionException(
                "asset-artdef-chain-unsupported",
                "铁路 StrategicView 条目没有已验证的 BLP 引用。",
                StrategicArtDefPath);
        }
    }

    private static XElement FindRootElement(XDocument document, string collectionName, string name, string path)
    {
        var matches = document.Root?.Element("m_RootCollections")?.Elements("Element")
            .Where(value => Text(value, "m_CollectionName") == collectionName)
            .SelectMany(value => value.Elements("Element"))
            .Where(value => Text(value, "m_Name") == name)
            .ToArray() ?? [];
        if (matches.Length != 1)
        {
            throw new ExtractionException(
                "asset-artdef-chain-unsupported",
                "ArtDef 目标缺失或不唯一。",
                $"{path}/{collectionName}/{name}");
        }

        return matches[0];
    }

    private static string Text(XElement element, string childName) =>
        element.Element(childName)?.Attribute("text")?.Value ?? string.Empty;

    private static async Task<BlpTextureDescriptor> ReadTextureDescriptorAsync(
        SafeInputRoot input,
        CancellationToken cancellationToken)
    {
        var fullPath = input.ResolveExistingFile(ContainerPath);
        await using var stream = new FileStream(
            fullPath,
            FileMode.Open,
            FileAccess.Read,
            FileShare.Read,
            bufferSize: 64 * 1024,
            FileOptions.Asynchronous | FileOptions.RandomAccess);
        if (stream.Length is < 32 or > MaxContainerBytes)
        {
            throw InvalidContainer("BLP 文件为空、截断或超过 512 MiB。", ContainerPath);
        }

        var header = new byte[32];
        await stream.ReadExactlyAsync(header, cancellationToken);
        if (!header.AsSpan(0, 8).SequenceEqual("CIVBLP\u0002\u0000"u8))
        {
            throw InvalidContainer("BLP 文件头不是已验证的 CIVBLP v2。", ContainerPath);
        }

        var alignment = ReadUInt32(header, 8);
        var metadataEnd = ReadUInt32(header, 12);
        var dataStart = ReadUInt32(header, 16);
        var entryCount = ReadUInt32(header, 20);
        var declaredFileBytes = ReadUInt32(header, 24);
        var reserved = ReadUInt32(header, 28);
        if (alignment != 1024 || metadataEnd < 32 || metadataEnd > MaxMetadataBytes ||
            dataStart != CheckedAdd(metadataEnd, alignment) || dataStart > stream.Length ||
            entryCount > MaxEntryCount || declaredFileBytes != stream.Length || reserved != 0)
        {
            throw InvalidContainer("BLP 头部边界或计数不满足已验证的不变量。", ContainerPath);
        }

        stream.Position = 0;
        var metadata = new byte[checked((int)dataStart)];
        await stream.ReadExactlyAsync(metadata, cancellationToken);
        RequireAsciiName(metadata, PackageEntryName);
        RequireAsciiName(metadata, TextureEntryName);
        RequireAsciiName(metadata, "Railroad_Revealed");

        var descriptors = FindBc2Descriptors(metadata, checked(stream.Length - dataStart), cancellationToken);
        var targetHash = Fnv1a(TextureEntryName);
        var matches = descriptors.Where(value => value.NameHash == targetHash).ToArray();
        if (matches.Length != 1)
        {
            throw InvalidContainer("BLP 中目标纹理描述符缺失或哈希冲突。", TextureEntryName);
        }

        var orderedOffsets = descriptors.Select(value => value.SlotOffset).Distinct().Order().ToArray();
        var target = matches[0];
        var nextOffset = orderedOffsets.FirstOrDefault(value => value > target.SlotOffset);
        var slotEnd = nextOffset == 0 ? stream.Length - dataStart : nextOffset;
        var slotBytes = checked(slotEnd - target.SlotOffset);
        var prefixBytes = checked(slotBytes - target.PayloadBytes);
        if (prefixBytes is < 16 or > 4096 || prefixBytes % 16 != 0)
        {
            throw InvalidContainer("BLP 纹理槽前缀长度不在已验证范围。", TextureEntryName);
        }

        var payloadPosition = CheckedAdd(dataStart, CheckedAdd(target.SlotOffset, prefixBytes));
        if (CheckedAdd(payloadPosition, target.PayloadBytes) != CheckedAdd(dataStart, slotEnd))
        {
            throw InvalidContainer("BLP 纹理载荷边界不闭合。", TextureEntryName);
        }

        stream.Position = payloadPosition;
        var payload = new byte[checked((int)target.PayloadBytes)];
        await stream.ReadExactlyAsync(payload, cancellationToken);
        return target with { PrefixBytes = prefixBytes, Payload = payload };
    }

    private static BlpTextureDescriptor[] FindBc2Descriptors(
        ReadOnlySpan<byte> metadata,
        long dataBytes,
        CancellationToken cancellationToken)
    {
        var result = new List<BlpTextureDescriptor>();
        for (var offset = 16; offset <= metadata.Length - 52; offset++)
        {
            if ((offset & 0x0fff) == 0)
            {
                cancellationToken.ThrowIfCancellationRequested();
            }

            var nameHash = ReadUInt32(metadata, offset);
            if (ReadUInt32(metadata, offset + 4) != 0 ||
                ReadUInt16(metadata, offset + 40) != DxgiFormatBc2Unorm)
            {
                continue;
            }

            var slotOffset = ReadUInt64(metadata, offset - 16);
            var payloadBytes = ReadUInt64(metadata, offset - 8);
            var height = ReadUInt16(metadata, offset + 42);
            var width = ReadUInt16(metadata, offset + 44);
            var depth = ReadUInt16(metadata, offset + 46);
            var arraySize = ReadUInt16(metadata, offset + 48);
            var mipCount = ReadUInt16(metadata, offset + 50);
            if (width == 0 || height == 0 || depth != 1 || arraySize == 0 || mipCount == 0 || mipCount > 16 ||
                payloadBytes > MaxDecodedBytes || slotOffset > (ulong)dataBytes)
            {
                continue;
            }

            var expectedBytes = ExpectedBc2Bytes(width, height, arraySize, mipCount);
            if (payloadBytes != (ulong)expectedBytes || payloadBytes > (ulong)dataBytes - slotOffset)
            {
                continue;
            }

            result.Add(new(nameHash, checked((long)slotOffset), expectedBytes, width, height, arraySize, mipCount, 0, []));
        }

        return result.DistinctBy(value => (value.NameHash, value.SlotOffset)).ToArray();
    }

    private static byte[] DecodeFirstBc2Slice(BlpTextureDescriptor descriptor, CancellationToken cancellationToken)
    {
        var outputBytes = checked(descriptor.Width * descriptor.Height * 4);
        if (outputBytes > MaxDecodedBytes)
        {
            throw InvalidContainer("解码像素超过 64 MiB 安全上限。", TextureEntryName);
        }

        var result = new byte[outputBytes];
        var blocksX = checked((descriptor.Width + 3) / 4);
        var blocksY = checked((descriptor.Height + 3) / 4);
        var firstMipBytes = checked(blocksX * blocksY * 16);
        if (descriptor.Payload.Length < firstMipBytes)
        {
            throw InvalidContainer("BC2 首级 mip 载荷截断。", TextureEntryName);
        }

        var sourceOffset = 0;
        for (var blockY = 0; blockY < blocksY; blockY++)
        {
            cancellationToken.ThrowIfCancellationRequested();
            for (var blockX = 0; blockX < blocksX; blockX++)
            {
                DecodeBc2Block(
                    descriptor.Payload.AsSpan(sourceOffset, 16),
                    result,
                    descriptor.Width,
                    descriptor.Height,
                    blockX * 4,
                    blockY * 4);
                sourceOffset += 16;
            }
        }

        return result;
    }

    private static void DecodeBc2Block(
        ReadOnlySpan<byte> block,
        Span<byte> output,
        int width,
        int height,
        int originX,
        int originY)
    {
        var alpha = ReadUInt64(block, 0);
        var color0 = ReadUInt16(block, 8);
        var color1 = ReadUInt16(block, 10);
        var indices = ReadUInt32(block, 12);
        Span<Rgb> palette = stackalloc Rgb[4];
        palette[0] = DecodeRgb565(color0);
        palette[1] = DecodeRgb565(color1);
        palette[2] = Rgb.Interpolate(palette[0], palette[1], 2, 1);
        palette[3] = Rgb.Interpolate(palette[0], palette[1], 1, 2);
        for (var pixel = 0; pixel < 16; pixel++)
        {
            var x = originX + pixel % 4;
            var y = originY + pixel / 4;
            if (x >= width || y >= height)
            {
                continue;
            }

            var color = palette[(int)((indices >> (pixel * 2)) & 3)];
            var destination = checked((y * width + x) * 4);
            output[destination] = color.R;
            output[destination + 1] = color.G;
            output[destination + 2] = color.B;
            output[destination + 3] = checked((byte)(((alpha >> (pixel * 4)) & 0x0f) * 17));
        }
    }

    private static Rgb DecodeRgb565(ushort value) => new(
        Expand((value >> 11) & 0x1f, 31),
        Expand((value >> 5) & 0x3f, 63),
        Expand(value & 0x1f, 31));

    private static byte Expand(int value, int maximum) => checked((byte)((value * 255 + maximum / 2) / maximum));

    private static long ExpectedBc2Bytes(int width, int height, int arraySize, int mipCount)
    {
        long total = 0;
        var mipWidth = width;
        var mipHeight = height;
        for (var mip = 0; mip < mipCount; mip++)
        {
            var blocksX = checked((mipWidth + 3L) / 4);
            var blocksY = checked((mipHeight + 3L) / 4);
            total = checked(total + checked(blocksX * blocksY * 16));
            mipWidth = Math.Max(1, mipWidth / 2);
            mipHeight = Math.Max(1, mipHeight / 2);
        }

        return checked(total * arraySize);
    }

    private static void RequireAsciiName(ReadOnlySpan<byte> metadata, string name)
    {
        var needle = Encoding.ASCII.GetBytes(name + "\0");
        if (metadata.IndexOf(needle) < 0)
        {
            throw InvalidContainer("BLP 元数据缺少预期的明文条目名。", name);
        }
    }

    private static uint Fnv1a(string value)
    {
        var hash = 2166136261u;
        foreach (var item in Encoding.UTF8.GetBytes(value))
        {
            hash = unchecked((hash ^ item) * 16777619u);
        }

        return hash;
    }

    private static uint CheckedAdd(uint left, uint right)
    {
        try
        {
            return checked(left + right);
        }
        catch (OverflowException error)
        {
            throw InvalidContainer("BLP 头部偏移发生整数溢出。", ContainerPath, error);
        }
    }

    private static long CheckedAdd(long left, long right)
    {
        try
        {
            return checked(left + right);
        }
        catch (OverflowException error)
        {
            throw InvalidContainer("BLP 载荷偏移发生整数溢出。", ContainerPath, error);
        }
    }

    private static ushort ReadUInt16(ReadOnlySpan<byte> bytes, int offset) =>
        BinaryPrimitives.ReadUInt16LittleEndian(bytes[offset..]);

    private static uint ReadUInt32(ReadOnlySpan<byte> bytes, int offset) =>
        BinaryPrimitives.ReadUInt32LittleEndian(bytes[offset..]);

    private static ulong ReadUInt64(ReadOnlySpan<byte> bytes, int offset) =>
        BinaryPrimitives.ReadUInt64LittleEndian(bytes[offset..]);

    private static ExtractionException InvalidContainer(string message, string path, Exception? inner = null) =>
        new("asset-blp-structure-invalid", message, path, inner);

    private readonly record struct Rgb(byte R, byte G, byte B)
    {
        public static Rgb Interpolate(Rgb left, Rgb right, int leftWeight, int rightWeight) => new(
            checked((byte)((left.R * leftWeight + right.R * rightWeight) / 3)),
            checked((byte)((left.G * leftWeight + right.G * rightWeight) / 3)),
            checked((byte)((left.B * leftWeight + right.B * rightWeight) / 3)));
    }

    private sealed record BlpTextureDescriptor(
        uint NameHash,
        long SlotOffset,
        long PayloadBytes,
        int Width,
        int Height,
        int ArraySize,
        int MipCount,
        long PrefixBytes,
        byte[] Payload);
}

internal static class PngEncoder
{
    private static readonly byte[] Signature = [137, 80, 78, 71, 13, 10, 26, 10];

    public static byte[] EncodeRgba(int width, int height, ReadOnlySpan<byte> rgba)
    {
        if (width <= 0 || height <= 0 || rgba.Length != checked(width * height * 4))
        {
            throw new ArgumentException("RGBA 像素尺寸不匹配。", nameof(rgba));
        }

        using var output = new MemoryStream();
        output.Write(Signature);
        Span<byte> header = stackalloc byte[13];
        BinaryPrimitives.WriteUInt32BigEndian(header, checked((uint)width));
        BinaryPrimitives.WriteUInt32BigEndian(header[4..], checked((uint)height));
        header[8] = 8;
        header[9] = 6;
        WriteChunk(output, "IHDR"u8, header);

        using var compressed = new MemoryStream();
        using (var zlib = new ZLibStream(compressed, CompressionLevel.SmallestSize, leaveOpen: true))
        {
            for (var row = 0; row < height; row++)
            {
                zlib.WriteByte(0);
                zlib.Write(rgba.Slice(checked(row * width * 4), checked(width * 4)));
            }
        }

        WriteChunk(output, "IDAT"u8, compressed.ToArray());
        WriteChunk(output, "IEND"u8, []);
        return output.ToArray();
    }

    private static void WriteChunk(Stream output, ReadOnlySpan<byte> type, ReadOnlySpan<byte> data)
    {
        Span<byte> value = stackalloc byte[4];
        BinaryPrimitives.WriteUInt32BigEndian(value, checked((uint)data.Length));
        output.Write(value);
        output.Write(type);
        output.Write(data);
        var crc = 0xffffffffu;
        crc = UpdateCrc(crc, type);
        crc = UpdateCrc(crc, data) ^ 0xffffffffu;
        BinaryPrimitives.WriteUInt32BigEndian(value, crc);
        output.Write(value);
    }

    private static uint UpdateCrc(uint crc, ReadOnlySpan<byte> data)
    {
        foreach (var item in data)
        {
            crc ^= item;
            for (var bit = 0; bit < 8; bit++)
            {
                crc = (crc >> 1) ^ (0xedb88320u & unchecked((uint)-(int)(crc & 1)));
            }
        }

        return crc;
    }
}
