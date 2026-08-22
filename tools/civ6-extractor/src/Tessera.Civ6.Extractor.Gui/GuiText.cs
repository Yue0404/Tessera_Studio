using System.Globalization;
using System.Resources;

namespace Tessera.Civ6.Extractor.Gui;

public sealed record GuiErrorPresentation(
    string Action,
    string Code,
    string? Field)
{
    public string DialogText => Field is null
        ? string.Join(Environment.NewLine, Action, GuiText.Format("ErrorCodeLine", Code))
        : string.Join(
            Environment.NewLine,
            Action,
            GuiText.Format("ErrorCodeLine", Code),
            GuiText.Format("ErrorFieldLine", Field));
}

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
        "operation-invalid" => Get("ErrorOperationInvalid"),
        _ => Get("ErrorUnknownAction"),
    };

    public static GuiErrorPresentation DescribeError(string code, string? fieldPath = null) =>
        new(Error(code), code, SafeField(fieldPath));

    public static string Progress(string? stage) => stage switch
    {
        "checking-installation" => Get("ProgressChecking"),
        "scanning-content" => Get("ProgressScanning"),
        "extracting-strategic-art" => Get("ProgressStrategic"),
        "extracting-ui-icons" => Get("ProgressIcons"),
        "writing-package" => Get("ProgressWriting"),
        "validating-package" => Get("ProgressValidating"),
        "writing-archive" => Get("ProgressArchive"),
        _ => Get("StatusBusy"),
    };

    private static string? SafeField(string? fieldPath)
    {
        if (string.IsNullOrWhiteSpace(fieldPath))
        {
            return null;
        }

        return fieldPath switch
        {
            "inputDirectory" => Get("FieldInputDirectory"),
            "outputDirectory" => Get("FieldOutputDirectory"),
            "moduleVersion" => Get("FieldModuleVersion"),
            "generatorVersion" => Get("FieldGeneratorVersion"),
            _ when IsSafeRelativeField(fieldPath) => fieldPath.Replace('\\', '/'),
            _ => Get("FieldInternalHidden"),
        };
    }

    private static bool IsSafeRelativeField(string fieldPath)
    {
        if (fieldPath.Length > 240 || Path.IsPathRooted(fieldPath) || fieldPath.Contains(':', StringComparison.Ordinal))
        {
            return false;
        }

        var segments = fieldPath.Replace('\\', '/').Split('/', StringSplitOptions.RemoveEmptyEntries);
        return segments.Length > 0 &&
            segments.All(segment =>
                segment is not "." and not ".." &&
                segment.All(character => char.IsAsciiLetterOrDigit(character) || character is '.' or '_' or '-'));
    }
}
