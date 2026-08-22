namespace Tessera.Civ6.Extractor.Core;

/// <summary>把已验证的 DXGI RGBA8 或 BCn 首层纹理解码为 RGBA8。</summary>
internal static class Civ6TexturePixelDecoder
{
    private const int MaximumDecodedBytes = 64 * 1024 * 1024;

    public static byte[] DecodeFirstSlice(
        Civ6BlpTexture texture,
        CancellationToken cancellationToken)
    {
        if (texture.DxgiFormat != 28)
        {
            return BcTextureDecoder.DecodeFirstSlice(texture, cancellationToken);
        }

        int outputBytes;
        try
        {
            outputBytes = checked(texture.Width * texture.Height * 4);
        }
        catch (OverflowException error)
        {
            throw Invalid("RGBA8 首层派生字节数发生整数溢出。", texture, error);
        }

        if (outputBytes <= 0 || outputBytes > MaximumDecodedBytes ||
            texture.ArraySize != 1 || texture.Payload.Length < outputBytes)
        {
            throw Invalid("RGBA8 首层尺寸、数组数或载荷边界不满足安全约束。", texture);
        }

        cancellationToken.ThrowIfCancellationRequested();
        return texture.Payload.AsSpan(0, outputBytes).ToArray();
    }

    private static ExtractionException Invalid(
        string message,
        Civ6BlpTexture texture,
        Exception? inner = null) =>
        new(
            "asset-texture-decode-invalid",
            message,
            $"{texture.RelativePath}/{texture.EntryName}",
            inner);
}
