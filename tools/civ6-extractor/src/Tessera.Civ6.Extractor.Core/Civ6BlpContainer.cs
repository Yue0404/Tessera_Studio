using System.Buffers.Binary;
using System.Text;

namespace Tessera.Civ6.Extractor.Core;

/// <summary>受限读取已验证的 CIVBLP v2 纹理目录，不解释几何或材质实例。</summary>
internal sealed class Civ6BlpContainer
{
    private const long MaxContainerBytes = 512L * 1024 * 1024;
    private const int MaxMetadataBytes = 16 * 1024 * 1024;
    private const int MaxTexturePayloadBytes = 64 * 1024 * 1024;
    private const int MaxEntryCount = 100_000;
    private readonly string fullPath;
    private readonly string relativePath;
    private readonly long dataStart;
    private readonly long fileBytes;
    private readonly byte[] metadata;
    private readonly IReadOnlyList<Civ6BlpDescriptor> descriptors;

    private Civ6BlpContainer(
        string fullPath,
        string relativePath,
        long dataStart,
        long fileBytes,
        byte[] metadata,
        IReadOnlyList<Civ6BlpDescriptor> descriptors)
    {
        this.fullPath = fullPath;
        this.relativePath = relativePath;
        this.dataStart = dataStart;
        this.fileBytes = fileBytes;
        this.metadata = metadata;
        this.descriptors = descriptors;
    }

    public static async Task<Civ6BlpContainer> OpenAsync(
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
            bufferSize: 64 * 1024,
            FileOptions.Asynchronous | FileOptions.RandomAccess);
        if (stream.Length is < 32 or > MaxContainerBytes)
        {
            throw Invalid("CIVBLP 文件为空、截断或超过 512 MiB。", relativePath);
        }

        var header = new byte[32];
        await stream.ReadExactlyAsync(header, cancellationToken);
        if (!header.AsSpan(0, 8).SequenceEqual("CIVBLP\u0002\u0000"u8))
        {
            throw Invalid("文件头不是已验证的 CIVBLP v2。", relativePath);
        }

        var alignment = ReadUInt32(header, 8);
        var metadataEnd = ReadUInt32(header, 12);
        var dataStart = ReadUInt32(header, 16);
        var entryCount = ReadUInt32(header, 20);
        var declaredFileBytes = ReadUInt32(header, 24);
        var reserved = ReadUInt32(header, 28);
        if (alignment != 1024 || metadataEnd < 32 || metadataEnd > MaxMetadataBytes ||
            CheckedAdd(metadataEnd, alignment, relativePath) != dataStart ||
            dataStart > stream.Length || entryCount == 0 || entryCount > MaxEntryCount ||
            declaredFileBytes != stream.Length || reserved != 0)
        {
            throw Invalid("CIVBLP 头部边界或计数不满足已验证的不变量。", relativePath);
        }

        stream.Position = 0;
        var metadata = new byte[checked((int)dataStart)];
        await stream.ReadExactlyAsync(metadata, cancellationToken);
        var descriptors = ParseDescriptors(
            metadata,
            checked(stream.Length - dataStart),
            entryCount,
            relativePath,
            cancellationToken);
        return new(fullPath, relativePath, dataStart, stream.Length, metadata, descriptors);
    }

    public async Task<Civ6BlpTexture> ReadTextureAsync(
        string descriptorName,
        CancellationToken cancellationToken)
    {
        RequireAsciiName(descriptorName);
        var targetHash = Fnv1a(descriptorName);
        var matches = descriptors.Where(value => value.NameHash == targetHash).ToArray();
        if (matches.Length != 1)
        {
            throw Invalid("CIVBLP 目标纹理描述符缺失或哈希冲突。", $"{relativePath}/{descriptorName}");
        }

        var descriptor = matches[0];
        var expectedBytes = descriptor.DxgiFormat == 28
            ? ExpectedRgba8Bytes(descriptor, relativePath)
            : BcTextureDecoder.ExpectedBytes(
                descriptor.Width,
                descriptor.Height,
                descriptor.ArraySize,
                descriptor.MipCount,
                BcTextureDecoder.ResolveLayout(descriptor.DxgiFormat, relativePath).BlockBytes,
                relativePath);
        if (descriptor.PayloadBytes != expectedBytes || expectedBytes > MaxTexturePayloadBytes)
        {
            throw Invalid("CIVBLP 声明载荷与受支持 RGBA8/BCn 尺寸不一致或超过 64 MiB。", $"{relativePath}/{descriptorName}");
        }

        var nextOffset = descriptors
            .Select(value => value.SlotOffset)
            .Where(value => value > descriptor.SlotOffset)
            .DefaultIfEmpty(checked(fileBytes - dataStart))
            .Min();
        var slotBytes = CheckedSubtract(nextOffset, descriptor.SlotOffset, relativePath);
        var alignmentBytes = CheckedSubtract(slotBytes, descriptor.PayloadBytes, relativePath);
        var rgba8Page = descriptor.DxgiFormat == 28;
        var alignmentValid = rgba8Page
            ? alignmentBytes is >= 0 and < 1024
            : alignmentBytes is >= 16 and <= 4096 && alignmentBytes % 16 == 0;
        if (!alignmentValid)
        {
            throw Invalid("CIVBLP 纹理槽对齐字节数不在已验证范围。", $"{relativePath}/{descriptorName}");
        }

        var payloadPosition = CheckedAdd(
            dataStart,
            CheckedAdd(descriptor.SlotOffset, rgba8Page ? 0 : alignmentBytes, relativePath),
            relativePath);
        var payloadEnd = CheckedAdd(payloadPosition, descriptor.PayloadBytes, relativePath);
        var slotEnd = CheckedAdd(dataStart, nextOffset, relativePath);
        if (rgba8Page ? payloadEnd > slotEnd : payloadEnd != slotEnd)
        {
            throw Invalid("CIVBLP 纹理载荷边界不闭合。", $"{relativePath}/{descriptorName}");
        }

        await using var stream = new FileStream(
            fullPath,
            FileMode.Open,
            FileAccess.Read,
            FileShare.Read,
            bufferSize: 64 * 1024,
            FileOptions.Asynchronous | FileOptions.RandomAccess);
        stream.Position = payloadPosition;
        var payload = new byte[checked((int)descriptor.PayloadBytes)];
        await stream.ReadExactlyAsync(payload, cancellationToken);
        return new(
            relativePath,
            descriptorName,
            descriptor.DxgiFormat,
            descriptor.Width,
            descriptor.Height,
            descriptor.ArraySize,
            descriptor.MipCount,
            descriptor.PayloadBytes,
            descriptor.SlotOffset,
            rgba8Page ? 0 : alignmentBytes,
            payload);
    }

    /// <summary>按 ArtDef 中的 XLP 逻辑条目解析其显式纹理指针，不通过名称相似度猜测。</summary>
    public Task<Civ6BlpTexture> ReadPackageTextureAsync(
        string packageEntryName,
        string xlpClass,
        CancellationToken cancellationToken)
    {
        RequireAsciiName(packageEntryName);
        var entryHash = Fnv1a(packageEntryName);
        var descriptorIndexes = new List<uint>();
        var packedUiIndexes = new HashSet<uint>();
        for (var offset = 0; offset <= metadata.Length - 48; offset++)
        {
            if ((offset & 0x0fff) == 0)
            {
                cancellationToken.ThrowIfCancellationRequested();
            }

            if (ReadUInt32(metadata, offset) != entryHash ||
                ReadUInt32(metadata, offset + 4) != 0)
            {
                continue;
            }

            if (xlpClass == "UITexture" &&
                ReadUInt32(metadata, offset + 8) == 2 &&
                ReadUInt32(metadata, offset + 16) == 0 &&
                ReadUInt32(metadata, offset + 28) == 0)
            {
                // 正式 UITexture 包条目在名称哈希后直接保存一个 (type=2,index) 指针。
                var descriptorIndex = ReadUInt32(metadata, offset + 12);
                descriptorIndexes.Add(descriptorIndex);
                if (IsPackedUiEntry(offset, descriptorIndex))
                {
                    packedUiIndexes.Add(descriptorIndex);
                }
            }
            else if (ReadUInt32(metadata, offset + 12) != 0 ||
                ReadUInt32(metadata, offset + 24) != 0 ||
                ReadUInt32(metadata, offset + 28) != 0)
            {
                continue;
            }
            else if (xlpClass == "StrategicView_Sprite" && ReadUInt32(metadata, offset + 16) == 2)
            {
                descriptorIndexes.Add(ReadUInt32(metadata, offset + 20));
            }
            else if (xlpClass == "StrategicView_Route" &&
                ReadUInt32(metadata, offset + 32) == 2 &&
                ReadUInt32(metadata, offset + 40) == 2)
            {
                // Route 包条目显式列出 Visible、Revealed 两个纹理指针；预览固定取 Visible。
                descriptorIndexes.Add(ReadUInt32(metadata, offset + 36));
            }
        }

        var uniqueIndexes = descriptorIndexes.Distinct().ToArray();
        if (uniqueIndexes.Length != 1)
        {
            throw Invalid(
                "CIVBLP 逻辑包条目的纹理指针缺失、歧义或越界。",
                $"{relativePath}/{packageEntryName}");
        }

        if (uniqueIndexes[0] >= descriptors.Count)
        {
            if (xlpClass == "UITexture" && packedUiIndexes.SetEquals(uniqueIndexes))
            {
                throw new ExtractionException(
                    "asset-ui-packed-layout-unsupported",
                    "UITexture 使用尚未解码的 ForgeUI::BCTexturePackageEntry，未把其块索引猜作像素。",
                    $"{relativePath}/{packageEntryName}");
            }

            throw Invalid(
                "CIVBLP 逻辑包条目的纹理指针越界。",
                $"{relativePath}/{packageEntryName}");
        }

        var descriptor = descriptors[checked((int)uniqueIndexes[0])];
        var descriptorName = ResolveDescriptorName(descriptor.NameHash, cancellationToken);
        return ReadTextureAsync(descriptorName, cancellationToken);
    }

    private bool IsPackedUiEntry(int hashOffset, uint descriptorIndex)
    {
        const int packedRecordBytesAfterHash = 108;
        // 正式 Base 与 Expansion2 样本的块索引宽度分别为 8、4；其余字段仍须完整匹配。
        if (hashOffset > metadata.Length - packedRecordBytesAfterHash ||
            descriptorIndex > uint.MaxValue - 6 ||
            ReadUInt32(metadata, hashOffset + 32) != 0 ||
            ReadUInt32(metadata, hashOffset + 36) == 0 ||
            ReadUInt16(metadata, hashOffset + 40) is not (4 or 8) ||
            ReadUInt16(metadata, hashOffset + 42) != 2 ||
            ReadUInt32(metadata, hashOffset + 104) != descriptorIndex + 6)
        {
            return false;
        }

        for (var offset = hashOffset + 44; offset <= hashOffset + 100; offset += 4)
        {
            if (ReadUInt32(metadata, offset) != 0)
            {
                return false;
            }
        }

        return true;
    }

    private string ResolveDescriptorName(uint nameHash, CancellationToken cancellationToken)
    {
        var names = new HashSet<string>(StringComparer.Ordinal);
        for (var start = 0; start < metadata.Length; start++)
        {
            if ((start & 0x0fff) == 0)
            {
                cancellationToken.ThrowIfCancellationRequested();
            }

            if (metadata[start] is < 0x20 or > 0x7e ||
                (start > 0 && metadata[start - 1] is >= 0x20 and <= 0x7e))
            {
                continue;
            }

            var end = start;
            while (end < metadata.Length && end - start <= 255 && metadata[end] is >= 0x20 and <= 0x7e)
            {
                end++;
            }

            if (end == start || end >= metadata.Length || metadata[end] != 0)
            {
                continue;
            }

            var candidate = Encoding.ASCII.GetString(metadata, start, end - start);
            if (Fnv1a(candidate) == nameHash)
            {
                names.Add(candidate);
            }
        }

        if (names.Count != 1)
        {
            throw Invalid("CIVBLP 纹理描述符名称缺失或哈希冲突。", relativePath);
        }

        return names.Single();
    }

    private static Civ6BlpDescriptor[] ParseDescriptors(
        ReadOnlySpan<byte> metadata,
        long dataBytes,
        uint declaredEntryCount,
        string relativePath,
        CancellationToken cancellationToken)
    {
        var result = new List<Civ6BlpDescriptor>();
        for (var offset = 16; offset <= metadata.Length - 52; offset++)
        {
            if ((offset & 0x0fff) == 0)
            {
                cancellationToken.ThrowIfCancellationRequested();
            }

            if (ReadUInt32(metadata, offset + 4) != 0)
            {
                continue;
            }

            var slotOffset = ReadUInt64(metadata, offset - 16);
            var payloadBytes = ReadUInt64(metadata, offset - 8);
            var format = ReadUInt16(metadata, offset + 40);
            // TypeInfoStripe 顺序为 m_nHeight、m_nWidth，但正式 TextureEntry 的字段地址
            // 证明 +42 是宽、+44 是高；非方形 Expansion atlas 用此不变量闭合。
            var width = ReadUInt16(metadata, offset + 42);
            var height = ReadUInt16(metadata, offset + 44);
            var depth = ReadUInt16(metadata, offset + 46);
            var arraySize = ReadUInt16(metadata, offset + 48);
            var mipCount = ReadUInt16(metadata, offset + 50);
            if ((format != 28 && format is < 70 or > 99) || width == 0 || height == 0 || depth != 1 ||
                arraySize == 0 || mipCount == 0 || mipCount > 16 ||
                payloadBytes == 0 || payloadBytes > MaxTexturePayloadBytes ||
                slotOffset > (ulong)dataBytes || payloadBytes > (ulong)dataBytes - slotOffset)
            {
                continue;
            }

            result.Add(new(
                ReadUInt32(metadata, offset),
                checked((long)slotOffset),
                checked((long)payloadBytes),
                format,
                width,
                height,
                arraySize,
                mipCount));
        }

        var unique = result.Distinct().OrderBy(value => value.SlotOffset).ThenBy(value => value.NameHash).ToArray();
        if (unique.Length == 0 || unique.Length > declaredEntryCount * 32L)
        {
            throw Invalid("CIVBLP 纹理目录为空或描述符数量异常。", relativePath);
        }

        return unique;
    }

    private static long ExpectedRgba8Bytes(Civ6BlpDescriptor descriptor, string path)
    {
        try
        {
            long bytes = 0;
            var width = descriptor.Width;
            var height = descriptor.Height;
            for (var mip = 0; mip < descriptor.MipCount; mip++)
            {
                bytes = checked(bytes + checked((long)width * height * 4));
                width = Math.Max(1, width / 2);
                height = Math.Max(1, height / 2);
            }

            return checked(bytes * descriptor.ArraySize);
        }
        catch (OverflowException error)
        {
            throw Invalid("RGBA8 派生字节数发生整数溢出。", path, error);
        }
    }

    private void RequireAsciiName(string name)
    {
        if (string.IsNullOrWhiteSpace(name) || name.Any(value => value is < ' ' or > '~'))
        {
            throw Invalid("纹理描述符名称不是受支持的非空 ASCII。", $"{relativePath}/{name}");
        }

        var needle = Encoding.ASCII.GetBytes(name + "\0");
        if (metadata.AsSpan().IndexOf(needle) < 0)
        {
            throw Invalid("CIVBLP 元数据缺少预期的明文纹理名。", $"{relativePath}/{name}");
        }
    }

    internal static uint Fnv1a(string value)
    {
        var hash = 2166136261u;
        foreach (var item in Encoding.UTF8.GetBytes(value))
        {
            hash = unchecked((hash ^ item) * 16777619u);
        }

        return hash;
    }

    private static uint CheckedAdd(uint left, uint right, string path)
    {
        try
        {
            return checked(left + right);
        }
        catch (OverflowException error)
        {
            throw Invalid("CIVBLP 头部偏移发生整数溢出。", path, error);
        }
    }

    private static long CheckedAdd(long left, long right, string path)
    {
        try
        {
            return checked(left + right);
        }
        catch (OverflowException error)
        {
            throw Invalid("CIVBLP 载荷偏移发生整数溢出。", path, error);
        }
    }

    private static long CheckedSubtract(long left, long right, string path)
    {
        try
        {
            return checked(left - right);
        }
        catch (OverflowException error)
        {
            throw Invalid("CIVBLP 载荷边界发生整数溢出。", path, error);
        }
    }

    private static ushort ReadUInt16(ReadOnlySpan<byte> bytes, int offset) =>
        BinaryPrimitives.ReadUInt16LittleEndian(bytes[offset..]);

    private static uint ReadUInt32(ReadOnlySpan<byte> bytes, int offset) =>
        BinaryPrimitives.ReadUInt32LittleEndian(bytes[offset..]);

    private static ulong ReadUInt64(ReadOnlySpan<byte> bytes, int offset) =>
        BinaryPrimitives.ReadUInt64LittleEndian(bytes[offset..]);

    private static ExtractionException Invalid(string message, string path, Exception? inner = null) =>
        new("asset-blp-structure-invalid", message, path, inner);
}

internal sealed record Civ6BlpDescriptor(
    uint NameHash,
    long SlotOffset,
    long PayloadBytes,
    ushort DxgiFormat,
    int Width,
    int Height,
    int ArraySize,
    int MipCount);

internal sealed record Civ6BlpTexture(
    string RelativePath,
    string EntryName,
    ushort DxgiFormat,
    int Width,
    int Height,
    int ArraySize,
    int MipCount,
    long PayloadBytes,
    long SlotOffset,
    long PrefixBytes,
    byte[] Payload);
