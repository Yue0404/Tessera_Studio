namespace Tessera.Civ6.Extractor.Core.Tests;

public sealed class InstallationProbeTests
{
    [Theory]
    [InlineData("steam")]
    [InlineData("epic")]
    [InlineData("microsoft-store")]
    public async Task 三种商店等价正式布局使用同一白名单(string storefront)
    {
        using var fixture = new SyntheticGameFixture(storefront);
        fixture.AddModPollution();
        var inspection = await new Civ6InstallationProbe(new FixedVersionReader("1, 0, 12, 68, (1023995)"))
            .InspectAsync(fixture.Input);

        Assert.Equal(storefront, inspection.Storefront);
        Assert.Equal("1.0.12.68", inspection.GameVersion);
        Assert.Equal("supported", inspection.VersionStatus);
        Assert.Equal(12, inspection.Files.Count);
        Assert.Equal(
            inspection.Files.OrderBy(value => value.RelativePath, StringComparer.Ordinal),
            inspection.Files);
        Assert.DoesNotContain(inspection.Files, value => value.RelativePath.Contains("Mods", StringComparison.Ordinal));
        Assert.All(inspection.Files, value =>
        {
            Assert.False(Path.IsPathFullyQualified(value.RelativePath));
            Assert.DoesNotContain("hash", value.RelativePath, StringComparison.OrdinalIgnoreCase);
        });
    }

    [Fact]
    public async Task 缺少Expansion2时用稳定错误拒绝()
    {
        using var fixture = new SyntheticGameFixture();
        fixture.DeleteExpansion("Expansion2");

        var error = await Assert.ThrowsAsync<ExtractionException>(() =>
            new Civ6InstallationProbe(new FixedVersionReader("1.0.12.68")).InspectAsync(fixture.Input));

        Assert.Equal("game-expansion-required", error.Code);
        Assert.StartsWith("DLC/Expansion2/", error.FieldPath, StringComparison.Ordinal);
    }

    [Fact]
    public async Task 错误根目录不会被猜测为游戏安装()
    {
        var root = Path.Combine(Path.GetTempPath(), "tessera-civ6-wrong-root", Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(root);
        try
        {
            var error = await Assert.ThrowsAsync<ExtractionException>(() =>
                new Civ6InstallationProbe(new FixedVersionReader("1.0.12.68")).InspectAsync(root));
            Assert.Equal("game-base-required", error.Code);
        }
        finally
        {
            Directory.Delete(root, recursive: true);
        }
    }

    [Fact]
    public async Task 未知但结构兼容版本产生机器可读警告()
    {
        using var fixture = new SyntheticGameFixture();
        var inspection = await new Civ6InstallationProbe(new FixedVersionReader("1.0.13.7"))
            .InspectAsync(fixture.Input);

        Assert.Equal("compatible-unknown", inspection.VersionStatus);
        var warning = Assert.Single(inspection.Diagnostics, value => value.Severity == "warning");
        Assert.Equal("game-version-compatible-unknown", warning.Code);
    }

    [Fact]
    public async Task 检查结果不包含绝对路径或哈希字段()
    {
        using var fixture = new SyntheticGameFixture();
        var inspection = await new Civ6InstallationProbe(new FixedVersionReader("1.0.12.68"))
            .InspectAsync(fixture.Input);

        var json = System.Text.Json.JsonSerializer.Serialize(inspection);
        Assert.DoesNotContain(fixture.Root, json, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("hash", json, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task 取消在白名单扫描中可观察()
    {
        using var fixture = new SyntheticGameFixture();
        using var cancellation = new CancellationTokenSource();
        cancellation.Cancel();

        await Assert.ThrowsAnyAsync<OperationCanceledException>(() =>
            new Civ6InstallationProbe(new FixedVersionReader("1.0.12.68"))
                .InspectAsync(fixture.Input, cancellation.Token));
    }

    [Fact]
    public async Task 用户模组目录不能被当作正式游戏根目录()
    {
        var container = Path.Combine(Path.GetTempPath(), "tessera-civ6-mod-root", Guid.NewGuid().ToString("N"));
        var root = Path.Combine(container, "Mods", "game");
        Directory.CreateDirectory(root);
        try
        {
            var error = await Assert.ThrowsAsync<ExtractionException>(() =>
                new Civ6InstallationProbe(new FixedVersionReader("1.0.12.68")).InspectAsync(root));
            Assert.Equal("input-directory-forbidden", error.Code);
        }
        finally
        {
            Directory.Delete(container, recursive: true);
        }
    }
}
