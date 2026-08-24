namespace Tessera.Civ6.Extractor.Core.Tests;

public sealed class ArtAssetProbeTests
{
    [Fact]
    public async Task 正式ID经ArtDef引用落到可证容器且只声明完整StrategicView链可提取()
    {
        using var fixture = new SyntheticGameFixture();

        var result = await Service().InspectArtAssetsAsync(fixture.Input);

        Assert.Equal(19, result.TotalContentCount);
        Assert.Equal(19, result.MappedContentCount);
        Assert.True(result.StaticImageExtractionAvailable);
        Assert.Equal("partial-strategicview-only", result.StaticImageBlockerCode);
        Assert.Equal(8, result.Categories.Count);
        var wheat = Assert.Single(result.Samples, value => value.ContentId == "RESOURCE_WHEAT");
        var asset = Assert.Single(wheat.Assets);
        Assert.Equal("RES_Wheat_Tuft04", asset.EntryName);
        Assert.Equal("Base/Platforms/Windows/BLPs/environment/clutter.blp", asset.ContainerRelativePath);
        Assert.Equal("firaxis-civblp-v2", asset.ContainerFormat);
        Assert.False(asset.DirectStaticImage);
        Assert.Contains(result.Diagnostics, value => value.Code == "art-static-image-extraction-partial");
        Assert.DoesNotContain(result.Diagnostics, value => value.Code == "art-static-image-extraction-unavailable");
    }

    [Fact]
    public async Task 扩展同名变体允许覆盖而单文件重复稳定拒绝()
    {
        using var fixture = new SyntheticGameFixture();
        fixture.ReplaceFile("DLC/Expansion2/ArtDefs/Terrains.artdef", DirectArtDef("Terrain", "TERRAIN_GRASS"));
        var allowed = await Service().InspectArtAssetsAsync(fixture.Input);
        Assert.Equal(1, allowed.Categories.Single(value => value.Category == "terrain").MappedContentCount);

        fixture.ReplaceFile("Base/ArtDefs/Terrains.artdef", DirectArtDef("Terrain", "TERRAIN_GRASS", "TERRAIN_GRASS"));
        var error = await Assert.ThrowsAsync<ExtractionException>(() => Service().InspectArtAssetsAsync(fixture.Input));
        Assert.Equal("input-artdef-element-duplicate", error.Code);
    }

    [Fact]
    public async Task ArtDef跨白名单引用与缺目标均稳定拒绝()
    {
        using var fixture = new SyntheticGameFixture();
        fixture.ReplaceFile("Base/ArtDefs/Resources.artdef", ResourceReference("CLUTTER_WHEAT", "Mods/Evil.artdef"));
        var outside = await Assert.ThrowsAsync<ExtractionException>(() => Service().InspectArtAssetsAsync(fixture.Input));
        Assert.Equal("input-artdef-reference-outside-whitelist", outside.Code);

        fixture.ReplaceFile("Base/ArtDefs/Resources.artdef", ResourceReference("CLUTTER_MISSING", "Clutter.artdef"));
        var missing = await Assert.ThrowsAsync<ExtractionException>(() => Service().InspectArtAssetsAsync(fixture.Input));
        Assert.Equal("input-artdef-reference-target-missing", missing.Code);
    }

    [Fact]
    public async Task 未知ArtDef版本稳定拒绝()
    {
        using var fixture = new SyntheticGameFixture();
        fixture.ReplaceFile(
            "Base/ArtDefs/Terrains.artdef",
            DirectArtDef("Terrain", "TERRAIN_GRASS").Replace("<major>4</major>", "<major>99</major>", StringComparison.Ordinal));

        var error = await Assert.ThrowsAsync<ExtractionException>(() => Service().InspectArtAssetsAsync(fixture.Input));
        Assert.Equal("input-artdef-schema-unsupported", error.Code);
    }

    [Fact]
    public async Task 未知容器头与超大容器在读取内容前拒绝()
    {
        using var fixture = new SyntheticGameFixture();
        fixture.ReplaceBinary("Base/Platforms/Windows/BLPs/environment/clutter.blp", new byte[8]);
        var malformed = await Assert.ThrowsAsync<ExtractionException>(() => Service().InspectArtAssetsAsync(fixture.Input));
        Assert.Equal("asset-container-format-unknown", malformed.Code);

        fixture.CreateSparseFile("Base/Platforms/Windows/BLPs/environment/clutter.blp", 512L * 1024 * 1024 + 1);
        var oversized = await Assert.ThrowsAsync<ExtractionException>(() => Service().InspectArtAssetsAsync(fixture.Input));
        Assert.Equal("asset-container-size-invalid", oversized.Code);
    }

    [Fact]
    public async Task 已取消ArtDef探针不继续读取容器()
    {
        using var fixture = new SyntheticGameFixture();
        using var cancellation = new CancellationTokenSource();
        cancellation.Cancel();

        await Assert.ThrowsAnyAsync<OperationCanceledException>(() =>
            Service().InspectArtAssetsAsync(fixture.Input, cancellation.Token));
    }

    private static Civ6ExtractionService Service() =>
        new(installationProbe: new Civ6InstallationProbe(new FixedVersionReader("1.0.12.68")));

    private static string DirectArtDef(string collection, params string[] names)
    {
        var elements = string.Join(string.Empty, names.Select(name => $"""
            <Element><m_Fields><m_Values><Element class="AssetObjects..BLPEntryValue"><m_EntryName text="{name}_ICON"/><m_XLPClass text="UITexture"/><m_XLPPath text="icons.xlp"/><m_BLPPackage text="UI/Icons"/><m_LibraryName text="UITexture"/><m_ParamName text="Texture"/></Element></m_Values></m_Fields><m_ChildCollections/><m_Name text="{name}"/></Element>
            """));
        return $"<AssetObjects..ArtDefSet><m_Version><major>4</major><minor>0</minor></m_Version><m_TemplateName text=\"{collection}\"/><m_RootCollections><Element><m_CollectionName text=\"{collection}\"/>{elements}</Element></m_RootCollections></AssetObjects..ArtDefSet>";
    }

    private static string ResourceReference(string target, string artDefPath) => $"""
        <AssetObjects..ArtDefSet><m_Version><major>4</major><minor>0</minor></m_Version><m_TemplateName text="Resources"/><m_RootCollections><Element><m_CollectionName text="Resource"/>
          <Element><m_Fields><m_Values/></m_Fields><m_ChildCollections><Element><m_CollectionName text="Clutter"/><Element><m_Fields><m_Values>
            <Element class="AssetObjects..StringValue"><m_Value text="{target}"/><m_ParamName text="XrefName"/></Element>
            <Element class="AssetObjects..ArtDefReferenceValue"><m_ElementName text=""/><m_RootCollectionName text=""/><m_ArtDefPath text="{artDefPath}"/><m_ParamName text="Xref"/></Element>
          </m_Values></m_Fields><m_Name text="Clutter001"/></Element></Element></m_ChildCollections><m_Name text="RESOURCE_WHEAT"/></Element>
        </Element></m_RootCollections></AssetObjects..ArtDefSet>
        """;
}
