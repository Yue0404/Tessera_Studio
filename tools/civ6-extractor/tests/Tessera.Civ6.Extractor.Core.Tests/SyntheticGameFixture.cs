using System.Security.Cryptography;
using System.Text;

namespace Tessera.Civ6.Extractor.Core.Tests;

internal sealed class SyntheticGameFixture : IDisposable
{
    private const string RulesRelative = "Base/Assets/Gameplay/Data/Districts.xml";
    private const string ArtDefRelative = "Base/ArtDefs/Districts.artdef";
    private const string ImageRelative = "Base/Assets/UI/Icons/city-center.png";
    private static readonly byte[] TinyPng = Convert.FromBase64String(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=");

    public SyntheticGameFixture(string storefront = "steam")
    {
        Root = Path.Combine(Path.GetTempPath(), "tessera-civ6-extractor-tests", Guid.NewGuid().ToString("N"));
        Input = Path.Combine(Root, "CivilizationVI");
        Output = Path.Combine(Root, "generated", "tessera.civ6");
        WriteInstallationBaseline(storefront);
        WriteText(RulesRelative, """
            <?xml version="1.0" encoding="utf-8"?>
            <GameData sourceBuild="1.0.12.68" rulesetId="civ6-standard-gs-v1" artDefVersion="1" dlcIds="Expansion2;Expansion1">
              <Objects>
                <Object id="DISTRICT_CITY_CENTER" category="city" name="市中心" description="文明 6 城市的中心区域。" artDef="DISTRICT_CITY_CENTER" />
              </Objects>
            </GameData>
            """);
        WriteText(ArtDefRelative, """
            <?xml version="1.0" encoding="utf-8"?>
            <AssetObjects>
              <Asset id="DISTRICT_CITY_CENTER" imagePath="Base/Assets/UI/Icons/city-center.png" />
            </AssetObjects>
            """);
        WriteBytes(ImageRelative, TinyPng);
    }

    public string Root { get; }

    public string Input { get; }

    public string Output { get; }

    public void ReplaceRules(string xml) => WriteText(RulesRelative, xml);

    public void ReplaceArtDef(string xml) => WriteText(ArtDefRelative, xml);

    public void DeleteImage() => File.Delete(Path.Combine(Input, ImageRelative.Replace('/', Path.DirectorySeparatorChar)));

    public void AddImage(string relativePath) => WriteBytes(relativePath, TinyPng);

    public void DeleteExpansion(string expansion)
    {
        var path = Path.Combine(Input, "DLC", expansion);
        if (Directory.Exists(path))
        {
            Directory.Delete(path, recursive: true);
        }
    }

    public void AddModPollution() => WriteText("Mods/Untrusted/Gameplay/Data/Districts.xml", "<malicious />");

    public IReadOnlyDictionary<string, string> SnapshotInput()
    {
        return Directory.EnumerateFiles(Input, "*", SearchOption.AllDirectories)
            .ToDictionary(
                path => Path.GetRelativePath(Input, path).Replace('\\', '/'),
                path => Convert.ToHexString(SHA256.HashData(File.ReadAllBytes(path))),
                StringComparer.Ordinal);
    }

    public void Dispose()
    {
        if (Directory.Exists(Root))
        {
            Directory.Delete(Root, recursive: true);
        }
    }

    private void WriteText(string relativePath, string content) =>
        WriteBytes(relativePath, Encoding.UTF8.GetBytes(content));

    private void WriteInstallationBaseline(string storefront)
    {
        WriteText(
            "Base/Civ6.dep",
            "<AssetObjects..GameDependencyData><ID><name text=\"Civ6\"/><id text=\"cb2f71b7-843e-4af3-9ca7-992acda9c195\"/></ID></AssetObjects..GameDependencyData>");
        WriteText("DLC/Expansion1/Expansion1.dep", "<AssetObjects..GameDependencyData />");
        WriteText("DLC/Expansion2/Expansion2.dep", "<AssetObjects..GameDependencyData />");
        WriteText(
            "DLC/Expansion1/Expansion1.modinfo",
            "<Mod id=\"1B28771A-C749-434B-9053-D1380C553DE9\" version=\"1\" />");
        WriteText(
            "DLC/Expansion2/Expansion2.modinfo",
            "<Mod id=\"4873eb62-8ccc-4574-b784-dda455e74e68\" version=\"1\" />");
        WriteText("DLC/Expansion1/Data/Expansion1_Districts.xml", "<GameInfo />");
        WriteText("DLC/Expansion1/ArtDefs/Districts.artdef", "<AssetObjects..ArtDefSet />");
        WriteText("DLC/Expansion2/Data/Expansion2_Districts.xml", "<GameInfo />");
        WriteText("DLC/Expansion2/ArtDefs/Districts.artdef", "<AssetObjects..ArtDefSet />");

        var binaryDirectory = storefront switch
        {
            "steam" => "Win64Steam",
            "epic" => "Win64EOS",
            "microsoft-store" => "Win64Microsoft",
            _ => throw new ArgumentOutOfRangeException(nameof(storefront)),
        };
        var executable = Environment.ProcessPath
            ?? throw new InvalidOperationException("测试进程没有可复制的合成可执行文件。");
        WriteBytes($"Base/Binaries/{binaryDirectory}/CivilizationVI.exe", File.ReadAllBytes(executable));
    }

    private void WriteBytes(string relativePath, byte[] bytes)
    {
        var path = Path.Combine(Input, relativePath.Replace('/', Path.DirectorySeparatorChar));
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        File.WriteAllBytes(path, bytes);
    }
}

internal sealed class FixedVersionReader(string? version) : ICiv6InstallationVersionReader
{
    public ValueTask<string?> ReadVersionAsync(string executablePath, CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        return ValueTask.FromResult(version);
    }
}

internal sealed class FixedTimeProvider(DateTimeOffset value) : TimeProvider
{
    public override DateTimeOffset GetUtcNow() => value;
}

internal sealed class RejectingOutputValidator : IPackageOutputValidator
{
    public Task ValidateAsync(string packageDirectory, CancellationToken cancellationToken) =>
        throw new ExtractionException("test-validation-failed", "测试要求拒绝 staging。", packageDirectory);
}
