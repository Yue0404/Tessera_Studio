using System.Diagnostics;
using System.Globalization;
using System.Text.RegularExpressions;

namespace Tessera.Civ6.Extractor.Core;

/// <summary>读取白名单可执行文件的产品版本；测试可注入确定性实现。</summary>
public interface ICiv6InstallationVersionReader
{
    ValueTask<string?> ReadVersionAsync(string executablePath, CancellationToken cancellationToken);
}

public sealed record Civ6InstallationFile(string RelativePath, string SourceGroup, string Role, long Bytes);

public sealed record Civ6InstallationDiagnostic(
    string Code,
    string Severity,
    string Message,
    string? RelativePath = null);

public sealed record Civ6InstallationInspection(
    string Storefront,
    string GameVersion,
    string VersionStatus,
    IReadOnlyList<Civ6InstallationFile> Files,
    IReadOnlyList<Civ6InstallationDiagnostic> Diagnostics);

/// <summary>只检查用户明确选择的正式游戏根目录，不发现或遍历其他安装位置。</summary>
public sealed partial class Civ6InstallationProbe
{
    private const string Expansion1Id = "1B28771A-C749-434B-9053-D1380C553DE9";
    private const string Expansion2Id = "4873eb62-8ccc-4574-b784-dda455e74e68";
    private const string BaseDependencyId = "cb2f71b7-843e-4af3-9ca7-992acda9c195";
    private static readonly HashSet<string> SupportedVersions = new(StringComparer.Ordinal) { "1.0.12.68" };
    private static readonly InstallationFileRule[] RequiredFiles =
    [
        new("Base/ArtDefs/Districts.artdef", "Base", "artdef"),
        new("Base/Assets/Gameplay/Data/Districts.xml", "Base", "rules"),
        new("Base/Civ6.dep", "Base", "dependency-manifest"),
        new("DLC/Expansion1/ArtDefs/Districts.artdef", "Expansion1", "artdef"),
        new("DLC/Expansion1/Data/Expansion1_Districts.xml", "Expansion1", "rules"),
        new("DLC/Expansion1/Expansion1.dep", "Expansion1", "dependency-manifest"),
        new("DLC/Expansion1/Expansion1.modinfo", "Expansion1", "package-manifest"),
        new("DLC/Expansion2/ArtDefs/Districts.artdef", "Expansion2", "artdef"),
        new("DLC/Expansion2/Data/Expansion2_Districts.xml", "Expansion2", "rules"),
        new("DLC/Expansion2/Expansion2.dep", "Expansion2", "dependency-manifest"),
        new("DLC/Expansion2/Expansion2.modinfo", "Expansion2", "package-manifest"),
    ];
    private static readonly ExecutableCandidate[] ExecutableCandidates =
    [
        new("Base/Binaries/Win64Steam/CivilizationVI.exe", "steam"),
        new("Base/Binaries/Win64EOS/CivilizationVI.exe", "epic"),
        new("Base/Binaries/Win64Epic/CivilizationVI.exe", "epic"),
        new("Base/Binaries/Win64Microsoft/CivilizationVI.exe", "microsoft-store"),
        new("Base/Binaries/Win64UWP/CivilizationVI.exe", "microsoft-store"),
        new("Base/Binaries/Win64/CivilizationVI.exe", "unknown-store"),
    ];

    private readonly ICiv6InstallationVersionReader versionReader;

    public Civ6InstallationProbe(ICiv6InstallationVersionReader? versionReader = null)
    {
        this.versionReader = versionReader ?? new FileVersionReader();
    }

    public async Task<Civ6InstallationInspection> InspectAsync(
        string inputDirectory,
        CancellationToken cancellationToken = default)
    {
        var input = SafeInputRoot.Open(inputDirectory);
        var files = new List<Civ6InstallationFile>(RequiredFiles.Length);
        foreach (var rule in RequiredFiles)
        {
            cancellationToken.ThrowIfCancellationRequested();
            string fullPath;
            try
            {
                fullPath = input.ResolveExistingFile(rule.RelativePath);
            }
            catch (ExtractionException error) when (error.Code == "input-file-missing")
            {
                var code = rule.SourceGroup == "Base" ? "game-base-required" : "game-expansion-required";
                throw new ExtractionException(
                    code,
                    rule.SourceGroup == "Base"
                        ? "所选目录缺少文明 6 Base 正式游戏基线。"
                        : $"所选目录缺少文明 6 {rule.SourceGroup} 正式扩展基线。",
                    rule.RelativePath,
                    error);
            }

            files.Add(new(rule.RelativePath, rule.SourceGroup, rule.Role, new FileInfo(fullPath).Length));
        }

        await ValidateBaseDependencyAsync(input, cancellationToken);
        await ValidateExpansionManifestAsync(input, "DLC/Expansion1/Expansion1.modinfo", Expansion1Id, cancellationToken);
        await ValidateExpansionManifestAsync(input, "DLC/Expansion2/Expansion2.modinfo", Expansion2Id, cancellationToken);

        var (storefront, version, versionPath, versionBytes) = await ReadVersionAsync(input, cancellationToken);
        files.Add(new(versionPath, "Base", "version-source", versionBytes));
        var diagnostics = new List<Civ6InstallationDiagnostic>();
        var versionStatus = SupportedVersions.Contains(version) ? "supported" : "compatible-unknown";
        if (versionStatus == "compatible-unknown")
        {
            diagnostics.Add(new(
                "game-version-compatible-unknown",
                "warning",
                "游戏结构满足当前基线，但版本尚未列入已验证版本；提取器只使用既定白名单。"));
        }

        diagnostics.Add(new(
            "game-installation-compatible",
            "info",
            "已识别 Base、Rise and Fall 与 Gathering Storm 正式游戏基线。"));
        return new(
            storefront,
            version,
            versionStatus,
            files.OrderBy(value => value.RelativePath, StringComparer.Ordinal).ToArray(),
            diagnostics.OrderBy(value => value.Code, StringComparer.Ordinal).ToArray());
    }

    internal static void EnsureWhitelistedContentPath(string relativePath)
    {
        var normalized = relativePath.Replace('\\', '/');
        var allowed = normalized.StartsWith("Base/Assets/", StringComparison.OrdinalIgnoreCase) ||
            normalized.StartsWith("DLC/Expansion1/", StringComparison.OrdinalIgnoreCase) ||
            normalized.StartsWith("DLC/Expansion2/", StringComparison.OrdinalIgnoreCase);
        if (!allowed)
        {
            throw new ExtractionException(
                "input-path-not-whitelisted",
                "输入文件不属于 Base、Expansion1 或 Expansion2 正式游戏白名单。",
                relativePath);
        }
    }

    private async Task<(string Storefront, string Version, string RelativePath, long Bytes)> ReadVersionAsync(
        SafeInputRoot input,
        CancellationToken cancellationToken)
    {
        foreach (var candidate in ExecutableCandidates)
        {
            cancellationToken.ThrowIfCancellationRequested();
            if (!input.TryResolveExistingFile(candidate.RelativePath, out var executable))
            {
                continue;
            }

            var rawVersion = await versionReader.ReadVersionAsync(executable, cancellationToken);
            var version = NormalizeVersion(rawVersion);
            if (version is not null)
            {
                return (candidate.Storefront, version, candidate.RelativePath, new FileInfo(executable).Length);
            }
        }

        throw new ExtractionException(
            "game-version-unavailable",
            "未能从正式游戏白名单可执行文件读取版本。",
            "inputDirectory");
    }

    private static async Task ValidateExpansionManifestAsync(
        SafeInputRoot input,
        string relativePath,
        string expectedId,
        CancellationToken cancellationToken)
    {
        var bytes = await input.ReadAllBytesAsync(relativePath, cancellationToken);
        var root = SecureXml.Parse(bytes, relativePath).Root;
        var actualId = ((string?)root?.Attribute("id"))?.Trim();
        if (!string.Equals(actualId, expectedId, StringComparison.OrdinalIgnoreCase))
        {
            throw new ExtractionException(
                "game-expansion-identity-invalid",
                "扩展目录存在，但不是要求的文明 6 正式扩展。",
                relativePath);
        }
    }

    private static async Task ValidateBaseDependencyAsync(
        SafeInputRoot input,
        CancellationToken cancellationToken)
    {
        const string relativePath = "Base/Civ6.dep";
        var bytes = await input.ReadAllBytesAsync(relativePath, cancellationToken);
        var root = SecureXml.Parse(bytes, relativePath).Root;
        var name = ((string?)root?.Descendants("name").FirstOrDefault()?.Attribute("text"))?.Trim();
        var id = ((string?)root?.Descendants("id").FirstOrDefault()?.Attribute("text"))?.Trim();
        if (!string.Equals(name, "Civ6", StringComparison.Ordinal) ||
            !string.Equals(id, BaseDependencyId, StringComparison.OrdinalIgnoreCase))
        {
            throw new ExtractionException(
                "game-base-identity-invalid",
                "Base 目录不是要求的文明 6 正式游戏基线。",
                relativePath);
        }
    }

    private static string? NormalizeVersion(string? rawVersion)
    {
        if (string.IsNullOrWhiteSpace(rawVersion))
        {
            return null;
        }

        var numbers = VersionNumberPattern().Matches(rawVersion).Select(value => value.Value).Take(4).ToArray();
        return numbers.Length == 4 && numbers.All(value => int.TryParse(value, NumberStyles.None, CultureInfo.InvariantCulture, out _))
            ? string.Join('.', numbers.Select(value => int.Parse(value, CultureInfo.InvariantCulture).ToString(CultureInfo.InvariantCulture)))
            : null;
    }

    [GeneratedRegex("[0-9]+", RegexOptions.CultureInvariant)]
    private static partial Regex VersionNumberPattern();

    private sealed record InstallationFileRule(string RelativePath, string SourceGroup, string Role);

    private sealed record ExecutableCandidate(string RelativePath, string Storefront);

    private sealed class FileVersionReader : ICiv6InstallationVersionReader
    {
        public ValueTask<string?> ReadVersionAsync(string executablePath, CancellationToken cancellationToken)
        {
            cancellationToken.ThrowIfCancellationRequested();
            var info = FileVersionInfo.GetVersionInfo(executablePath);
            return ValueTask.FromResult(info.ProductVersion ?? info.FileVersion);
        }
    }
}
