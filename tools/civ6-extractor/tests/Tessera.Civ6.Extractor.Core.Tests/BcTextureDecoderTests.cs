using System.Buffers.Binary;

namespace Tessera.Civ6.Extractor.Core.Tests;

public sealed class BcTextureDecoderTests
{
    [Theory]
    [InlineData(71)]
    [InlineData(72)]
    public void BC1与Srgb别名解码透明和不透明像素(int format)
    {
        var block = new byte[8];
        BinaryPrimitives.WriteUInt16LittleEndian(block, 0);
        BinaryPrimitives.WriteUInt16LittleEndian(block.AsSpan(2), ushort.MaxValue);
        BinaryPrimitives.WriteUInt32LittleEndian(block.AsSpan(4), 3);

        var rgba = Decode(checked((ushort)format), block);

        Assert.Equal(new byte[] { 0, 0, 0, 0 }, rgba[..4]);
        Assert.Equal(new byte[] { 0, 0, 0, 255 }, rgba[4..8]);
    }

    [Theory]
    [InlineData(74)]
    [InlineData(75)]
    public void BC2与Srgb别名保留显式四位Alpha(int format)
    {
        var block = new byte[16];
        block.AsSpan(..8).Fill(0x10);
        BinaryPrimitives.WriteUInt16LittleEndian(block.AsSpan(8), 0xf800);
        BinaryPrimitives.WriteUInt16LittleEndian(block.AsSpan(10), 0xf800);

        var rgba = Decode(checked((ushort)format), block);

        Assert.Equal(new byte[] { 255, 0, 0, 0 }, rgba[..4]);
        Assert.Equal(new byte[] { 255, 0, 0, 17 }, rgba[4..8]);
    }

    [Theory]
    [InlineData(77)]
    [InlineData(78)]
    public void BC3与Srgb别名解码插值Alpha(int format)
    {
        var block = new byte[16];
        block[0] = 255;
        block[1] = 0;
        block[2] = 2;
        BinaryPrimitives.WriteUInt16LittleEndian(block.AsSpan(8), 0x07e0);
        BinaryPrimitives.WriteUInt16LittleEndian(block.AsSpan(10), 0x07e0);

        var rgba = Decode(checked((ushort)format), block);

        Assert.Equal(new byte[] { 0, 255, 0, 218 }, rgba[..4]);
    }

    [Fact]
    public void BC5解码两个独立通道并生成不透明预览()
    {
        var block = new byte[16];
        block[0] = 20;
        block[1] = 10;
        block[8] = 40;
        block[9] = 30;

        var rgba = Decode(83, block);

        Assert.Equal(new byte[] { 20, 40, 255, 255 }, rgba[..4]);
    }

    [Theory]
    [InlineData(70)]
    [InlineData(73)]
    [InlineData(76)]
    [InlineData(84)]
    [InlineData(99)]
    public void 未验证或有符号DXGI格式稳定拒绝(int format)
    {
        var texture = Texture(checked((ushort)format), new byte[16]);

        var error = Assert.Throws<ExtractionException>(() =>
            BcTextureDecoder.DecodeFirstSlice(texture, CancellationToken.None));

        Assert.Equal("asset-texture-decode-invalid", error.Code);
    }

    [Fact]
    public void 巨大像素输出在分配前稳定拒绝()
    {
        var texture = Texture(71, new byte[8]) with { Width = 8192, Height = 8192 };

        var error = Assert.Throws<ExtractionException>(() =>
            BcTextureDecoder.DecodeFirstSlice(texture, CancellationToken.None));

        Assert.Equal("asset-texture-decode-invalid", error.Code);
    }

    [Fact]
    public void 已取消解码在块行边界可观察()
    {
        var block = Enumerable.Repeat((byte)0, 8 * 4).ToArray();
        var texture = Texture(71, block) with { Width = 16, Height = 4 };
        using var cancellation = new CancellationTokenSource();
        cancellation.Cancel();

        Assert.ThrowsAny<OperationCanceledException>(() =>
            BcTextureDecoder.DecodeFirstSlice(texture, cancellation.Token));
    }

    private static byte[] Decode(ushort format, byte[] block) =>
        BcTextureDecoder.DecodeFirstSlice(Texture(format, block), CancellationToken.None);

    private static Civ6BlpTexture Texture(ushort format, byte[] block) => new(
        "synthetic.blp",
        "Synthetic",
        format,
        4,
        4,
        1,
        1,
        block.Length,
        0,
        16,
        block);
}
