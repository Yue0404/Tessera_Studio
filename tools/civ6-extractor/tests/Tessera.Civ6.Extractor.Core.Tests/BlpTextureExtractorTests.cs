using System.Buffers.Binary;
using System.IO.Compression;

namespace Tessera.Civ6.Extractor.Core.Tests;

public sealed class BlpTextureExtractorTests
{
    private const string ContainerPath = "DLC/Expansion2/Platforms/Windows/BLPs/strategicview/strategicview_routes.blp";
    private const string CivBigPath = "Base/Platforms/Windows/BLPs/SHARED_DATA/TEXTURE_Terrain_Generic_Resource";

    [Fact]
    public async Task 合成BC2第一层解码为带Alpha的确定性红色Png()
    {
        using var fixture = new SyntheticGameFixture();
        var result = await Service().ExtractAsync(new ExtractionRequest(fixture.Input, fixture.Output));
        fixture.ExtractArchive(result);

        var png = await File.ReadAllBytesAsync(Path.Combine(
            fixture.Output,
            "assets",
            "previews",
            "route",
            "route-railroad.png"));
        var pixel = ReadFirstPixel(png);
        Assert.Equal(new byte[] { 255, 0, 0, 255 }, pixel);
    }

    [Fact]
    public async Task Sprite与Route逻辑条目均按显式索引解析纹理描述符()
    {
        using var fixture = new SyntheticGameFixture();
        var container = await Civ6BlpContainer.OpenAsync(
            SafeInputRoot.Open(fixture.Input),
            ContainerPath,
            CancellationToken.None);

        var sprite = await container.ReadPackageTextureAsync(
            "RailroadSprite",
            "StrategicView_Sprite",
            CancellationToken.None);
        var route = await container.ReadPackageTextureAsync(
            "Railroad",
            "StrategicView_Route",
            CancellationToken.None);

        Assert.Equal("Railroad_Visible", sprite.EntryName);
        Assert.Equal("Railroad_Visible", route.EntryName);
        Assert.Equal(sprite.Payload, route.Payload);
    }

    [Fact]
    public async Task UITexture逻辑条目按正式偏移中的显式索引解析纹理描述符()
    {
        using var fixture = new SyntheticGameFixture();
        var container = await Civ6BlpContainer.OpenAsync(
            SafeInputRoot.Open(fixture.Input),
            ContainerPath,
            CancellationToken.None);

        var texture = await container.ReadPackageTextureAsync(
            "SyntheticAtlas",
            "UITexture",
            CancellationToken.None);

        Assert.Equal("Railroad_Visible", texture.EntryName);
    }

    [Fact]
    public async Task Route逻辑纹理索引越界时稳定拒绝()
    {
        using var fixture = new SyntheticGameFixture();
        var bytes = ReadContainer(fixture);
        BinaryPrimitives.WriteUInt32LittleEndian(bytes.AsSpan(436), 99);
        fixture.ReplaceBinary(ContainerPath, bytes);
        var container = await Civ6BlpContainer.OpenAsync(
            SafeInputRoot.Open(fixture.Input),
            ContainerPath,
            CancellationToken.None);

        var error = await Assert.ThrowsAsync<ExtractionException>(() =>
            container.ReadPackageTextureAsync("Railroad", "StrategicView_Route", CancellationToken.None));

        Assert.Equal("asset-blp-structure-invalid", error.Code);
        Assert.Contains("越界", error.Message, StringComparison.Ordinal);
    }

    [Fact]
    public async Task 逻辑包条目Hash冲突到不同纹理时稳定拒绝而不选择其一()
    {
        using var fixture = new SyntheticGameFixture();
        var bytes = ReadContainer(fixture);
        BinaryPrimitives.WriteUInt32LittleEndian(bytes.AsSpan(448), Fnv1a("Railroad"));
        BinaryPrimitives.WriteUInt32LittleEndian(bytes.AsSpan(480), 2);
        BinaryPrimitives.WriteUInt32LittleEndian(bytes.AsSpan(484), 1);
        BinaryPrimitives.WriteUInt32LittleEndian(bytes.AsSpan(488), 2);
        BinaryPrimitives.WriteUInt32LittleEndian(bytes.AsSpan(492), 0);
        fixture.ReplaceBinary(ContainerPath, bytes);
        var container = await Civ6BlpContainer.OpenAsync(
            SafeInputRoot.Open(fixture.Input),
            ContainerPath,
            CancellationToken.None);

        var error = await Assert.ThrowsAsync<ExtractionException>(() =>
            container.ReadPackageTextureAsync("Railroad", "StrategicView_Route", CancellationToken.None));

        Assert.Equal("asset-blp-structure-invalid", error.Code);
        Assert.Contains("歧义", error.Message, StringComparison.Ordinal);
    }

    [Fact]
    public async Task 已取消目录解析在元数据扫描边界可观察()
    {
        using var fixture = new SyntheticGameFixture();
        var container = await Civ6BlpContainer.OpenAsync(
            SafeInputRoot.Open(fixture.Input),
            ContainerPath,
            CancellationToken.None);
        using var cancellation = new CancellationTokenSource();
        cancellation.Cancel();

        await Assert.ThrowsAnyAsync<OperationCanceledException>(() =>
            container.ReadPackageTextureAsync(
                "Railroad",
                "StrategicView_Route",
                cancellation.Token));
    }

    [Fact]
    public async Task 截断BLP稳定拒绝且不产生输出()
    {
        using var fixture = new SyntheticGameFixture();
        var bytes = ReadContainer(fixture);
        fixture.ReplaceBinary(ContainerPath, bytes[..^1]);

        var error = await Assert.ThrowsAsync<ExtractionException>(() =>
            Service().ExtractAsync(new ExtractionRequest(fixture.Input, fixture.Output)));

        Assert.Equal("asset-blp-structure-invalid", error.Code);
        Assert.False(Directory.Exists(fixture.Output));
    }

    [Fact]
    public async Task 头部偏移整数溢出稳定拒绝()
    {
        using var fixture = new SyntheticGameFixture();
        var bytes = ReadContainer(fixture);
        BinaryPrimitives.WriteUInt32LittleEndian(bytes.AsSpan(12), uint.MaxValue);
        fixture.ReplaceBinary(ContainerPath, bytes);

        var error = await Assert.ThrowsAsync<ExtractionException>(() =>
            Service().ExtractAsync(new ExtractionRequest(fixture.Input, fixture.Output)));

        Assert.Equal("asset-blp-structure-invalid", error.Code);
    }

    [Fact]
    public async Task 目标纹理Hash重复时拒绝而不猜测()
    {
        using var fixture = new SyntheticGameFixture();
        var bytes = ReadContainer(fixture);
        BinaryPrimitives.WriteUInt32LittleEndian(bytes.AsSpan(616), Fnv1a("Railroad_Visible"));
        fixture.ReplaceBinary(ContainerPath, bytes);

        var error = await Assert.ThrowsAsync<ExtractionException>(() =>
            Service().ExtractAsync(new ExtractionRequest(fixture.Input, fixture.Output)));

        Assert.Equal("asset-blp-structure-invalid", error.Code);
        Assert.Contains("哈希冲突", error.Message, StringComparison.Ordinal);
    }

    [Fact]
    public async Task 未验证纹理格式稳定拒绝而不按BC2解码()
    {
        using var fixture = new SyntheticGameFixture();
        var bytes = ReadContainer(fixture);
        BinaryPrimitives.WriteUInt16LittleEndian(bytes.AsSpan(552), 84);
        fixture.ReplaceBinary(ContainerPath, bytes);

        var error = await Assert.ThrowsAsync<ExtractionException>(() =>
            Service().ExtractAsync(new ExtractionRequest(fixture.Input, fixture.Output)));

        Assert.Equal("asset-texture-decode-invalid", error.Code);
    }

    [Fact]
    public async Task ArtDef链变化时在读取载荷前稳定拒绝()
    {
        using var fixture = new SyntheticGameFixture();
        fixture.ReplaceFile(
            "DLC/Expansion2/ArtDefs/StrategicView.artdef",
            "<AssetObjects..ArtDefSet><m_RootCollections /></AssetObjects..ArtDefSet>");

        var error = await Assert.ThrowsAsync<ExtractionException>(() =>
            Service().ExtractAsync(new ExtractionRequest(fixture.Input, fixture.Output)));

        Assert.Equal("input-artdef-schema-unsupported", error.Code);
    }

    [Fact]
    public async Task ArtDef引用重复时稳定拒绝而不泄露框架异常()
    {
        using var fixture = new SyntheticGameFixture();
        const string reference = """
            <Element class="AssetObjects..BLPEntryValue">
              <m_EntryName text="Railroad"/><m_XLPClass text="StrategicView_Route"/>
              <m_XLPPath text="strategicview_routes.xlp"/><m_BLPPackage text="strategicview/strategicview_routes"/>
              <m_LibraryName text="StrategicView_Route"/><m_ParamName text="RouteXLPEntry"/>
            </Element>
            """;
        fixture.ReplaceFile(
            "DLC/Expansion2/ArtDefs/StrategicView.artdef",
            $$$"""
            <AssetObjects..ArtDefSet><m_RootCollections><Element>
              <m_CollectionName text="Routes"/><m_ReplaceMergedCollectionElements>false</m_ReplaceMergedCollectionElements>
              <Element><m_Fields><m_Values>{{{reference}}}{{{reference}}}</m_Values></m_Fields><m_ChildCollections/><m_Name text="Railroad_Completed"/></Element>
            </Element></m_RootCollections></AssetObjects..ArtDefSet>
            """);

        var error = await Assert.ThrowsAsync<ExtractionException>(() =>
            Service().ExtractAsync(new ExtractionRequest(fixture.Input, fixture.Output)));

        Assert.Equal("input-artdef-schema-unsupported", error.Code);
    }

    [Fact]
    public async Task 巨大声明载荷在分配和解码前被安全门禁拒绝()
    {
        using var fixture = new SyntheticGameFixture();
        var bytes = ReadContainer(fixture);
        BinaryPrimitives.WriteUInt16LittleEndian(bytes.AsSpan(554), ushort.MaxValue);
        BinaryPrimitives.WriteUInt16LittleEndian(bytes.AsSpan(556), ushort.MaxValue);
        BinaryPrimitives.WriteUInt16LittleEndian(bytes.AsSpan(560), ushort.MaxValue);
        fixture.ReplaceBinary(ContainerPath, bytes);

        var error = await Assert.ThrowsAsync<ExtractionException>(() =>
            Service().ExtractAsync(new ExtractionRequest(fixture.Input, fixture.Output)));

        Assert.Equal("asset-texture-decode-invalid", error.Code);
        Assert.False(Directory.Exists(fixture.Output));
    }

    [Fact]
    public async Task 已取消纹理探测不继续读取容器()
    {
        using var fixture = new SyntheticGameFixture();
        using var cancellation = new CancellationTokenSource();
        cancellation.Cancel();

        await Assert.ThrowsAnyAsync<OperationCanceledException>(() =>
            Service().InspectTextureContainersAsync(fixture.Input, cancellation.Token));
    }

    [Fact]
    public async Task TextureInspect返回BLP偏移尺寸且不泄露绝对路径()
    {
        using var fixture = new SyntheticGameFixture();
        var result = await Service().InspectTextureContainersAsync(fixture.Input);

        Assert.Equal(ContainerPath, result.Blp.RelativePath);
        Assert.Equal("Railroad_Visible", result.Blp.EntryName);
        Assert.Equal(74, result.Blp.DxgiFormat);
        Assert.Equal(4, result.Blp.Width);
        Assert.Equal(4, result.Blp.Height);
        Assert.Equal(16, result.Blp.PayloadBytes);
        Assert.Equal(16, result.Blp.SlotPrefixBytes);
        Assert.Empty(result.CivBigSamples);
        Assert.DoesNotContain(fixture.Root, System.Text.Json.JsonSerializer.Serialize(result), StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task CivBig头按BCn块公式验证且不读取输出图片()
    {
        using var fixture = new SyntheticGameFixture();
        fixture.ReplaceBinary(CivBigPath, CreateCivBig(format: 78, payloadBytes: 16));

        var inspection = await Service().InspectTextureContainersAsync(fixture.Input);
        var result = Assert.Single(inspection.CivBigSamples);

        Assert.Equal(78, result.DxgiFormat);
        Assert.Equal(4, result.Width);
        Assert.Equal(4, result.Height);
        Assert.Equal(16, result.PayloadBytes);
        Assert.Equal(64, result.HeaderBytes);
    }

    [Fact]
    public async Task CivBig载荷尺寸欺骗和未知格式稳定拒绝()
    {
        using var fixture = new SyntheticGameFixture();
        fixture.ReplaceBinary(CivBigPath, CreateCivBig(format: 78, payloadBytes: 8));
        var sizeError = await Assert.ThrowsAsync<ExtractionException>(() =>
            Service().InspectTextureContainersAsync(fixture.Input));
        Assert.Equal("asset-civbig-structure-invalid", sizeError.Code);

        fixture.ReplaceBinary(CivBigPath, CreateCivBig(format: 999, payloadBytes: 16));
        var formatError = await Assert.ThrowsAsync<ExtractionException>(() =>
            Service().InspectTextureContainersAsync(fixture.Input));
        Assert.Equal("asset-civbig-structure-invalid", formatError.Code);
    }

    private static byte[] ReadContainer(SyntheticGameFixture fixture) =>
        File.ReadAllBytes(Path.Combine(fixture.Input, ContainerPath.Replace('/', Path.DirectorySeparatorChar)));

    private static Civ6ExtractionService Service() => new(
        new FixedTimeProvider(new DateTimeOffset(2026, 8, 22, 8, 0, 0, TimeSpan.Zero)),
        installationProbe: new Civ6InstallationProbe(new FixedVersionReader("1.0.12.68")));

    private static uint Fnv1a(string value)
    {
        var hash = 2166136261u;
        foreach (var item in System.Text.Encoding.UTF8.GetBytes(value))
        {
            hash = unchecked((hash ^ item) * 16777619u);
        }

        return hash;
    }

    private static byte[] CreateCivBig(ushort format, int payloadBytes)
    {
        var bytes = new byte[64 + payloadBytes];
        "CIVBIG\u0000\u0000"u8.CopyTo(bytes);
        BinaryPrimitives.WriteUInt32LittleEndian(bytes.AsSpan(8), checked((uint)payloadBytes));
        BinaryPrimitives.WriteUInt16LittleEndian(bytes.AsSpan(32), 1);
        BinaryPrimitives.WriteUInt16LittleEndian(bytes.AsSpan(34), 1);
        BinaryPrimitives.WriteUInt16LittleEndian(bytes.AsSpan(36), format);
        BinaryPrimitives.WriteUInt16LittleEndian(bytes.AsSpan(38), 4);
        BinaryPrimitives.WriteUInt16LittleEndian(bytes.AsSpan(40), 4);
        BinaryPrimitives.WriteUInt16LittleEndian(bytes.AsSpan(42), 1);
        return bytes;
    }

    private static byte[] ReadFirstPixel(ReadOnlySpan<byte> png)
    {
        using var compressed = new MemoryStream();
        var offset = 8;
        while (offset < png.Length)
        {
            var length = checked((int)BinaryPrimitives.ReadUInt32BigEndian(png[offset..]));
            var type = System.Text.Encoding.ASCII.GetString(png.Slice(offset + 4, 4));
            if (type == "IDAT")
            {
                compressed.Write(png.Slice(offset + 8, length));
            }

            offset = checked(offset + 12 + length);
        }

        compressed.Position = 0;
        using var zlib = new ZLibStream(compressed, CompressionMode.Decompress);
        Span<byte> first = stackalloc byte[5];
        zlib.ReadExactly(first);
        Assert.Equal(0, first[0]);
        return first[1..].ToArray();
    }
}
