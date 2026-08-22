using System.Text.Json;

namespace Tessera.Civ6.Extractor.Core.Tests;

public sealed class ExtractionServiceTests
{
    private static readonly DateTimeOffset FixedNow = new(2026, 8, 22, 8, 0, 0, TimeSpan.Zero);

    [Fact]
    public async Task 正式结构生成八类目录并提取一条铁路预览且不修改输入()
    {
        using var fixture = new SyntheticGameFixture();
        var before = fixture.SnapshotInput();

        var result = await Service().ExtractAsync(new ExtractionRequest(fixture.Input, fixture.Output));

        Assert.Equal("tessera.civ6", result.ModuleId);
        Assert.Equal(18, result.ElementCount);
        Assert.Equal(1, result.ResourceCount);
        Assert.Equal(before, fixture.SnapshotInput());
        Assert.DoesNotContain(
            Directory.EnumerateFiles(fixture.Output, "*", SearchOption.AllDirectories),
            path => Path.GetExtension(path) is ".xml" or ".artdef" or ".webp");

        using var module = JsonDocument.Parse(await File.ReadAllBytesAsync(Path.Combine(fixture.Output, "module.json")));
        var resource = Assert.Single(module.RootElement.GetProperty("resources").EnumerateArray());
        Assert.Equal("tessera.civ6:asset.route.route-railroad", resource.GetProperty("resourceId").GetString());
        Assert.Equal("assets/previews/route/route-railroad.png", resource.GetProperty("path").GetString());
        Assert.Equal("image/png", resource.GetProperty("mimeType").GetString());
        Assert.Equal("local-only", resource.GetProperty("license").GetProperty("status").GetString());
        Assert.Equal(9, module.RootElement.GetProperty("layers").GetArrayLength());
        Assert.Equal("elements/content.json", Assert.Single(module.RootElement.GetProperty("elementFiles").EnumerateArray()).GetString());

        using var catalog = JsonDocument.Parse(await File.ReadAllBytesAsync(Path.Combine(fixture.Output, "catalog", "content-catalog.json")));
        var counts = catalog.RootElement.GetProperty("categories").EnumerateArray().ToDictionary(
            value => value.GetProperty("categoryId").GetString()!,
            value => value.GetProperty("count").GetInt32(),
            StringComparer.Ordinal);
        Assert.Equal(8, counts.Count);
        Assert.Equal(1, counts["tessera.civ6:category.city"]);
        Assert.Equal(3, counts["tessera.civ6:category.wonder"]);

        using var elements = JsonDocument.Parse(await File.ReadAllBytesAsync(Path.Combine(fixture.Output, "elements", "content.json")));
        var railroad = elements.RootElement.EnumerateArray().Single(element =>
            element.GetProperty("elementId").GetString() == "tessera.civ6:object.route.route-railroad");
        Assert.Equal(
            "tessera.civ6:asset.route.route-railroad",
            Assert.Single(railroad.GetProperty("resourceIds").EnumerateArray()).GetString());
        Assert.True(railroad.GetProperty("extensions").GetProperty("hasExtractedArt").GetBoolean());
        Assert.Equal(4, railroad.GetProperty("extensions").GetProperty("assetWidth").GetInt32());
        Assert.Equal(4, railroad.GetProperty("extensions").GetProperty("assetHeight").GetInt32());
        Assert.All(elements.RootElement.EnumerateArray().Where(element =>
            element.GetProperty("elementId").GetString() != "tessera.civ6:object.route.route-railroad"), element =>
        {
            Assert.Empty(element.GetProperty("resourceIds").EnumerateArray());
            Assert.True(element.GetProperty("extensions").GetProperty("generatedPlaceholder").GetBoolean());
            Assert.False(element.GetProperty("extensions").GetProperty("hasExtractedArt").GetBoolean());
        });
        Assert.DoesNotContain(elements.RootElement.EnumerateArray(), element =>
            element.GetProperty("elementId").GetString()!.Contains("monument", StringComparison.Ordinal));
        var png = await File.ReadAllBytesAsync(Path.Combine(
            fixture.Output,
            "assets",
            "previews",
            "route",
            "route-railroad.png"));
        Assert.Equal(new byte[] { 137, 80, 78, 71, 13, 10, 26, 10 }, png[..8]);
        Assert.Equal(4u, System.Buffers.Binary.BinaryPrimitives.ReadUInt32BigEndian(png.AsSpan(16, 4)));
        Assert.Equal(4u, System.Buffers.Binary.BinaryPrimitives.ReadUInt32BigEndian(png.AsSpan(20, 4)));
        Assert.Equal(6, png[25]);
    }

    [Fact]
    public async Task 扩展Update覆盖基础字段且中文按扩展顺序覆盖()
    {
        using var fixture = new SyntheticGameFixture();
        await Service().ExtractAsync(new ExtractionRequest(fixture.Input, fixture.Output));

        using var elements = JsonDocument.Parse(await File.ReadAllBytesAsync(Path.Combine(fixture.Output, "elements", "content.json")));
        var forest = elements.RootElement.EnumerateArray().Single(value =>
            value.GetProperty("elementId").GetString() == "tessera.civ6:object.feature.feature-forest");
        Assert.Equal(
            "LOC_FEATURE_FOREST_XP2_NAME",
            forest.GetProperty("source").GetProperty("extensions").GetProperty("gameNameKey").GetString());
        var campus = elements.RootElement.EnumerateArray().Single(value =>
            value.GetProperty("elementId").GetString() == "tessera.civ6:object.district.district-campus");
        Assert.Equal(
            "LOC_DISTRICT_CAMPUS_XP2_DESCRIPTION",
            campus.GetProperty("source").GetProperty("extensions").GetProperty("gameDescriptionKey").GetString());
        var government = elements.RootElement.EnumerateArray().Single(value =>
            value.GetProperty("elementId").GetString() == "tessera.civ6:object.district.district-government");
        Assert.Equal(
            "LOC_DISTRICT_CAMPUS_XP2_DESCRIPTION",
            government.GetProperty("source").GetProperty("extensions").GetProperty("gameDescriptionKey").GetString());

        using var locale = JsonDocument.Parse(await File.ReadAllBytesAsync(Path.Combine(fixture.Output, "locales", "zh-CN.json")));
        Assert.Equal("森林（风云变幻）", locale.RootElement.GetProperty("element.feature.feature-forest.name").GetString());
        Assert.Equal("小麦（风云变幻）", locale.RootElement.GetProperty("element.resource.resource-wheat.name").GetString());
    }

    [Fact]
    public async Task Catalog检查只返回计数和少量ID()
    {
        using var fixture = new SyntheticGameFixture();
        var catalog = await Service().InspectCatalogAsync(fixture.Input);

        Assert.Equal(18, catalog.TotalCount);
        Assert.Equal(18, catalog.ChineseNameCount);
        Assert.Equal(0, catalog.FallbackNameCount);
        Assert.Equal(8, catalog.Categories.Count);
        Assert.All(catalog.Categories, category => Assert.InRange(category.SampleIds.Count, 1, 3));
    }

    [Fact]
    public async Task Delete按谓词删除且不恢复旧实体()
    {
        using var fixture = new SyntheticGameFixture();
        fixture.ReplaceFile("DLC/Expansion2/Data/Expansion2_Features.xml", """
            <GameInfo>
              <Types><Row Type="FEATURE_VOLCANO"/><Delete Type="FEATURE_FOREST"/></Types>
              <Features>
                <Delete><Where FeatureType="FEATURE_FOREST"/></Delete>
                <Row FeatureType="FEATURE_VOLCANO" Name="LOC_FEATURE_VOLCANO_NAME"/>
              </Features>
            </GameInfo>
            """);

        await Service().ExtractAsync(new ExtractionRequest(fixture.Input, fixture.Output));

        using var elements = JsonDocument.Parse(await File.ReadAllBytesAsync(Path.Combine(fixture.Output, "elements", "content.json")));
        Assert.DoesNotContain(elements.RootElement.EnumerateArray(), value =>
            value.GetProperty("elementId").GetString() == "tessera.civ6:object.feature.feature-forest");
    }

    [Fact]
    public async Task 缺少中文时保留正式本地化Key而不臆造译名()
    {
        using var fixture = new SyntheticGameFixture();
        fixture.ReplaceFile(
            "DLC/Expansion2/Text/Expansion2_Translations_Text.xml",
            "<GameData><LocalizedText /></GameData>");

        await Service().ExtractAsync(new ExtractionRequest(fixture.Input, fixture.Output));

        using var locale = JsonDocument.Parse(await File.ReadAllBytesAsync(Path.Combine(fixture.Output, "locales", "zh-CN.json")));
        Assert.Equal(
            "LOC_FEATURE_VOLCANO_NAME",
            locale.RootElement.GetProperty("element.feature.feature-volcano.name").GetString());
    }

    [Fact]
    public async Task SourceManifest覆盖实际读取文件且无路径和哈希泄漏()
    {
        using var fixture = new SyntheticGameFixture();
        await Service().ExtractAsync(new ExtractionRequest(fixture.Input, fixture.Output));

        var provenanceText = await File.ReadAllTextAsync(Path.Combine(fixture.Output, "provenance", "source-manifest.json"));
        Assert.DoesNotContain(fixture.Root, provenanceText, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("hash", provenanceText, StringComparison.OrdinalIgnoreCase);
        using var provenance = JsonDocument.Parse(provenanceText);
        Assert.Equal(34, provenance.RootElement.GetProperty("files").GetArrayLength());
        Assert.Contains(provenance.RootElement.GetProperty("files").EnumerateArray(), value =>
            value.GetProperty("relativePath").GetString() == "DLC/Expansion2/Text/Expansion2_Translations_Text.xml");
        Assert.Contains(provenance.RootElement.GetProperty("files").EnumerateArray(), value =>
            value.GetProperty("relativePath").GetString() ==
            "DLC/Expansion2/Platforms/Windows/BLPs/strategicview/strategicview_routes.blp");
        Assert.All(provenance.RootElement.GetProperty("files").EnumerateArray(), file =>
        {
            var relativePath = file.GetProperty("relativePath").GetString();
            Assert.NotNull(relativePath);
            Assert.DoesNotContain('\\', relativePath!);
            Assert.False(Path.IsPathFullyQualified(relativePath));
        });
    }

    [Theory]
    [InlineData("<GameInfo><!DOCTYPE x [<!ENTITY e SYSTEM 'file:///C:/secret'>]><Terrains /></GameInfo>", "input-xml-invalid")]
    [InlineData("<GameInfo><Types /></GameInfo>", "input-content-table-missing")]
    [InlineData("<GameInfo><Terrains><Upsert TerrainType='TERRAIN_X'/></Terrains></GameInfo>", "input-content-operation-unsupported")]
    public async Task 非法正式规则稳定拒绝且不产生输出(string xml, string expectedCode)
    {
        using var fixture = new SyntheticGameFixture();
        fixture.ReplaceFile("Base/Assets/Gameplay/Data/Terrains.xml", xml);

        var error = await Assert.ThrowsAsync<ExtractionException>(() =>
            Service().ExtractAsync(new ExtractionRequest(fixture.Input, fixture.Output)));

        Assert.Equal(expectedCode, error.Code);
        Assert.False(Directory.Exists(fixture.Output));
    }

    [Fact]
    public async Task 重复实体必须用Update而不能静默覆盖()
    {
        using var fixture = new SyntheticGameFixture();
        fixture.ReplaceFile("DLC/Expansion2/Data/Expansion2_Resources.xml", """
            <GameInfo><Resources><Row ResourceType="RESOURCE_WHEAT" Name="LOC_DUPLICATE"/></Resources></GameInfo>
            """);

        var error = await Assert.ThrowsAsync<ExtractionException>(() =>
            Service().ExtractAsync(new ExtractionRequest(fixture.Input, fixture.Output)));
        Assert.Equal("input-content-duplicate-id", error.Code);
    }

    [Fact]
    public async Task 实体必须引用Types中已知类型()
    {
        using var fixture = new SyntheticGameFixture();
        fixture.ReplaceFile("DLC/Expansion2/Data/Expansion2_Routes.xml", """
            <GameInfo><Routes><Row RouteType="ROUTE_UNKNOWN" Name="LOC_ROUTE_UNKNOWN_NAME"/></Routes></GameInfo>
            """);

        var error = await Assert.ThrowsAsync<ExtractionException>(() =>
            Service().ExtractAsync(new ExtractionRequest(fixture.Input, fixture.Output)));
        Assert.Equal("input-content-type-reference-missing", error.Code);
    }

    [Fact]
    public async Task Update未知目标被稳定拒绝()
    {
        using var fixture = new SyntheticGameFixture();
        fixture.ReplaceFile("DLC/Expansion2/Data/Expansion2_Resources.xml", """
            <GameInfo><Types><Row Type="RESOURCE_UNKNOWN"/></Types><Resources><Update><Where ResourceType="RESOURCE_UNKNOWN"/><Set Name="LOC_UNKNOWN"/></Update></Resources></GameInfo>
            """);

        var error = await Assert.ThrowsAsync<ExtractionException>(() =>
            Service().ExtractAsync(new ExtractionRequest(fixture.Input, fixture.Output)));
        Assert.Equal("input-content-update-target-missing", error.Code);
    }

    [Fact]
    public async Task Staging校验失败时旧输出保持不变且无临时目录()
    {
        using var fixture = new SyntheticGameFixture();
        Directory.CreateDirectory(fixture.Output);
        var marker = Path.Combine(fixture.Output, "keep.txt");
        await File.WriteAllTextAsync(marker, "旧输出");
        var service = new Civ6ExtractionService(
            new FixedTimeProvider(FixedNow),
            new RejectingOutputValidator(),
            new Civ6InstallationProbe(new FixedVersionReader("1.0.12.68")));

        var error = await Assert.ThrowsAsync<ExtractionException>(() =>
            service.ExtractAsync(new ExtractionRequest(fixture.Input, fixture.Output)));

        Assert.Equal("test-validation-failed", error.Code);
        Assert.Equal("旧输出", await File.ReadAllTextAsync(marker));
        Assert.Empty(Directory.EnumerateDirectories(Path.GetDirectoryName(fixture.Output)!, ".tessera.civ6.staging-*"));
    }

    [Fact]
    public async Task 相同输入与时钟生成逐字节一致结果()
    {
        using var fixture = new SyntheticGameFixture();
        var secondOutput = Path.Combine(fixture.Root, "generated-second", "tessera.civ6");
        var service = Service();

        await service.ExtractAsync(new ExtractionRequest(fixture.Input, fixture.Output));
        await service.ExtractAsync(new ExtractionRequest(fixture.Input, secondOutput));

        var first = SnapshotOutput(fixture.Output);
        var second = SnapshotOutput(secondOutput);
        Assert.Equal(first.Keys, second.Keys);
        Assert.All(first, pair => Assert.Equal(pair.Value, second[pair.Key]));
    }

    [Fact]
    public async Task 输入输出目录重叠被拒绝()
    {
        using var fixture = new SyntheticGameFixture();
        var error = await Assert.ThrowsAsync<ExtractionException>(() =>
            Service().ExtractAsync(new ExtractionRequest(fixture.Input, Path.Combine(fixture.Input, "generated"))));
        Assert.Equal("input-output-overlap", error.Code);
    }

    [Fact]
    public async Task 非法版本在发布前拒绝()
    {
        using var fixture = new SyntheticGameFixture();
        var error = await Assert.ThrowsAsync<ExtractionException>(() =>
            Service().ExtractAsync(new ExtractionRequest(fixture.Input, fixture.Output, "latest")));
        Assert.Equal("version-invalid", error.Code);
        Assert.False(Directory.Exists(fixture.Output));
    }

    [Fact]
    public async Task 已取消扫描不创建输出()
    {
        using var fixture = new SyntheticGameFixture();
        using var cancellation = new CancellationTokenSource();
        cancellation.Cancel();
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() =>
            Service().ExtractAsync(new ExtractionRequest(fixture.Input, fixture.Output), cancellation.Token));
        Assert.False(Directory.Exists(fixture.Output));
    }

    private static Civ6ExtractionService Service() => new(
        new FixedTimeProvider(FixedNow),
        installationProbe: new Civ6InstallationProbe(new FixedVersionReader("1.0.12.68")));

    private static SortedDictionary<string, byte[]> SnapshotOutput(string root) =>
        new(Directory.EnumerateFiles(root, "*", SearchOption.AllDirectories).ToDictionary(
            path => Path.GetRelativePath(root, path).Replace('\\', '/'),
            File.ReadAllBytes,
            StringComparer.Ordinal), StringComparer.Ordinal);
}
