namespace Tessera.Civ6.Extractor.Core.Tests;

public sealed class ExtractionWorkflowTests
{
    [Fact]
    public async Task 手选目录检查成功并产生可生成状态()
    {
        var service = new FakeService();
        var workflow = new Civ6ExtractionWorkflow(service, new FakeLocator([]));

        var result = await workflow.InspectSelectedAsync("C:/Games/Civ6");

        Assert.Equal("ready", result.Stage);
        Assert.False(result.IsBusy);
        Assert.Equal("1.0.12.68", result.Overview?.Installation.GameVersion);
        Assert.Equal(197, result.Overview?.Catalog.TotalCount);
        Assert.Equal(1, service.InspectCalls);
    }

    [Fact]
    public async Task 自动探测按有界候选顺序跳过残留安装()
    {
        var service = new FakeService
        {
            Inspect = (path, _, _) => path.EndsWith("Old", StringComparison.Ordinal)
                ? Task.FromException<Civ6ExtractionOverview>(
                    new ExtractionException("game-base-required", "old"))
                : Task.FromResult(Overview()),
        };
        var workflow = new Civ6ExtractionWorkflow(
            service,
            new FakeLocator(["C:/Games/Old", "D:/Games/Civ6"]));

        var result = await workflow.AutoDetectAndInspectAsync();

        Assert.Equal("ready", result.Stage);
        Assert.Equal(Path.GetFullPath("D:/Games/Civ6"), result.InputDirectory);
        Assert.Equal(2, service.InspectCalls);
    }

    [Fact]
    public async Task 忙碌期间拒绝重复检查且取消可观察()
    {
        var started = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var service = new FakeService
        {
            Inspect = async (_, _, cancellationToken) =>
            {
                started.SetResult();
                await Task.Delay(Timeout.InfiniteTimeSpan, cancellationToken);
                return Overview();
            },
        };
        var workflow = new Civ6ExtractionWorkflow(service, new FakeLocator([]));
        var first = workflow.InspectSelectedAsync("C:/Games/Civ6");
        await started.Task;

        var duplicate = await workflow.InspectSelectedAsync("D:/Games/Civ6");
        workflow.Cancel();
        var cancelled = await first;

        Assert.True(duplicate.IsBusy);
        Assert.Equal(1, service.InspectCalls);
        Assert.Equal("cancelled", cancelled.Stage);
        Assert.False(cancelled.IsBusy);
    }

    [Fact]
    public async Task 生成阶段进度单调且只提交一次结果()
    {
        var service = new FakeService
        {
            Extract = (request, progress, _) =>
            {
                progress?.Report(new("scanning-content", 0.2));
                progress?.Report(new("writing-package", 0.8));
                progress?.Report(new("completed", 1));
                return Task.FromResult(new ExtractionResult(
                    Path.Combine(
                        Path.GetDirectoryName(request.OutputDirectory)!,
                        "tessera.civ6.tessera-module.zip"),
                    "tessera.civ6",
                    request.ModuleVersion,
                    197,
                    114));
            },
        };
        var workflow = new Civ6ExtractionWorkflow(service, new FakeLocator([]));
        var samples = new List<double>();
        workflow.StateChanged += (_, state) => samples.Add(state.Progress);
        await workflow.InspectSelectedAsync("C:/Games/Civ6");
        Assert.True(workflow.SetOutputParentDirectory("C:/Exports"));
        samples.Clear();

        var result = await workflow.GenerateAsync();

        Assert.Equal("completed", result.Stage);
        Assert.Equal(Path.Combine(Path.GetFullPath("C:/Exports"), "tessera.civ6"), result.OutputDirectory);
        Assert.Equal(
            Path.Combine(Path.GetFullPath("C:/Exports"), "tessera.civ6.tessera-module.zip"),
            result.Result?.ArchivePath);
        Assert.Equal(114, result.Result?.ResourceCount);
        Assert.Equal(1, service.ExtractCalls);
        Assert.True(samples.Zip(samples.Skip(1), (left, right) => right >= left).All(value => value));
    }

    [Fact]
    public async Task 结构化失败保留错误码且不伪造成功()
    {
        var service = new FakeService
        {
            Inspect = (_, _, _) => Task.FromException<Civ6ExtractionOverview>(
                new ExtractionException(
                    "game-expansion-required",
                    "missing",
                    "DLC/Expansion2")),
        };
        var workflow = new Civ6ExtractionWorkflow(service, new FakeLocator([]));

        var result = await workflow.InspectSelectedAsync("C:/Games/Civ6");

        Assert.Equal("failed", result.Stage);
        Assert.Equal("game-expansion-required", result.Error?.Code);
        Assert.Equal("DLC/Expansion2", result.Error?.FieldPath);
        Assert.Null(result.Overview);
    }

    private static Civ6ExtractionOverview Overview() =>
        new(
            new Civ6InstallationInspection(
                "steam",
                "1.0.12.68",
                "supported",
                [],
                [new("game-installation-compatible", "info", "ok")]),
            new Civ6CatalogInspection(
                "1.0.12.68",
                [new("resource", 52, ["RESOURCE_WHEAT"])],
                197,
                197,
                0,
                []));

    private sealed class FakeLocator(IReadOnlyList<string> candidates) : ICiv6InstallationLocator
    {
        public Task<IReadOnlyList<string>> FindCandidatesAsync(
            CancellationToken cancellationToken = default)
        {
            cancellationToken.ThrowIfCancellationRequested();
            return Task.FromResult(candidates);
        }
    }

    private sealed class FakeService : ICiv6ExtractionApplicationService
    {
        public Func<
            string,
            IProgress<ExtractionProgress>?,
            CancellationToken,
            Task<Civ6ExtractionOverview>> Inspect
        { get; set; } =
            (_, progress, _) =>
            {
                progress?.Report(new("inspection-complete", 1));
                return Task.FromResult(Overview());
            };

        public Func<
            ExtractionRequest,
            IProgress<ExtractionProgress>?,
            CancellationToken,
            Task<ExtractionResult>> Extract
        { get; set; } =
            (request, _, _) => Task.FromResult(new ExtractionResult(
                request.OutputDirectory,
                "tessera.civ6",
                request.ModuleVersion,
                197,
                114));

        public int InspectCalls { get; private set; }

        public int ExtractCalls { get; private set; }

        public Task<Civ6ExtractionOverview> InspectOverviewAsync(
            string inputDirectory,
            IProgress<ExtractionProgress>? progress = null,
            CancellationToken cancellationToken = default)
        {
            InspectCalls++;
            return Inspect(inputDirectory, progress, cancellationToken);
        }

        public Task<ExtractionResult> ExtractAsync(
            ExtractionRequest request,
            IProgress<ExtractionProgress>? progress,
            CancellationToken cancellationToken = default)
        {
            ExtractCalls++;
            return Extract(request, progress, cancellationToken);
        }
    }
}
