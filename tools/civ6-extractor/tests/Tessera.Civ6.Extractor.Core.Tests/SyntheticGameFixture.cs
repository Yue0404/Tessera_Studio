using System.Security.Cryptography;
using System.Text;

namespace Tessera.Civ6.Extractor.Core.Tests;

internal sealed class SyntheticGameFixture : IDisposable
{
    private const string RulesRelative = "Base/Assets/Gameplay/Data/Districts.xml";
    private const string ArtDefRelative = "Base/Assets/ArtDefs/Districts.artdef";
    private const string ImageRelative = "Base/Assets/UI/Icons/city-center.png";
    private static readonly byte[] TinyPng = Convert.FromBase64String(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=");

    public SyntheticGameFixture()
    {
        Root = Path.Combine(Path.GetTempPath(), "tessera-civ6-extractor-tests", Guid.NewGuid().ToString("N"));
        Input = Path.Combine(Root, "CivilizationVI");
        Output = Path.Combine(Root, "generated", "tessera.civ6");
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

    private void WriteBytes(string relativePath, byte[] bytes)
    {
        var path = Path.Combine(Input, relativePath.Replace('/', Path.DirectorySeparatorChar));
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        File.WriteAllBytes(path, bytes);
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
