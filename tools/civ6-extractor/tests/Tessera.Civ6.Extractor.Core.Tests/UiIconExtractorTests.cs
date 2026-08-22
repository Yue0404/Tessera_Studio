using System.Buffers.Binary;
using System.IO.Compression;

namespace Tessera.Civ6.Extractor.Core.Tests;

public sealed class UiIconExtractorTests
{
    private const string IconTablePath = "Base/Assets/UI/Icons/Icons_Resources.xml";
    private const string ContainerPath = "Base/Platforms/Windows/BLPs/UI/Icons.blp";

    [Fact]
    public async Task PlainRgba8页按显式UITexture指针读取且不进入BC解码器()
    {
        using var fixture = new SyntheticGameFixture();
        fixture.ReplaceBinary(ContainerPath, SyntheticGameFixture.CreateUiAtlasBlp());
        var container = await Civ6BlpContainer.OpenAsync(
            SafeInputRoot.Open(fixture.Input),
            ContainerPath,
            CancellationToken.None);

        var texture = await container.ReadPackageTextureAsync(
            "SyntheticAtlas",
            "UITexture",
            CancellationToken.None);
        var rgba = Civ6TexturePixelDecoder.DecodeFirstSlice(texture, CancellationToken.None);

        Assert.Equal(28, texture.DxgiFormat);
        Assert.Equal(8, texture.Width);
        Assert.Equal(8, texture.Height);
        Assert.Equal(new byte[] { 255, 0, 0, 255 }, rgba[..4]);
        Assert.Equal(new byte[] { 0, 0, 255, 255 }, rgba.AsSpan((4 * 8) * 4, 4).ToArray());
    }

    [Fact]
    public async Task IconDefinitions精确索引裁切并保留透明像素与分项计数()
    {
        using var fixture = new SyntheticGameFixture();
        PrepareIconTable(fixture);
        fixture.ReplaceBinary(ContainerPath, SyntheticGameFixture.CreateUiAtlasBlp());

        var result = await Civ6UiIconExtractor.FillPlaceholdersAsync(
            SafeInputRoot.Open(fixture.Input),
            Definitions(),
            EmptyStrategic(),
            CancellationToken.None);

        Assert.Equal(2, result.Assets.Count);
        Assert.Equal(new byte[] { 0, 0, 255, 255 }, ReadFirstPixel(
            result.Assets.Single(value => value.ContentId == "RESOURCE_WHEAT").Bytes));
        Assert.Equal(new byte[] { 255, 255, 255, 0 }, ReadFirstPixel(
            result.Assets.Single(value => value.ContentId == "RESOURCE_AMBER").Bytes));
        var category = Assert.Single(result.Categories);
        Assert.Equal(0, category.StrategicCount);
        Assert.Equal(2, category.UiIconCount);
        Assert.Equal(0, category.PlaceholderCount);
        Assert.Contains(result.SourceFiles, value => value.RelativePath == IconTablePath);
        Assert.Contains(result.SourceFiles, value => value.RelativePath == ContainerPath);
    }

    [Theory]
    [InlineData((ushort)4)]
    [InlineData((ushort)8)]
    public async Task PackedUi条目只产生结构化占位且不返回半成品(ushort blockIndexBytes)
    {
        using var fixture = new SyntheticGameFixture();
        PrepareIconTable(fixture);
        fixture.ReplaceBinary(
            ContainerPath,
            SyntheticGameFixture.CreatePackedUiAtlasBlp(blockIndexBytes: blockIndexBytes));

        var result = await Civ6UiIconExtractor.FillPlaceholdersAsync(
            SafeInputRoot.Open(fixture.Input),
            Definitions(),
            EmptyStrategic(),
            CancellationToken.None);

        Assert.Empty(result.Assets);
        Assert.Equal(2, result.Diagnostics.Count(
            value => value.Code == "asset-ui-packed-layout-unsupported"));
        Assert.Contains(result.SourceFiles, value => value.RelativePath == ContainerPath);
        var category = Assert.Single(result.Categories);
        Assert.Equal(0, category.UiIconCount);
        Assert.Equal(2, category.PlaceholderCount);
    }

    [Fact]
    public async Task PackedUi描述符反向索引加法溢出时拒绝伪装记录()
    {
        using var fixture = new SyntheticGameFixture();
        fixture.ReplaceBinary(
            ContainerPath,
            SyntheticGameFixture.CreatePackedUiAtlasBlp(uint.MaxValue));
        var container = await Civ6BlpContainer.OpenAsync(
            SafeInputRoot.Open(fixture.Input),
            ContainerPath,
            CancellationToken.None);

        var error = await Assert.ThrowsAsync<ExtractionException>(() =>
            container.ReadPackageTextureAsync(
                "SyntheticAtlas",
                "UITexture",
                CancellationToken.None));

        Assert.Equal("asset-blp-structure-invalid", error.Code);
    }

    [Fact]
    public async Task 扩展图标表按RowUpdateDeleteReplace顺序合并且稳定裁切()
    {
        using var fixture = new SyntheticGameFixture();
        PrepareIconTable(fixture);
        fixture.ReplaceFile("DLC/Expansion1/Data/Expansion1_Icons_Resources.xml", """
            <GameInfo>
              <IconTextureAtlases>
                <Replace Name="ICON_ATLAS_RESOURCES" IconSize="4" IconsPerRow="2"
                         IconsPerColumn="2" Filename="SyntheticAtlas.dds"/>
              </IconTextureAtlases>
              <IconDefinitions>
                <Update>
                  <Where Name="ICON_RESOURCE_WHEAT" Atlas="ICON_ATLAS_RESOURCES"/>
                  <Set Index="2"/>
                </Update>
                <Delete Name="ICON_RESOURCE_AMBER" Atlas="ICON_ATLAS_RESOURCES"/>
                <Row Name="ICON_RESOURCE_AMBER" Atlas="ICON_ATLAS_RESOURCES" Index="3"/>
              </IconDefinitions>
            </GameInfo>
            """);
        fixture.ReplaceBinary(
            "DLC/Expansion1/Platforms/Windows/BLPs/UI/Icons.blp",
            SyntheticGameFixture.CreateUiAtlasBlp());

        var result = await Civ6UiIconExtractor.FillPlaceholdersAsync(
            SafeInputRoot.Open(fixture.Input),
            Definitions(),
            EmptyStrategic(),
            CancellationToken.None);

        Assert.Equal(new byte[] { 0, 0, 255, 255 }, ReadFirstPixel(
            result.Assets.Single(value => value.ContentId == "RESOURCE_WHEAT").Bytes));
        Assert.Equal(new byte[] { 255, 255, 255, 0 }, ReadFirstPixel(
            result.Assets.Single(value => value.ContentId == "RESOURCE_AMBER").Bytes));
        Assert.Contains(result.SourceFiles, value =>
            value.RelativePath == "DLC/Expansion1/Data/Expansion1_Icons_Resources.xml");
    }

    [Fact]
    public async Task StrategicView已有资源时保持优先且不读取损坏的Ui容器()
    {
        using var fixture = new SyntheticGameFixture();
        PrepareIconTable(fixture);
        fixture.ReplaceBinary(ContainerPath, "not-a-civblp"u8.ToArray());
        var asset = new GeneratedArtAsset(
            "RESOURCE_WHEAT",
            "resource",
            "assets/previews/resource/resource-wheat.png",
            "image/png",
            4,
            4,
            "strategic.blp",
            "Wheat",
            [1]);
        var strategic = new GeneratedArtExtraction(
            [asset],
            [],
            [],
            [new("resource", 1, 1, 0, StrategicCount: 1)],
            0);

        var result = await Civ6UiIconExtractor.FillPlaceholdersAsync(
            SafeInputRoot.Open(fixture.Input),
            [Definitions()[0]],
            strategic,
            CancellationToken.None);

        Assert.Same(asset, Assert.Single(result.Assets));
        Assert.DoesNotContain(result.SourceFiles, value => value.RelativePath == ContainerPath);
    }

    private static void PrepareIconTable(SyntheticGameFixture fixture) =>
        fixture.ReplaceFile(IconTablePath, """
            <GameInfo>
              <IconTextureAtlases>
                <Row Name="ICON_ATLAS_RESOURCES" IconSize="4" IconsPerRow="2" IconsPerColumn="2"
                     Filename="SyntheticAtlas.dds"/>
              </IconTextureAtlases>
              <IconDefinitions>
                <Row Name="ICON_RESOURCE_WHEAT" Atlas="ICON_ATLAS_RESOURCES" Index="2"/>
                <Row Name="ICON_RESOURCE_AMBER" Atlas="ICON_ATLAS_RESOURCES" Index="3"/>
              </IconDefinitions>
            </GameInfo>
            """);

    private static Civ6ContentDefinition[] Definitions() =>
    [
        new("RESOURCE_WHEAT", "resource", "LOC_WHEAT", null, "wheat.xml",
            new Dictionary<string, string>(StringComparer.Ordinal)),
        new("RESOURCE_AMBER", "resource", "LOC_AMBER", null, "amber.xml",
            new Dictionary<string, string>(StringComparer.Ordinal)),
    ];

    private static GeneratedArtExtraction EmptyStrategic() => new([], [], [], [], 0);

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
