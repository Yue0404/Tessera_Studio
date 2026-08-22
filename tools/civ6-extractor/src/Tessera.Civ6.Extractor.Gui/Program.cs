using Tessera.Civ6.Extractor.Core;

namespace Tessera.Civ6.Extractor.Gui;

internal static class Program
{
    [STAThread]
    private static void Main()
    {
        ApplicationConfiguration.Initialize();
        var compatibility = WindowsReleaseCompatibility.EvaluateCurrent();
        if (!compatibility.Supported)
        {
            MessageBox.Show(
                GuiText.DescribeCompatibilityError(compatibility),
                GuiText.Get("AppTitle"),
                MessageBoxButtons.OK,
                MessageBoxIcon.Error);
            return;
        }
        using var form = new MainForm(new Civ6ExtractionWorkflow(
            new Civ6ExtractionService(),
            new WindowsCiv6InstallationLocator()));
        Application.Run(form);
    }
}
