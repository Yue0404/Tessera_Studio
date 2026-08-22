using System.Text.Json;

namespace Tessera.Civ6.Extractor.Core.Tests;

public sealed class StaticPreviewExtractorTests
{
    private const string BaseFeatureArtDef = "Base/ArtDefs/Features.artdef";
    private const string BaseStrategicArtDef = "Base/ArtDefs/StrategicView.artdef";

    [Fact]
    public void 正式不渲染哨兵不进入预览而显式可见纹理保持最高优先级()
    {
        Assert.Null(Civ6StaticPreviewExtractor.CandidatePriority(
            "StrategicView_Sprite",
            "Visible_XLPEntry",
            "DoNotRender"));
        Assert.Equal(0, Civ6StaticPreviewExtractor.CandidatePriority(
            "StrategicView_Sprite",
            "Visible_XLPEntry",
            "Features_Forest_Visible"));
        Assert.Equal(2, Civ6StaticPreviewExtractor.CandidatePriority(
            "StrategicView_Sprite",
            "Visible_XLPEntry",
            "Features_Forest_Pillaged_Visible"));
    }

    [Fact]
    public void 类别统计按精确内容ID归属且城市核心不重复计入区域()
    {
        Civ6ContentDefinition[] definitions =
        [
            Definition("DISTRICT_CITY_CENTER", "city"),
            Definition("DISTRICT_CAMPUS", "district"),
        ];
        GeneratedArtAsset[] assets =
        [
            new(
                "DISTRICT_CITY_CENTER",
                "tessera.civ6:asset.city.district-city-center",
                "assets/previews/city/district-city-center.png",
                "image/png",
                4,
                4,
                "synthetic.blp",
                "CityCenter_Visible",
                [1]),
        ];

        var result = Civ6StaticPreviewExtractor.CountCategories(definitions, assets);

        var city = Assert.Single(result, value => value.Category == "city");
        var district = Assert.Single(result, value => value.Category == "district");
        Assert.Equal((1, 1, 0), (city.ContentCount, city.ExtractedCount, city.PlaceholderCount));
        Assert.Equal((1, 0, 1), (district.ContentCount, district.ExtractedCount, district.PlaceholderCount));
    }

    [Fact]
    public async Task StrategicView内部引用成环时稳定失败且不替换既有输出()
    {
        using var fixture = new SyntheticGameFixture();
        fixture.ReplaceFile(BaseFeatureArtDef, ContentReferenceArtDef("FEATURE_FOREST", "Node0"));
        fixture.ReplaceFile(BaseStrategicArtDef, StrategicArtDef(
            ReferenceNode("Node0", "Node1") + ReferenceNode("Node1", "Node0")));

        var error = await AssertExtractionFailureDoesNotReplaceAsync(fixture);

        Assert.Equal("art-preview-reference-cycle", error.Code);
    }

    [Fact]
    public async Task StrategicView内部引用超过八层时稳定失败且不替换既有输出()
    {
        using var fixture = new SyntheticGameFixture();
        fixture.ReplaceFile(BaseFeatureArtDef, ContentReferenceArtDef("FEATURE_FOREST", "Node0"));
        fixture.ReplaceFile(BaseStrategicArtDef, StrategicArtDef(string.Concat(
            Enumerable.Range(0, 9)
                .Select(index => ReferenceNode($"Node{index}", $"Node{index + 1}"))
                .Append(EmptyNode("Node9")))));

        var error = await AssertExtractionFailureDoesNotReplaceAsync(fixture);

        Assert.Equal("art-preview-reference-depth-exceeded", error.Code);
    }

    [Fact]
    public async Task 同优先级不同纹理身份保持占位且其他内容继续生成()
    {
        using var fixture = new SyntheticGameFixture();
        fixture.ReplaceFile(BaseFeatureArtDef, ContentReferenceArtDef("FEATURE_FOREST", "Ambiguous"));
        fixture.ReplaceFile(BaseStrategicArtDef, StrategicArtDef(AmbiguousNode()));
        fixture.ReplaceBinary("Base/Platforms/Windows/BLPs/strategicview/first.blp", "CIVBLP\u0002\u0000"u8.ToArray());
        fixture.ReplaceBinary("Base/Platforms/Windows/BLPs/strategicview/second.blp", "CIVBLP\u0002\u0000"u8.ToArray());

        var inspection = await Service().InspectArtAssetsAsync(fixture.Input);
        var result = await Service().ExtractAsync(new ExtractionRequest(fixture.Input, fixture.Output));
        fixture.ExtractArchive(result);

        Assert.Contains(inspection.Diagnostics, value =>
            value.Code == "art-preview-selection-ambiguous" && value.RelativePath == "FEATURE_FOREST");
        Assert.Equal(1, result.ResourceCount);
        using var elements = JsonDocument.Parse(await File.ReadAllBytesAsync(
            Path.Combine(fixture.Output, "elements", "content.json")));
        var forest = elements.RootElement.EnumerateArray().Single(value =>
            value.GetProperty("elementId").GetString() == "tessera.civ6:object.feature.feature-forest");
        Assert.Empty(forest.GetProperty("resourceIds").EnumerateArray());
        Assert.True(forest.GetProperty("extensions").GetProperty("generatedPlaceholder").GetBoolean());
        Assert.True(File.Exists(Path.Combine(
            fixture.Output,
            "assets",
            "previews",
            "route",
            "route-railroad.png")));
    }

    private static async Task<ExtractionException> AssertExtractionFailureDoesNotReplaceAsync(
        SyntheticGameFixture fixture)
    {
        Directory.CreateDirectory(fixture.Output);
        var marker = Path.Combine(fixture.Output, "existing.txt");
        await File.WriteAllTextAsync(marker, "keep");

        var error = await Assert.ThrowsAsync<ExtractionException>(() =>
            Service().ExtractAsync(new ExtractionRequest(fixture.Input, fixture.Output)));

        Assert.Equal("keep", await File.ReadAllTextAsync(marker));
        Assert.Equal([marker], Directory.EnumerateFiles(fixture.Output, "*", SearchOption.AllDirectories));
        return error;
    }

    private static Civ6ExtractionService Service() => new(
        new FixedTimeProvider(new DateTimeOffset(2026, 8, 22, 8, 0, 0, TimeSpan.Zero)),
        installationProbe: new Civ6InstallationProbe(new FixedVersionReader("1.0.12.68")));

    private static string ContentReferenceArtDef(string contentId, string targetName) => ArtDef("Feature", $"""
        <Element><m_Fields><m_Values><Element class="AssetObjects..ArtDefReferenceValue">
          <m_ElementName text="{targetName}"/><m_RootCollectionName text="Nodes"/>
          <m_ArtDefPath text="StrategicView.artdef"/><m_ParamName text="Xref"/>
        </Element></m_Values></m_Fields><m_ChildCollections/><m_Name text="{contentId}"/></Element>
        """);

    private static string StrategicArtDef(string elements) => ArtDef("Nodes", elements);

    private static string ReferenceNode(string name, string targetName) => $"""
        <Element><m_Fields><m_Values><Element class="AssetObjects..ArtDefReferenceValue">
          <m_ElementName text="{targetName}"/><m_RootCollectionName text="Nodes"/>
          <m_ArtDefPath text="StrategicView.artdef"/><m_ParamName text="Xref"/>
        </Element></m_Values></m_Fields><m_ChildCollections/><m_Name text="{name}"/></Element>
        """;

    private static string EmptyNode(string name) => $"""
        <Element><m_Fields><m_Values/></m_Fields><m_ChildCollections/><m_Name text="{name}"/></Element>
        """;

    private static string AmbiguousNode() => """
        <Element><m_Fields><m_Values>
          <Element class="AssetObjects..BLPEntryValue"><m_EntryName text="First"/><m_XLPClass text="StrategicView_Sprite"/><m_XLPPath text="first.xlp"/><m_BLPPackage text="strategicview/first"/><m_LibraryName text="StrategicView_Sprite"/><m_ParamName text="Visible_XLPEntry"/></Element>
          <Element class="AssetObjects..BLPEntryValue"><m_EntryName text="Second"/><m_XLPClass text="StrategicView_Sprite"/><m_XLPPath text="second.xlp"/><m_BLPPackage text="strategicview/second"/><m_LibraryName text="StrategicView_Sprite"/><m_ParamName text="Visible_XLPEntry"/></Element>
        </m_Values></m_Fields><m_ChildCollections/><m_Name text="Ambiguous"/></Element>
        """;

    private static string ArtDef(string collection, string elements) => $"""
        <AssetObjects..ArtDefSet>
          <m_Version><major>4</major><minor>0</minor></m_Version>
          <m_TemplateName text="{collection}"/>
          <m_RootCollections><Element><m_CollectionName text="{collection}"/><m_ReplaceMergedCollectionElements>false</m_ReplaceMergedCollectionElements>{elements}</Element></m_RootCollections>
        </AssetObjects..ArtDefSet>
        """;

    private static Civ6ContentDefinition Definition(string id, string category) =>
        new(id, category, $"LOC_{id}_NAME", null, "synthetic.xml", new Dictionary<string, string>());
}
