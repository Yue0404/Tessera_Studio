using System.Reflection;
using System.Xml.Linq;
using Tessera.Civ6.Extractor.Core;

namespace Tessera.Civ6.Extractor.Gui.Tests;

public sealed class ReleaseConfigurationTests
{
    [Fact]
    public void 程序集与集中常量使用首个预览版且模块版本保持一()
    {
        var assembly = typeof(MainForm).Assembly;
        var information = assembly.GetCustomAttribute<AssemblyInformationalVersionAttribute>();

        Assert.Equal("0.1.0-preview.1", ExtractorVersions.Tool);
        Assert.Equal("1.0.0", ExtractorVersions.OutputModule);
        Assert.Equal(new Version(0, 1, 0, 0), assembly.GetName().Version);
        Assert.Equal(ExtractorVersions.Tool, information?.InformationalVersion);
    }

    [Fact]
    public void Windows发布配置为自包含非单文件非裁剪且不产生调试符号()
    {
        var profile = XDocument.Load(Path.Combine(
            ToolRoot(),
            "src",
            "Tessera.Civ6.Extractor.Gui",
            "Properties",
            "PublishProfiles",
            "WindowsX64.pubxml"));
        var values = profile.Descendants()
            .Where(value => !value.HasElements)
            .ToDictionary(value => value.Name.LocalName, value => value.Value, StringComparer.Ordinal);

        Assert.Equal("win-x64", values["RuntimeIdentifier"]);
        Assert.Equal("true", values["SelfContained"]);
        Assert.Equal("false", values["PublishSingleFile"]);
        Assert.Equal("false", values["PublishTrimmed"]);
        Assert.Equal("None", values["DebugType"]);
        Assert.Equal("false", values["DebugSymbols"]);
    }

    [Fact]
    public void WindowsManifest声明AsInvoker与Windows10兼容标识()
    {
        var manifestPath = Path.Combine(
            ToolRoot(),
            "src",
            "Tessera.Civ6.Extractor.Gui",
            "app.manifest");
        var manifest = XDocument.Load(manifestPath);
        var requested = Assert.Single(
            manifest.Descendants(),
            value => value.Name.LocalName == "requestedExecutionLevel");
        var supported = Assert.Single(
            manifest.Descendants(),
            value => value.Name.LocalName == "supportedOS");

        Assert.Equal("asInvoker", requested.Attribute("level")?.Value);
        Assert.Equal("false", requested.Attribute("uiAccess")?.Value);
        Assert.Equal("{8e0f7a12-bfb3-4fe8-b9a5-48fd50a15a9a}", supported.Attribute("Id")?.Value);
    }

    [Fact]
    public void 发布说明准确声明纯托管解码和许可证边界()
    {
        var notice = File.ReadAllText(Path.Combine(ToolRoot(), "release", "SOURCE-AND-LICENSE.txt"));

        Assert.Contains("fully managed", notice, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("does not bundle SkiaSharp", notice, StringComparison.OrdinalIgnoreCase);
        Assert.Contains(
            "official, unmodified PolyForm Noncommercial License 1.0.0",
            notice,
            StringComparison.Ordinal);
        Assert.Contains(
            "Required Notice: Copyright 2026 Yue0404",
            notice,
            StringComparison.Ordinal);
        Assert.Contains(
            "covers only Tessera Studio-owned code and assets",
            notice,
            StringComparison.Ordinal);
        Assert.Contains(
            "game assets and locally generated or imported tessera.civ6 modules are not covered or relicensed",
            notice,
            StringComparison.Ordinal);
        Assert.DoesNotContain(
            "did not contain a repository-level LICENSE",
            notice,
            StringComparison.OrdinalIgnoreCase);
        Assert.Contains("DOTNET-THIRD-PARTY-NOTICES.txt", notice, StringComparison.Ordinal);
    }

    private static string ToolRoot()
    {
        var directory = new DirectoryInfo(AppContext.BaseDirectory);
        while (directory is not null)
        {
            var candidate = Path.Combine(directory.FullName, "TesseraCiv6Extractor.slnx");
            if (File.Exists(candidate)) return directory.FullName;
            directory = directory.Parent;
        }
        throw new InvalidOperationException("无法定位提取器源码根目录。");
    }
}
