using System.Globalization;
using System.Resources;

namespace Tessera.Civ6.Extractor.Gui;

/// <summary>集中解析 GUI 文案；未来增加语言只需补充同名资源文件。</summary>
public static class GuiText
{
    private static readonly ResourceManager Resources = new(
        "Tessera.Civ6.Extractor.Gui.Resources.Strings",
        typeof(GuiText).Assembly);

    public static string Get(string key) =>
        Resources.GetString(key, CultureInfo.CurrentUICulture) ?? key;

    public static string Format(string key, params object[] values) =>
        string.Format(CultureInfo.CurrentCulture, Get(key), values);

    public static string Error(string code) => code switch
    {
        "game-installation-not-found" => Get("ErrorGameNotFound"),
        "game-base-required" or "game-base-identity-invalid" => Get("ErrorGameBase"),
        "game-expansion-required" or "game-expansion-identity-invalid" => Get("ErrorExpansion"),
        "output-directory-required" => Get("ErrorOutputRequired"),
        "input-output-overlap" => Get("ErrorOverlap"),
        _ => Format("ErrorUnknown", code),
    };

    public static string Progress(string? stage) => stage switch
    {
        "checking-installation" => Get("ProgressChecking"),
        "scanning-content" => Get("ProgressScanning"),
        "extracting-strategic-art" => Get("ProgressStrategic"),
        "extracting-ui-icons" => Get("ProgressIcons"),
        "writing-package" => Get("ProgressWriting"),
        "validating-package" => Get("ProgressValidating"),
        _ => Get("StatusBusy"),
    };
}
