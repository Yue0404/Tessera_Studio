using System.Globalization;
using Tessera.Civ6.Extractor.Core;

namespace Tessera.Civ6.Extractor.Gui;

/// <summary>WinForms 仅负责输入、状态展示与命令转发，提取语义全部由 Core 实现。</summary>
public sealed class MainForm : Form
{
    private readonly Civ6ExtractionWorkflow workflow;
    private readonly IOutputDirectoryLauncher outputLauncher;
    private readonly TextBox inputPath = CreatePathBox("inputPath");
    private readonly TextBox outputPath = CreatePathBox("outputPath");
    private readonly Button autoDetect = CreateButton("autoDetect", "AutoDetect");
    private readonly Button chooseInput = CreateButton("chooseInput", "ChooseInput");
    private readonly Button inspect = CreateButton("inspect", "Inspect");
    private readonly Button chooseOutput = CreateButton("chooseOutput", "ChooseOutput");
    private readonly Button generate = CreateButton("generate", "Generate");
    private readonly Button cancel = CreateButton("cancel", "Cancel");
    private readonly Button openOutput = CreateButton("openOutput", "OpenOutput");
    private readonly Label versionValue = CreateValueLabel("versionValue");
    private readonly Label storefrontValue = CreateValueLabel("storefrontValue");
    private readonly Label supportValue = CreateValueLabel("supportValue");
    private readonly Label totalValue = CreateValueLabel("totalValue");
    private readonly ListView categories = new();
    private readonly ProgressBar progress = new();
    private readonly Label status = CreateValueLabel("status");
    private string? lastPresentedError;

    public MainForm(
        Civ6ExtractionWorkflow workflow,
        IOutputDirectoryLauncher? outputLauncher = null)
    {
        this.workflow = workflow ?? throw new ArgumentNullException(nameof(workflow));
        this.outputLauncher = outputLauncher ?? new OutputDirectoryLauncher();
        Text = GuiText.Get("AppTitle");
        Name = "mainForm";
        MinimumSize = new(760, 640);
        Size = new(880, 760);
        StartPosition = FormStartPosition.CenterScreen;
        AutoScaleMode = AutoScaleMode.Dpi;

        BuildLayout();
        WireEvents();
        ApplyState(workflow.State);
    }

    internal Button GenerateButton => generate;

    internal Button CancelActionButton => cancel;

    internal Label StatusLabel => status;

    private void BuildLayout()
    {
        var root = new TableLayoutPanel
        {
            Dock = DockStyle.Fill,
            Padding = new(16),
            ColumnCount = 1,
            RowCount = 7,
            AutoScroll = true,
        };
        root.RowStyles.Add(new(SizeType.AutoSize));
        root.RowStyles.Add(new(SizeType.AutoSize));
        root.RowStyles.Add(new(SizeType.Percent, 45));
        root.RowStyles.Add(new(SizeType.AutoSize));
        root.RowStyles.Add(new(SizeType.Percent, 55));
        root.RowStyles.Add(new(SizeType.AutoSize));
        root.RowStyles.Add(new(SizeType.AutoSize));
        Controls.Add(root);

        root.Controls.Add(new Label
        {
            Text = GuiText.Get("Intro"),
            AutoSize = true,
            MaximumSize = new(820, 0),
            Padding = new(0, 0, 0, 8),
        });
        root.Controls.Add(BuildInputGroup());
        root.Controls.Add(BuildInspectionGroup());
        root.Controls.Add(BuildOutputGroup());

        categories.Name = "categories";
        categories.Dock = DockStyle.Fill;
        categories.View = View.Details;
        categories.FullRowSelect = true;
        categories.HideSelection = false;
        categories.Columns.Add(GuiText.Get("Category"), 300);
        categories.Columns.Add(GuiText.Get("Count"), 120);
        root.Controls.Add(categories);

        progress.Name = "progress";
        progress.Dock = DockStyle.Top;
        progress.Minimum = 0;
        progress.Maximum = 1000;
        progress.Height = 18;
        root.Controls.Add(progress);

        status.AutoSize = true;
        status.MaximumSize = new(820, 0);
        status.Padding = new(0, 6, 0, 0);
        root.Controls.Add(status);
    }

    private GroupBox BuildInputGroup()
    {
        var group = new GroupBox
        {
            Text = GuiText.Get("InputGroup"),
            Dock = DockStyle.Top,
            AutoSize = true,
            Padding = new(10),
        };
        var layout = CreatePathLayout(GuiText.Get("InputPath"), inputPath);
        var buttons = CreateButtonBar(autoDetect, chooseInput, inspect);
        layout.Controls.Add(buttons, 1, 1);
        group.Controls.Add(layout);
        return group;
    }

    private GroupBox BuildInspectionGroup()
    {
        var group = new GroupBox
        {
            Text = GuiText.Get("InspectionGroup"),
            Dock = DockStyle.Fill,
            Padding = new(10),
        };
        var layout = new TableLayoutPanel
        {
            Dock = DockStyle.Fill,
            ColumnCount = 4,
            RowCount = 2,
            AutoSize = true,
        };
        layout.ColumnStyles.Add(new(SizeType.AutoSize));
        layout.ColumnStyles.Add(new(SizeType.Percent, 50));
        layout.ColumnStyles.Add(new(SizeType.AutoSize));
        layout.ColumnStyles.Add(new(SizeType.Percent, 50));
        AddFact(layout, 0, GuiText.Get("GameVersion"), versionValue);
        AddFact(layout, 1, GuiText.Get("Storefront"), storefrontValue);
        AddFact(layout, 2, GuiText.Get("SupportStatus"), supportValue);
        AddFact(layout, 3, GuiText.Get("ContentTotal"), totalValue);
        group.Controls.Add(layout);
        return group;
    }

    private GroupBox BuildOutputGroup()
    {
        var group = new GroupBox
        {
            Text = GuiText.Get("OutputGroup"),
            Dock = DockStyle.Top,
            AutoSize = true,
            Padding = new(10),
        };
        var layout = CreatePathLayout(GuiText.Get("OutputParent"), outputPath);
        layout.Controls.Add(CreateButtonBar(chooseOutput, generate, cancel, openOutput), 1, 1);
        group.Controls.Add(layout);
        return group;
    }

    private void WireEvents()
    {
        workflow.StateChanged += WorkflowStateChanged;
        autoDetect.Click += async (_, _) => await RunAsync(workflow.AutoDetectAndInspectAsync);
        inspect.Click += async (_, _) => await RunAsync(token => workflow.InspectSelectedAsync(inputPath.Text, token));
        chooseInput.Click += async (_, _) => await ChooseAndInspectInputAsync();
        chooseOutput.Click += (_, _) => ChooseOutputDirectory();
        generate.Click += async (_, _) => await RunAsync(workflow.GenerateAsync);
        cancel.Click += (_, _) => workflow.Cancel();
        openOutput.Click += (_, _) => OpenOutputDirectory();
        FormClosed += (_, _) =>
        {
            workflow.StateChanged -= WorkflowStateChanged;
            workflow.Cancel();
        };
    }

    private async Task ChooseAndInspectInputAsync()
    {
        using var dialog = new FolderBrowserDialog
        {
            Description = GuiText.Get("SelectGameFolderTitle"),
            UseDescriptionForTitle = true,
            ShowNewFolderButton = false,
        };
        if (dialog.ShowDialog(this) == DialogResult.OK)
        {
            inputPath.Text = dialog.SelectedPath;
            await RunAsync(token => workflow.InspectSelectedAsync(dialog.SelectedPath, token));
        }
    }

    private void ChooseOutputDirectory()
    {
        using var dialog = new FolderBrowserDialog
        {
            Description = GuiText.Get("SelectOutputFolderTitle"),
            UseDescriptionForTitle = true,
            ShowNewFolderButton = true,
        };
        if (dialog.ShowDialog(this) == DialogResult.OK)
        {
            try
            {
                workflow.SetOutputParentDirectory(dialog.SelectedPath);
            }
            catch (Exception error) when (error is ArgumentException or IOException or NotSupportedException)
            {
                PresentError("output-directory-required");
            }
        }
    }

    private void OpenOutputDirectory()
    {
        var directory = workflow.State.OutputDirectory;
        if (directory is null)
        {
            PresentError("output-directory-required");
            return;
        }

        try
        {
            outputLauncher.Open(directory);
        }
        catch (Exception error) when (error is IOException or InvalidOperationException or UnauthorizedAccessException)
        {
            MessageBox.Show(this, GuiText.Get("ErrorOpenOutput"), GuiText.Get("ErrorTitle"),
                MessageBoxButtons.OK, MessageBoxIcon.Error);
        }
    }

    private async Task RunAsync(Func<CancellationToken, Task<ExtractionWorkflowState>> operation)
    {
        try
        {
            await operation(CancellationToken.None);
        }
        catch (Exception error) when (error is ArgumentException or IOException or NotSupportedException)
        {
            PresentError("operation-invalid");
        }
    }

    private void WorkflowStateChanged(object? sender, ExtractionWorkflowState next)
    {
        if (IsDisposed)
        {
            return;
        }

        if (InvokeRequired)
        {
            BeginInvoke(() => ApplyState(next));
            return;
        }

        ApplyState(next);
    }

    private void ApplyState(ExtractionWorkflowState next)
    {
        inputPath.Text = next.InputDirectory ?? inputPath.Text;
        outputPath.Text = next.OutputDirectory ?? GuiText.Get("NotSelected");
        versionValue.Text = next.Overview?.Installation.GameVersion ?? GuiText.Get("NotChecked");
        storefrontValue.Text = Storefront(next.Overview?.Installation.Storefront);
        supportValue.Text = VersionStatus(next.Overview?.Installation.VersionStatus);
        totalValue.Text = next.Overview?.Catalog.TotalCount.ToString(CultureInfo.CurrentCulture) ?? GuiText.Get("NotChecked");
        progress.Value = (int)Math.Round(Math.Clamp(next.Progress, 0, 1) * progress.Maximum);

        categories.BeginUpdate();
        categories.Items.Clear();
        foreach (var category in next.Overview?.Catalog.Categories ?? [])
        {
            categories.Items.Add(new ListViewItem([CategoryName(category.Category), category.Count.ToString(CultureInfo.CurrentCulture)]));
        }
        categories.EndUpdate();

        autoDetect.Enabled = !next.IsBusy;
        chooseInput.Enabled = !next.IsBusy;
        inspect.Enabled = !next.IsBusy && !string.IsNullOrWhiteSpace(inputPath.Text);
        chooseOutput.Enabled = !next.IsBusy && next.Overview is not null;
        generate.Enabled = !next.IsBusy && next.Overview is not null && next.OutputDirectory is not null;
        cancel.Enabled = next.IsBusy;
        openOutput.Enabled = !next.IsBusy && next.Stage == "completed" && Directory.Exists(next.OutputDirectory);

        status.Text = next.Stage switch
        {
            "ready" => GuiText.Get("StatusReady"),
            "completed" => GuiText.Get("StatusCompleted"),
            "cancelled" => GuiText.Get("StatusCancelled"),
            "failed" => GuiText.Error(next.Error?.Code ?? "unknown"),
            _ when next.IsBusy => GuiText.Progress(next.ProgressStage),
            _ => GuiText.Get("StatusIdle"),
        };

        var errorIdentity = next.Error is null ? null : $"{next.Error.Code}\u001f{next.Error.FieldPath}";
        if (next.Stage == "failed" && next.Error is not null && lastPresentedError != errorIdentity)
        {
            lastPresentedError = errorIdentity;
            PresentError(next.Error.Code, next.Error.FieldPath);
        }
        else if (next.Stage != "failed")
        {
            lastPresentedError = null;
        }
    }

    private void PresentError(string code, string? fieldPath = null)
    {
        var presentation = GuiText.DescribeError(code, fieldPath);
        MessageBox.Show(
            this,
            presentation.DialogText,
            GuiText.Get("ErrorTitle"),
            MessageBoxButtons.OK,
            MessageBoxIcon.Error);
    }

    private static string Storefront(string? value) => value switch
    {
        "steam" => GuiText.Get("StoreSteam"),
        "epic" => GuiText.Get("StoreEpic"),
        "microsoft-store" => GuiText.Get("StoreMicrosoft"),
        null => GuiText.Get("NotChecked"),
        _ => GuiText.Get("StoreUnknown"),
    };

    private static string VersionStatus(string? value) => value switch
    {
        "supported" => GuiText.Get("VersionSupported"),
        "compatible-unknown" => GuiText.Get("VersionCompatibleUnknown"),
        _ => GuiText.Get("NotChecked"),
    };

    private static string CategoryName(string value) => GuiText.Get($"Category_{value}");

    private static TextBox CreatePathBox(string name) => new()
    {
        Name = name,
        ReadOnly = true,
        Dock = DockStyle.Fill,
    };

    private static Button CreateButton(string name, string textKey) => new()
    {
        Name = name,
        Text = GuiText.Get(textKey),
        AutoSize = true,
    };

    private static Label CreateValueLabel(string name) => new()
    {
        Name = name,
        AutoSize = true,
        Padding = new(4),
    };

    private static FlowLayoutPanel CreateButtonBar(params Button[] buttons)
    {
        var bar = new FlowLayoutPanel
        {
            Dock = DockStyle.Fill,
            AutoSize = true,
            WrapContents = false,
        };
        bar.Controls.AddRange(buttons);
        return bar;
    }

    private static TableLayoutPanel CreatePathLayout(string label, Control path)
    {
        var layout = new TableLayoutPanel
        {
            Dock = DockStyle.Top,
            AutoSize = true,
            ColumnCount = 2,
            RowCount = 2,
        };
        layout.ColumnStyles.Add(new(SizeType.AutoSize));
        layout.ColumnStyles.Add(new(SizeType.Percent, 100));
        layout.Controls.Add(new Label { Text = label, AutoSize = true, Padding = new(0, 5, 10, 0) }, 0, 0);
        layout.Controls.Add(path, 1, 0);
        return layout;
    }

    private static void AddFact(TableLayoutPanel layout, int index, string label, Control value)
    {
        var row = index / 2;
        var column = (index % 2) * 2;
        layout.Controls.Add(new Label { Text = label, AutoSize = true, Padding = new(0, 4, 8, 4) }, column, row);
        layout.Controls.Add(value, column + 1, row);
    }
}
