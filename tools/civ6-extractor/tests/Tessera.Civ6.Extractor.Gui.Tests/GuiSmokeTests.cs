using System.Diagnostics;
using Tessera.Civ6.Extractor.Core;
using Tessera.Civ6.Extractor.Gui;

namespace Tessera.Civ6.Extractor.Gui.Tests;

public sealed class GuiSmokeTests
{
    [Fact]
    public async Task 主窗体由资源文案构造且初始命令状态明确()
    {
        await RunStaAsync(() =>
        {
            var workflow = new Civ6ExtractionWorkflow(new FakeService(), new WindowsCiv6InstallationLocator(() => []));
            using var form = new MainForm(workflow, new FakeLauncher());

            Assert.Equal(GuiText.Get("AppTitle"), form.Text);
            Assert.Equal(GuiText.Get("StatusIdle"), Find<Label>(form, "status").Text);
            Assert.Equal(GuiText.Get("Generate"), Find<Button>(form, "generate").Text);
            Assert.False(Find<Button>(form, "generate").Enabled);
            Assert.False(Find<Button>(form, "cancel").Enabled);
            Assert.False(Find<Button>(form, "openOutput").Enabled);
            return Task.CompletedTask;
        });
    }

    [Fact]
    public async Task 主窗体可真实创建句柄显示并安全关闭()
    {
        await RunStaAsync(() =>
        {
            var workflow = new Civ6ExtractionWorkflow(new FakeService(), new WindowsCiv6InstallationLocator(() => []));
            using var form = new MainForm(workflow, new FakeLauncher());

            form.Show();
            Application.DoEvents();

            Assert.True(form.IsHandleCreated);
            Assert.True(form.Visible);
            Assert.True(Find<Button>(form, "autoDetect").CanSelect);

            form.Close();
            Application.DoEvents();
            Assert.False(form.Visible);
            return Task.CompletedTask;
        });
    }

    [Fact]
    public async Task 检查完成后显示版本类别并允许选择输出()
    {
        await RunStaAsync(async () =>
        {
            var workflow = new Civ6ExtractionWorkflow(new FakeService(), new WindowsCiv6InstallationLocator(() => []));
            using var form = new MainForm(workflow, new FakeLauncher());

            await workflow.InspectSelectedAsync("C:/Games/Civ6");

            Assert.Equal("1.0.12.68", Find<Label>(form, "versionValue").Text);
            Assert.Equal(GuiText.Get("VersionSupported"), Find<Label>(form, "supportValue").Text);
            Assert.Single(Find<ListView>(form, "categories").Items);
            Assert.True(Find<Button>(form, "chooseOutput").Enabled);
            Assert.False(Find<Button>(form, "generate").Enabled);

            Assert.True(workflow.SetOutputParentDirectory(Path.GetTempPath()));
            Assert.True(Find<Button>(form, "generate").Enabled);
        });
    }

    [Fact]
    public async Task 生成完成显示归档绝对路径且只打开输出父目录()
    {
        await RunStaAsync(async () =>
        {
            var workflow = new Civ6ExtractionWorkflow(new FakeService(), new WindowsCiv6InstallationLocator(() => []));
            var launcher = new RecordingLauncher();
            using var form = new MainForm(workflow, launcher);
            var parent = Path.Combine(Path.GetTempPath(), $"tessera-civ6-gui-output-{Guid.NewGuid():N}");
            Directory.CreateDirectory(parent);
            try
            {
                form.Show();
                Application.DoEvents();
                await workflow.InspectSelectedAsync("C:/Games/Civ6");
                Assert.True(workflow.SetOutputParentDirectory(parent));
                var completed = await workflow.GenerateAsync();

                Assert.Equal(completed.Result?.ArchivePath, Find<TextBox>(form, "outputPath").Text);
                Assert.Equal(
                    Path.Combine(parent, "tessera.civ6.tessera-module.zip"),
                    Find<TextBox>(form, "outputPath").Text);
                var open = Find<Button>(form, "openOutput");
                Assert.True(open.Enabled);
                open.PerformClick();
                Assert.Equal(parent, launcher.OpenedDirectory);
            }
            finally
            {
                form.Close();
                Directory.Delete(parent, recursive: true);
            }
        });
    }

    [Fact]
    public async Task 有界定位器规范化去重且不扫描其他目录()
    {
        var locator = new WindowsCiv6InstallationLocator(() =>
        [
            "C:/Games/Civ6",
            "C:/Games/Civ6/",
            "",
        ]);

        var candidates = await locator.FindCandidatesAsync(CancellationToken.None);

        Assert.Single(candidates);
        Assert.Equal(Path.GetFullPath("C:/Games/Civ6"), candidates[0]);
    }

    [Fact]
    public async Task 后台检查时禁用重复启动并可从窗体取消()
    {
        await RunStaAsync(() =>
        {
            var service = new BlockingService();
            var workflow = new Civ6ExtractionWorkflow(service, new WindowsCiv6InstallationLocator(() => []));
            using var form = new MainForm(workflow, new FakeLauncher());
            var operation = workflow.InspectSelectedAsync("C:/Games/Civ6");
            Assert.True(service.Started.Task.IsCompleted);

            Assert.True(Find<Button>(form, "cancel").Enabled);
            Assert.False(Find<Button>(form, "autoDetect").Enabled);
            workflow.Cancel();
            PumpUntilCompleted(operation);

            Assert.False(Find<Button>(form, "cancel").Enabled);
            Assert.Equal(GuiText.Get("StatusCancelled"), Find<Label>(form, "status").Text);
            return Task.CompletedTask;
        });
    }

    [Theory]
    [InlineData("checking-installation")]
    [InlineData("scanning-content")]
    [InlineData("extracting-strategic-art")]
    [InlineData("extracting-ui-icons")]
    [InlineData("writing-package")]
    [InlineData("validating-package")]
    [InlineData("writing-archive")]
    public void 进度阶段均解析为集中资源文案(string stage)
    {
        var resolved = GuiText.Progress(stage);

        Assert.NotEqual(stage, resolved);
        Assert.DoesNotContain("Progress", resolved, StringComparison.Ordinal);
    }

    [Fact]
    public void 已知错误显示行动错误码和安全相对位置()
    {
        var presentation = GuiText.DescribeError(
            "game-expansion-required",
            "DLC/Expansion2/Expansion2.modinfo");

        Assert.Equal(GuiText.Get("ErrorExpansion"), presentation.Action);
        Assert.Equal("game-expansion-required", presentation.Code);
        Assert.Equal("DLC/Expansion2/Expansion2.modinfo", presentation.Field);
        Assert.Contains("错误码：game-expansion-required", presentation.DialogText, StringComparison.Ordinal);
        Assert.Contains("位置/字段：DLC/Expansion2/Expansion2.modinfo", presentation.DialogText, StringComparison.Ordinal);
    }

    [Fact]
    public void 未知错误无字段时仍提供本地化行动和稳定错误码()
    {
        var presentation = GuiText.DescribeError("future-stable-code");

        Assert.Equal(GuiText.Get("ErrorUnknownAction"), presentation.Action);
        Assert.Null(presentation.Field);
        Assert.Contains("错误码：future-stable-code", presentation.DialogText, StringComparison.Ordinal);
        Assert.DoesNotContain("位置/字段", presentation.DialogText, StringComparison.Ordinal);
    }

    [Theory]
    [InlineData("inputDirectory", "FieldInputDirectory")]
    [InlineData("outputDirectory", "FieldOutputDirectory")]
    public void 输入输出字段只显示本地化字段名(string fieldPath, string expectedKey)
    {
        var presentation = GuiText.DescribeError("operation-invalid", fieldPath);

        Assert.Equal(GuiText.Get(expectedKey), presentation.Field);
        Assert.DoesNotContain("Directory", presentation.DialogText, StringComparison.Ordinal);
    }

    [Theory]
    [InlineData(@"C:\Users\Example\CivilizationVI.exe")]
    [InlineData(@"D:\SteamLibrary\steamapps\common\Sid Meier's Civilization VI")]
    [InlineData("../private/output")]
    public void 绝对或穿越位置被隐藏且不泄露原文(string unsafeField)
    {
        var presentation = GuiText.DescribeError("operation-invalid", unsafeField);

        Assert.Equal(GuiText.Get("FieldInternalHidden"), presentation.Field);
        Assert.DoesNotContain(unsafeField, presentation.DialogText, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("SteamLibrary", presentation.DialogText, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public void 工作流内部异常文本不会进入展示结果()
    {
        var workflowError = new ExtractionWorkflowError(
            "operation-invalid",
            "inputDirectory",
            "SECRET internal exception C:\\Users\\Example");

        var presentation = GuiText.DescribeError(workflowError.Code, workflowError.FieldPath);

        Assert.DoesNotContain("SECRET", presentation.DialogText, StringComparison.Ordinal);
        Assert.DoesNotContain("Example", presentation.DialogText, StringComparison.Ordinal);
        Assert.Contains("operation-invalid", presentation.DialogText, StringComparison.Ordinal);
    }

    private static T Find<T>(Control root, string name)
        where T : Control => Assert.IsType<T>(Assert.Single(root.Controls.Find(name, true)));

    private static void PumpUntilCompleted(Task task)
    {
        var deadline = Environment.TickCount64 + 5_000;
        while (!task.IsCompleted && Environment.TickCount64 < deadline)
        {
            Application.DoEvents();
            Thread.Sleep(1);
        }

        Assert.True(task.IsCompleted, "异步 GUI 操作未在消息泵期限内结束。");
        task.GetAwaiter().GetResult();
    }

    private static Task RunStaAsync(Func<Task> action)
    {
        var completion = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var thread = new Thread(async () =>
        {
            try
            {
                await action();
                completion.SetResult();
            }
            catch (Exception error)
            {
                completion.SetException(error);
            }
        });
        thread.SetApartmentState(ApartmentState.STA);
        thread.Start();
        return completion.Task.WaitAsync(TimeSpan.FromSeconds(10));
    }

    private sealed class FakeLauncher : IOutputDirectoryLauncher
    {
        public void Open(string directory) => throw new InvalidOperationException(directory);
    }

    private sealed class RecordingLauncher : IOutputDirectoryLauncher
    {
        public string? OpenedDirectory { get; private set; }

        public void Open(string directory) => OpenedDirectory = directory;
    }

    private sealed class FakeService : ICiv6ExtractionApplicationService
    {
        public Task<Civ6ExtractionOverview> InspectOverviewAsync(
            string inputDirectory,
            IProgress<ExtractionProgress>? progress = null,
            CancellationToken cancellationToken = default)
        {
            cancellationToken.ThrowIfCancellationRequested();
            progress?.Report(new("inspection-complete", 1));
            return Task.FromResult(new Civ6ExtractionOverview(
                new Civ6InstallationInspection("steam", "1.0.12.68", "supported", [], []),
                new Civ6CatalogInspection(
                    "1.0.12.68",
                    [new Civ6CatalogCategoryCount("terrain", 10, ["TERRAIN_GRASS"])],
                    10,
                    10,
                    0,
                    [])));
        }

        public Task<ExtractionResult> ExtractAsync(
            ExtractionRequest request,
            IProgress<ExtractionProgress>? progress,
            CancellationToken cancellationToken = default) =>
            Task.FromResult(new ExtractionResult(
                Path.Combine(Path.GetDirectoryName(request.OutputDirectory)!, "tessera.civ6.tessera-module.zip"),
                "tessera.civ6",
                "1.0.0",
                10,
                0));
    }

    private sealed class BlockingService : ICiv6ExtractionApplicationService
    {
        public TaskCompletionSource Started { get; } = new(TaskCreationOptions.RunContinuationsAsynchronously);

        public async Task<Civ6ExtractionOverview> InspectOverviewAsync(
            string inputDirectory,
            IProgress<ExtractionProgress>? progress = null,
            CancellationToken cancellationToken = default)
        {
            Started.TrySetResult();
            await Task.Delay(Timeout.InfiniteTimeSpan, cancellationToken);
            throw new UnreachableException();
        }

        public Task<ExtractionResult> ExtractAsync(
            ExtractionRequest request,
            IProgress<ExtractionProgress>? progress,
            CancellationToken cancellationToken = default) =>
            throw new UnreachableException();
    }
}
