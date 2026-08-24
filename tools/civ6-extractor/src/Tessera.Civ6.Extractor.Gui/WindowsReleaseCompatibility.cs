namespace Tessera.Civ6.Extractor.Gui;

public sealed record WindowsCompatibilityResult(
    bool Supported,
    string? ErrorCode,
    int DetectedBuild);

/// <summary>发布入口的纯函数兼容性门禁；测试不需要伪造全局操作系统。</summary>
public static class WindowsReleaseCompatibility
{
    public const int MinimumBuild = 26100;

    public static WindowsCompatibilityResult Evaluate(bool isWindows, int build) =>
        !isWindows
            ? new(false, "extractor-windows-required", build)
            : build < MinimumBuild
                ? new(false, "extractor-windows-build-unsupported", build)
                : new(true, null, build);

    public static WindowsCompatibilityResult EvaluateCurrent() =>
        Evaluate(OperatingSystem.IsWindows(), Environment.OSVersion.Version.Build);
}
