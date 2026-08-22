using Microsoft.Win32;
using System.Security;
using Tessera.Civ6.Extractor.Core;

namespace Tessera.Civ6.Extractor.Gui;

/// <summary>仅查询 Windows 已知注册表项和固定安装位置，不遍历磁盘。</summary>
public sealed class WindowsCiv6InstallationLocator : ICiv6InstallationLocator
{
    private readonly Func<IReadOnlyList<string>> candidateProvider;

    public WindowsCiv6InstallationLocator(Func<IReadOnlyList<string>>? candidateProvider = null)
    {
        this.candidateProvider = candidateProvider ?? DiscoverKnownCandidates;
    }

    public Task<IReadOnlyList<string>> FindCandidatesAsync(CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        var candidates = candidateProvider()
            .Where(value => !string.IsNullOrWhiteSpace(value))
            .Select(value => Path.TrimEndingDirectorySeparator(Path.GetFullPath(value)))
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToArray();
        return Task.FromResult<IReadOnlyList<string>>(candidates);
    }

    private static List<string> DiscoverKnownCandidates()
    {
        var candidates = new List<string>();
        AddRegistryValue(candidates,
            @"HKEY_LOCAL_MACHINE\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\Steam App 289070",
            "InstallLocation");
        AddRegistryValue(candidates,
            @"HKEY_LOCAL_MACHINE\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\Steam App 289070",
            "InstallLocation");

        var programFilesX86 = Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86);
        if (!string.IsNullOrWhiteSpace(programFilesX86))
        {
            candidates.Add(Path.Combine(
                programFilesX86,
                "Steam",
                "steamapps",
                "common",
                "Sid Meier's Civilization VI"));
        }

        var programFiles = Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles);
        if (!string.IsNullOrWhiteSpace(programFiles))
        {
            candidates.Add(Path.Combine(
                programFiles,
                "Epic Games",
                "SidMeiersCivilizationVI"));
        }

        return candidates;
    }

    private static void AddRegistryValue(List<string> candidates, string key, string name)
    {
        try
        {
            if (Registry.GetValue(key, name, null) is string value && !string.IsNullOrWhiteSpace(value))
            {
                candidates.Add(value);
            }
        }
        catch (Exception error) when (error is SecurityException or UnauthorizedAccessException or IOException)
        {
            // 注册表不可读时保留手动选择入口，不扩大探测范围。
        }
    }
}
