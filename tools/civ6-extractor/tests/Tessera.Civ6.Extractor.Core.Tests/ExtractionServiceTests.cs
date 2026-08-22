using System.Text.Json;

namespace Tessera.Civ6.Extractor.Core.Tests;

public sealed class ExtractionServiceTests
{
    private static readonly DateTimeOffset FixedNow = new(2026, 8, 22, 8, 0, 0, TimeSpan.Zero);

    [Fact]
    public async Task 合成输入生成严格本地模块且不修改输入()
    {
        using var fixture = new SyntheticGameFixture();
        var before = fixture.SnapshotInput();
        var service = new Civ6ExtractionService(new FixedTimeProvider(FixedNow));

        var result = await service.ExtractAsync(new ExtractionRequest(fixture.Input, fixture.Output));

        Assert.Equal("tessera.civ6", result.ModuleId);
        Assert.Equal(1, result.ElementCount);
        Assert.Equal(before, fixture.SnapshotInput());
        Assert.True(File.Exists(Path.Combine(fixture.Output, "assets", "base", "assets", "ui", "icons", "city-center.png")));
        Assert.DoesNotContain(
            Directory.EnumerateFiles(fixture.Output, "*", SearchOption.AllDirectories),
            path => Path.GetExtension(path) is ".xml" or ".artdef");

        using var module = JsonDocument.Parse(await File.ReadAllBytesAsync(Path.Combine(fixture.Output, "module.json")));
        var root = module.RootElement;
        Assert.Equal("generated-local", root.GetProperty("packageSource").GetProperty("kind").GetString());
        Assert.Equal("hex-pointy", Assert.Single(root.GetProperty("supportedGrids").EnumerateArray()).GetString());
        Assert.Equal("provenance/source-manifest.json", root.GetProperty("packageSource").GetProperty("sourceManifestPath").GetString());
        Assert.Equal("2026-08-22T08:00:00.0000000+00:00", root.GetProperty("packageSource").GetProperty("generatedAt").GetString());
        Assert.Equal(9, root.GetProperty("layers").GetArrayLength());
        Assert.Equal(
            [
                "tessera.civ6.cell.terrain",
                "tessera.civ6.cell.feature",
                "tessera.civ6.cell.resource",
                "tessera.civ6.edge.river",
                "tessera.civ6.edge.cliff",
                "tessera.civ6.cell.route",
                "tessera.civ6.cell.occupation",
                "tessera.civ6.plan.validation",
                "tessera.civ6.annotation.yield",
            ],
            root.GetProperty("layers").EnumerateArray()
                .Select(layer => layer.GetProperty("layerId").GetString()!)
                .ToArray());
        var routeLayer = root.GetProperty("layers").EnumerateArray()
            .Single(layer => layer.GetProperty("layerId").GetString() == "tessera.civ6.cell.route");
        Assert.Equal("cell-style", Assert.Single(routeLayer.GetProperty("allowedPrimitives").EnumerateArray()).GetString());
        Assert.Equal("cell", Assert.Single(routeLayer.GetProperty("allowedAnchors").EnumerateArray()).GetString());
        Assert.All(root.GetProperty("resources").EnumerateArray(), resource =>
            Assert.Equal("local-only", resource.GetProperty("license").GetProperty("status").GetString()));

        var provenanceText = await File.ReadAllTextAsync(Path.Combine(fixture.Output, "provenance", "source-manifest.json"));
        Assert.DoesNotContain(fixture.Root, provenanceText, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("hash", provenanceText, StringComparison.OrdinalIgnoreCase);
        using var provenance = JsonDocument.Parse(provenanceText);
        Assert.All(provenance.RootElement.GetProperty("files").EnumerateArray(), file =>
        {
            var relativePath = file.GetProperty("relativePath").GetString();
            Assert.NotNull(relativePath);
            Assert.DoesNotContain('\\', relativePath!);
            Assert.False(Path.IsPathFullyQualified(relativePath));
        });
    }

    [Fact]
    public async Task Staging校验失败时旧输出保持不变且无临时目录()
    {
        using var fixture = new SyntheticGameFixture();
        Directory.CreateDirectory(fixture.Output);
        var marker = Path.Combine(fixture.Output, "keep.txt");
        await File.WriteAllTextAsync(marker, "旧输出");
        var service = new Civ6ExtractionService(new FixedTimeProvider(FixedNow), new RejectingOutputValidator());

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
        var service = new Civ6ExtractionService(new FixedTimeProvider(FixedNow));

        await service.ExtractAsync(new ExtractionRequest(fixture.Input, fixture.Output));
        await service.ExtractAsync(new ExtractionRequest(fixture.Input, secondOutput));

        var first = SnapshotOutput(fixture.Output);
        var second = SnapshotOutput(secondOutput);
        Assert.Equal(first.Keys, second.Keys);
        Assert.All(first, pair => Assert.Equal(pair.Value, second[pair.Key]));
    }

    [Fact]
    public async Task 成功发布会完整替换旧输出而不混入旧文件()
    {
        using var fixture = new SyntheticGameFixture();
        Directory.CreateDirectory(fixture.Output);
        await File.WriteAllTextAsync(Path.Combine(fixture.Output, "obsolete.txt"), "旧文件");

        await new Civ6ExtractionService(new FixedTimeProvider(FixedNow))
            .ExtractAsync(new ExtractionRequest(fixture.Input, fixture.Output));

        Assert.False(File.Exists(Path.Combine(fixture.Output, "obsolete.txt")));
        Assert.True(File.Exists(Path.Combine(fixture.Output, "module.json")));
    }

    [Fact]
    public async Task 不同目录的同名图片不会在输出中互相覆盖()
    {
        using var fixture = new SyntheticGameFixture();
        fixture.ReplaceRules("""
            <GameData sourceBuild="1.0.12.68" rulesetId="civ6-standard-gs-v1" artDefVersion="1" dlcIds="Expansion1;Expansion2">
              <Objects>
                <Object id="DISTRICT_CITY_CENTER" category="city" name="市中心" description="城市中心" artDef="DISTRICT_CITY_CENTER" />
                <Object id="DISTRICT_HARBOR" category="city" name="港口" description="港口区域" artDef="DISTRICT_HARBOR" />
              </Objects>
            </GameData>
            """);
        fixture.ReplaceArtDef("""
            <AssetObjects>
              <Asset id="DISTRICT_CITY_CENTER" imagePath="Base/Assets/UI/Icons/shared.png" />
              <Asset id="DISTRICT_HARBOR" imagePath="DLC/Expansion1/UI/Icons/shared.png" />
            </AssetObjects>
            """);
        fixture.AddImage("Base/Assets/UI/Icons/shared.png");
        fixture.AddImage("DLC/Expansion1/UI/Icons/shared.png");

        await new Civ6ExtractionService(new FixedTimeProvider(FixedNow))
            .ExtractAsync(new ExtractionRequest(fixture.Input, fixture.Output));

        var pngPaths = Directory.EnumerateFiles(Path.Combine(fixture.Output, "assets"), "*.png", SearchOption.AllDirectories)
            .Select(path => Path.GetRelativePath(fixture.Output, path).Replace('\\', '/'))
            .Order(StringComparer.Ordinal)
            .ToArray();
        Assert.Equal(2, pngPaths.Length);
        Assert.Equal("assets/base/assets/ui/icons/shared.png", pngPaths[0]);
        Assert.Equal("assets/dlc/expansion1/ui/icons/shared.png", pngPaths[1]);
    }

    [Theory]
    [InlineData("<GameData><!DOCTYPE x [<!ENTITY e SYSTEM 'file:///C:/secret'>]><Objects /></GameData>", "input-xml-invalid")]
    [InlineData("<GameData />", "input-rules-invalid")]
    public async Task 非法规则输入被稳定拒绝且不产生输出(string xml, string expectedCode)
    {
        using var fixture = new SyntheticGameFixture();
        fixture.ReplaceRules(xml);

        var error = await Assert.ThrowsAsync<ExtractionException>(() =>
            new Civ6ExtractionService().ExtractAsync(new ExtractionRequest(fixture.Input, fixture.Output)));

        Assert.Equal(expectedCode, error.Code);
        Assert.False(Directory.Exists(fixture.Output));
    }

    [Fact]
    public async Task ArtDef绝对路径被拒绝()
    {
        using var fixture = new SyntheticGameFixture();
        fixture.ReplaceArtDef("<AssetObjects><Asset id=\"DISTRICT_CITY_CENTER\" imagePath=\"C:/secret.png\" /></AssetObjects>");

        var error = await Assert.ThrowsAsync<ExtractionException>(() =>
            new Civ6ExtractionService().ExtractAsync(new ExtractionRequest(fixture.Input, fixture.Output)));

        Assert.Equal("input-artdef-path-invalid", error.Code);
        Assert.False(Directory.Exists(fixture.Output));
    }

    [Fact]
    public async Task 缺少引用图片被拒绝且不产生半包()
    {
        using var fixture = new SyntheticGameFixture();
        fixture.DeleteImage();

        var error = await Assert.ThrowsAsync<ExtractionException>(() =>
            new Civ6ExtractionService().ExtractAsync(new ExtractionRequest(fixture.Input, fixture.Output)));

        Assert.Equal("input-file-missing", error.Code);
        Assert.False(Directory.Exists(fixture.Output));
    }

    [Fact]
    public async Task 缺少冻结Dlc基线时拒绝生成半成品模块()
    {
        using var fixture = new SyntheticGameFixture();
        fixture.ReplaceRules("""
            <GameData sourceBuild="1.0.12.68" rulesetId="civ6-standard-gs-v1" artDefVersion="1" dlcIds="Expansion1">
              <Objects>
                <Object id="DISTRICT_CITY_CENTER" category="city" name="市中心" description="城市中心" artDef="DISTRICT_CITY_CENTER" />
              </Objects>
            </GameData>
            """);

        var error = await Assert.ThrowsAsync<ExtractionException>(() =>
            new Civ6ExtractionService().ExtractAsync(new ExtractionRequest(fixture.Input, fixture.Output)));

        Assert.Equal("input-baseline-incomplete", error.Code);
        Assert.False(Directory.Exists(fixture.Output));
    }

    [Fact]
    public async Task 输入输出目录重叠被拒绝()
    {
        using var fixture = new SyntheticGameFixture();
        var output = Path.Combine(fixture.Input, "generated");

        var error = await Assert.ThrowsAsync<ExtractionException>(() =>
            new Civ6ExtractionService().ExtractAsync(new ExtractionRequest(fixture.Input, output)));

        Assert.Equal("input-output-overlap", error.Code);
    }

    [Fact]
    public async Task 输出目录必须显式提供()
    {
        using var fixture = new SyntheticGameFixture();

        var error = await Assert.ThrowsAsync<ExtractionException>(() =>
            new Civ6ExtractionService().ExtractAsync(new ExtractionRequest(fixture.Input, "")));

        Assert.Equal("output-directory-required", error.Code);
    }

    [Fact]
    public async Task 非法版本在发布前拒绝()
    {
        using var fixture = new SyntheticGameFixture();

        var error = await Assert.ThrowsAsync<ExtractionException>(() =>
            new Civ6ExtractionService().ExtractAsync(new ExtractionRequest(fixture.Input, fixture.Output, "latest")));

        Assert.Equal("version-invalid", error.Code);
        Assert.False(Directory.Exists(fixture.Output));
    }

    private static SortedDictionary<string, byte[]> SnapshotOutput(string root) =>
        new(Directory.EnumerateFiles(root, "*", SearchOption.AllDirectories).ToDictionary(
            path => Path.GetRelativePath(root, path).Replace('\\', '/'),
            File.ReadAllBytes,
            StringComparer.Ordinal), StringComparer.Ordinal);
}
