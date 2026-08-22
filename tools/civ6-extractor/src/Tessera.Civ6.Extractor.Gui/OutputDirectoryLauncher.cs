using System.Diagnostics;

namespace Tessera.Civ6.Extractor.Gui;

public interface IOutputDirectoryLauncher
{
    void Open(string directory);
}

public sealed class OutputDirectoryLauncher : IOutputDirectoryLauncher
{
    public void Open(string directory)
    {
        if (!Directory.Exists(directory))
        {
            throw new DirectoryNotFoundException(directory);
        }

        Process.Start(new ProcessStartInfo
        {
            FileName = directory,
            UseShellExecute = true,
        });
    }
}
