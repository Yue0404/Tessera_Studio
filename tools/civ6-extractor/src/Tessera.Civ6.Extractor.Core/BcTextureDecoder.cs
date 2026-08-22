namespace Tessera.Civ6.Extractor.Core;

internal enum BcTextureKind
{
    Bc1,
    Bc2,
    Bc3,
    Bc5,
}

internal readonly record struct BcTextureLayout(BcTextureKind Kind, int BlockBytes);

/// <summary>仅实现公开 BCn 块格式；不会加载游戏 DLL 或第三方原生解码器。</summary>
internal static class BcTextureDecoder
{
    private const int MaxDimension = 8192;
    private const int MaxDecodedBytes = 64 * 1024 * 1024;

    public static BcTextureLayout ResolveLayout(ushort dxgiFormat, string path) => dxgiFormat switch
    {
        71 or 72 => new(BcTextureKind.Bc1, 8),
        74 or 75 => new(BcTextureKind.Bc2, 16),
        77 or 78 => new(BcTextureKind.Bc3, 16),
        83 => new(BcTextureKind.Bc5, 16),
        _ => throw Invalid("DXGI 格式不是已验证的 BC1/BC2/BC3/BC5 UNORM 或 sRGB 布局。", path),
    };

    public static long ExpectedBytes(
        int width,
        int height,
        int arraySize,
        int mipCount,
        int blockBytes,
        string path)
    {
        if (width is <= 0 or > MaxDimension || height is <= 0 or > MaxDimension ||
            arraySize <= 0 || mipCount is <= 0 or > 16 || blockBytes is not (8 or 16))
        {
            throw Invalid("BCn 尺寸、数组层、mip 数或块大小超过安全边界。", path);
        }

        try
        {
            long total = 0;
            var mipWidth = width;
            var mipHeight = height;
            for (var mip = 0; mip < mipCount; mip++)
            {
                total = checked(total +
                    checked(((mipWidth + 3L) / 4) * ((mipHeight + 3L) / 4) * blockBytes));
                mipWidth = Math.Max(1, mipWidth / 2);
                mipHeight = Math.Max(1, mipHeight / 2);
            }

            return checked(total * arraySize);
        }
        catch (OverflowException error)
        {
            throw Invalid("BCn 派生字节数发生整数溢出。", path, error);
        }
    }

    public static byte[] DecodeFirstSlice(Civ6BlpTexture texture, CancellationToken cancellationToken)
    {
        var layout = ResolveLayout(texture.DxgiFormat, $"{texture.RelativePath}/{texture.EntryName}");
        int outputBytes;
        int blocksX;
        int blocksY;
        int firstMipBytes;
        try
        {
            outputBytes = checked(texture.Width * texture.Height * 4);
            blocksX = checked((texture.Width + 3) / 4);
            blocksY = checked((texture.Height + 3) / 4);
            firstMipBytes = checked(blocksX * blocksY * layout.BlockBytes);
        }
        catch (OverflowException error)
        {
            throw Invalid("BCn 解码尺寸发生整数溢出。", texture.EntryName, error);
        }

        if (outputBytes > MaxDecodedBytes || texture.Payload.Length < firstMipBytes)
        {
            throw Invalid("BCn 首级 mip 截断或解码像素超过 64 MiB。", texture.EntryName);
        }

        var result = new byte[outputBytes];
        var sourceOffset = 0;
        for (var blockY = 0; blockY < blocksY; blockY++)
        {
            cancellationToken.ThrowIfCancellationRequested();
            for (var blockX = 0; blockX < blocksX; blockX++)
            {
                var block = texture.Payload.AsSpan(sourceOffset, layout.BlockBytes);
                switch (layout.Kind)
                {
                    case BcTextureKind.Bc1:
                        DecodeBc1(block, result, texture.Width, texture.Height, blockX * 4, blockY * 4);
                        break;
                    case BcTextureKind.Bc2:
                        DecodeBc2(block, result, texture.Width, texture.Height, blockX * 4, blockY * 4);
                        break;
                    case BcTextureKind.Bc3:
                        DecodeBc3(block, result, texture.Width, texture.Height, blockX * 4, blockY * 4);
                        break;
                    case BcTextureKind.Bc5:
                        DecodeBc5(block, result, texture.Width, texture.Height, blockX * 4, blockY * 4);
                        break;
                    default:
                        throw Invalid("BCn 解码器状态无效。", texture.EntryName);
                }

                sourceOffset += layout.BlockBytes;
            }
        }

        return result;
    }

    private static void DecodeBc1(
        ReadOnlySpan<byte> block,
        Span<byte> output,
        int width,
        int height,
        int originX,
        int originY)
    {
        var color0 = ReadUInt16(block, 0);
        var color1 = ReadUInt16(block, 2);
        var indices = ReadUInt32(block, 4);
        Span<Rgba> palette = stackalloc Rgba[4];
        palette[0] = DecodeRgb565(color0);
        palette[1] = DecodeRgb565(color1);
        if (color0 > color1)
        {
            palette[2] = Rgba.Interpolate(palette[0], palette[1], 2, 1);
            palette[3] = Rgba.Interpolate(palette[0], palette[1], 1, 2);
        }
        else
        {
            palette[2] = Rgba.Average(palette[0], palette[1]);
            palette[3] = new(0, 0, 0, 0);
        }

        WriteColorBlock(output, width, height, originX, originY, indices, palette);
    }

    private static void DecodeBc2(
        ReadOnlySpan<byte> block,
        Span<byte> output,
        int width,
        int height,
        int originX,
        int originY)
    {
        var alpha = ReadUInt64(block, 0);
        var indices = ReadUInt32(block, 12);
        Span<Rgba> palette = stackalloc Rgba[4];
        BuildFourColorPalette(block[8..], palette);
        for (var pixel = 0; pixel < 16; pixel++)
        {
            var color = palette[(int)((indices >> (pixel * 2)) & 3)] with
            {
                A = checked((byte)(((alpha >> (pixel * 4)) & 0x0f) * 17)),
            };
            WritePixel(output, width, height, originX, originY, pixel, color);
        }
    }

    private static void DecodeBc3(
        ReadOnlySpan<byte> block,
        Span<byte> output,
        int width,
        int height,
        int originX,
        int originY)
    {
        Span<byte> alpha = stackalloc byte[16];
        DecodeBc4Values(block[..8], alpha);
        var indices = ReadUInt32(block, 12);
        Span<Rgba> palette = stackalloc Rgba[4];
        BuildFourColorPalette(block[8..], palette);
        for (var pixel = 0; pixel < 16; pixel++)
        {
            var color = palette[(int)((indices >> (pixel * 2)) & 3)] with { A = alpha[pixel] };
            WritePixel(output, width, height, originX, originY, pixel, color);
        }
    }

    private static void DecodeBc5(
        ReadOnlySpan<byte> block,
        Span<byte> output,
        int width,
        int height,
        int originX,
        int originY)
    {
        Span<byte> red = stackalloc byte[16];
        Span<byte> green = stackalloc byte[16];
        DecodeBc4Values(block[..8], red);
        DecodeBc4Values(block[8..], green);
        for (var pixel = 0; pixel < 16; pixel++)
        {
            WritePixel(output, width, height, originX, originY, pixel, new(red[pixel], green[pixel], 255, 255));
        }
    }

    private static void DecodeBc4Values(ReadOnlySpan<byte> block, Span<byte> output)
    {
        Span<byte> palette = stackalloc byte[8];
        palette[0] = block[0];
        palette[1] = block[1];
        if (palette[0] > palette[1])
        {
            for (var index = 1; index <= 6; index++)
            {
                palette[index + 1] = checked((byte)(((7 - index) * palette[0] + index * palette[1]) / 7));
            }
        }
        else
        {
            for (var index = 1; index <= 4; index++)
            {
                palette[index + 1] = checked((byte)(((5 - index) * palette[0] + index * palette[1]) / 5));
            }

            palette[6] = 0;
            palette[7] = 255;
        }

        ulong indices = 0;
        for (var index = 0; index < 6; index++)
        {
            indices |= (ulong)block[index + 2] << (index * 8);
        }

        for (var pixel = 0; pixel < 16; pixel++)
        {
            output[pixel] = palette[(int)((indices >> (pixel * 3)) & 7)];
        }
    }

    private static void BuildFourColorPalette(ReadOnlySpan<byte> colors, Span<Rgba> palette)
    {
        palette[0] = DecodeRgb565(ReadUInt16(colors, 0));
        palette[1] = DecodeRgb565(ReadUInt16(colors, 2));
        palette[2] = Rgba.Interpolate(palette[0], palette[1], 2, 1);
        palette[3] = Rgba.Interpolate(palette[0], palette[1], 1, 2);
    }

    private static void WriteColorBlock(
        Span<byte> output,
        int width,
        int height,
        int originX,
        int originY,
        uint indices,
        ReadOnlySpan<Rgba> palette)
    {
        for (var pixel = 0; pixel < 16; pixel++)
        {
            WritePixel(
                output,
                width,
                height,
                originX,
                originY,
                pixel,
                palette[(int)((indices >> (pixel * 2)) & 3)]);
        }
    }

    private static void WritePixel(
        Span<byte> output,
        int width,
        int height,
        int originX,
        int originY,
        int pixel,
        Rgba color)
    {
        var x = originX + pixel % 4;
        var y = originY + pixel / 4;
        if (x >= width || y >= height)
        {
            return;
        }

        var destination = checked((y * width + x) * 4);
        output[destination] = color.R;
        output[destination + 1] = color.G;
        output[destination + 2] = color.B;
        output[destination + 3] = color.A;
    }

    private static Rgba DecodeRgb565(ushort value) => new(
        Expand((value >> 11) & 0x1f, 31),
        Expand((value >> 5) & 0x3f, 63),
        Expand(value & 0x1f, 31),
        255);

    private static byte Expand(int value, int maximum) =>
        checked((byte)((value * 255 + maximum / 2) / maximum));

    private static ushort ReadUInt16(ReadOnlySpan<byte> bytes, int offset) =>
        System.Buffers.Binary.BinaryPrimitives.ReadUInt16LittleEndian(bytes[offset..]);

    private static uint ReadUInt32(ReadOnlySpan<byte> bytes, int offset) =>
        System.Buffers.Binary.BinaryPrimitives.ReadUInt32LittleEndian(bytes[offset..]);

    private static ulong ReadUInt64(ReadOnlySpan<byte> bytes, int offset) =>
        System.Buffers.Binary.BinaryPrimitives.ReadUInt64LittleEndian(bytes[offset..]);

    private static ExtractionException Invalid(string message, string path, Exception? inner = null) =>
        new("asset-texture-decode-invalid", message, path, inner);

    private readonly record struct Rgba(byte R, byte G, byte B, byte A)
    {
        public static Rgba Interpolate(Rgba left, Rgba right, int leftWeight, int rightWeight) => new(
            checked((byte)((left.R * leftWeight + right.R * rightWeight) / 3)),
            checked((byte)((left.G * leftWeight + right.G * rightWeight) / 3)),
            checked((byte)((left.B * leftWeight + right.B * rightWeight) / 3)),
            255);

        public static Rgba Average(Rgba left, Rgba right) => new(
            checked((byte)((left.R + right.R) / 2)),
            checked((byte)((left.G + right.G) / 2)),
            checked((byte)((left.B + right.B) / 2)),
            255);
    }
}
