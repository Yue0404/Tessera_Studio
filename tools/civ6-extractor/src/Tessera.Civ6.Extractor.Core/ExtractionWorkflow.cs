namespace Tessera.Civ6.Extractor.Core;

public interface ICiv6ExtractionApplicationService
{
    Task<Civ6ExtractionOverview> InspectOverviewAsync(
        string inputDirectory,
        IProgress<ExtractionProgress>? progress = null,
        CancellationToken cancellationToken = default);

    Task<ExtractionResult> ExtractAsync(
        ExtractionRequest request,
        IProgress<ExtractionProgress>? progress,
        CancellationToken cancellationToken = default);
}

public interface ICiv6InstallationLocator
{
    Task<IReadOnlyList<string>> FindCandidatesAsync(CancellationToken cancellationToken = default);
}

public sealed record ExtractionWorkflowError(string Code, string? FieldPath, string Message);

public sealed record ExtractionWorkflowState(
    string Stage,
    bool IsBusy,
    string? InputDirectory,
    string? OutputParentDirectory,
    string? OutputDirectory,
    Civ6ExtractionOverview? Overview,
    ExtractionResult? Result,
    ExtractionWorkflowError? Error,
    string? ProgressStage,
    double Progress)
{
    public static ExtractionWorkflowState Initial { get; } = new(
        "idle",
        false,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        0);
}

/// <summary>GUI 与测试共用的单飞工作流；不持久化路径，也不承载任何提取实现。</summary>
public sealed class Civ6ExtractionWorkflow
{
    private readonly ICiv6ExtractionApplicationService applicationService;
    private readonly ICiv6InstallationLocator installationLocator;
    private readonly object sync = new();
    private CancellationTokenSource? operationCancellation;
    private ExtractionWorkflowState state = ExtractionWorkflowState.Initial;
    private bool running;

    public Civ6ExtractionWorkflow(
        ICiv6ExtractionApplicationService applicationService,
        ICiv6InstallationLocator installationLocator)
    {
        this.applicationService = applicationService ?? throw new ArgumentNullException(nameof(applicationService));
        this.installationLocator = installationLocator ?? throw new ArgumentNullException(nameof(installationLocator));
    }

    public event EventHandler<ExtractionWorkflowState>? StateChanged;

    public ExtractionWorkflowState State
    {
        get
        {
            lock (sync)
            {
                return state;
            }
        }
    }

    public Task<ExtractionWorkflowState> AutoDetectAndInspectAsync(CancellationToken cancellationToken = default) =>
        RunSingleAsync("detecting", async token =>
        {
            var candidates = await installationLocator.FindCandidatesAsync(token);
            foreach (var candidate in candidates.Distinct(StringComparer.OrdinalIgnoreCase))
            {
                token.ThrowIfCancellationRequested();
                try
                {
                    var normalizedCandidate = Path.TrimEndingDirectorySeparator(Path.GetFullPath(candidate));
                    var overview = await applicationService.InspectOverviewAsync(
                        normalizedCandidate,
                        ProgressForCurrentOperation(),
                        token);
                    return Ready(normalizedCandidate, overview);
                }
                catch (ExtractionException)
                {
                    // 自动探测候选可能是旧安装残留；仅在全部候选失败后报告统一错误。
                }
            }

            throw new ExtractionException(
                "game-installation-not-found",
                "未在有界的已知安装位置找到受支持的文明 6 正式游戏目录。",
                "inputDirectory");
        }, cancellationToken);

    public Task<ExtractionWorkflowState> InspectSelectedAsync(
        string inputDirectory,
        CancellationToken cancellationToken = default) =>
        RunSingleAsync("inspecting", async token =>
        {
            if (string.IsNullOrWhiteSpace(inputDirectory))
            {
                throw new ExtractionException(
                    "input-directory-required",
                    "必须选择正式游戏安装目录。",
                    "inputDirectory");
            }

            var fullPath = Path.TrimEndingDirectorySeparator(Path.GetFullPath(inputDirectory));
            var overview = await applicationService.InspectOverviewAsync(
                fullPath,
                ProgressForCurrentOperation(),
                token);
            return Ready(fullPath, overview);
        }, cancellationToken);

    public bool SetOutputParentDirectory(string outputParentDirectory)
    {
        if (string.IsNullOrWhiteSpace(outputParentDirectory))
        {
            return false;
        }

        lock (sync)
        {
            if (running)
            {
                return false;
            }

            var parent = Path.TrimEndingDirectorySeparator(Path.GetFullPath(outputParentDirectory));
            state = state with
            {
                OutputParentDirectory = parent,
                OutputDirectory = Path.Combine(parent, "tessera.civ6"),
                Error = null,
            };
        }

        RaiseStateChanged();
        return true;
    }

    public Task<ExtractionWorkflowState> GenerateAsync(CancellationToken cancellationToken = default) =>
        RunSingleAsync("extracting", async token =>
        {
            var snapshot = State;
            if (snapshot.Overview is null || snapshot.InputDirectory is null)
            {
                throw new ExtractionException(
                    "workflow-inspection-required",
                    "生成前必须先完成正式游戏检查。",
                    "inputDirectory");
            }

            if (snapshot.OutputDirectory is null)
            {
                throw new ExtractionException(
                    "output-directory-required",
                    "必须先选择本地输出位置。",
                    "outputDirectory");
            }

            var result = await applicationService.ExtractAsync(
                new ExtractionRequest(snapshot.InputDirectory, snapshot.OutputDirectory),
                ProgressForCurrentOperation(),
                token);
            return snapshot with
            {
                Stage = "completed",
                IsBusy = false,
                Result = result,
                Error = null,
                ProgressStage = "completed",
                Progress = 1,
            };
        }, cancellationToken);

    public void Cancel()
    {
        lock (sync)
        {
            operationCancellation?.Cancel();
        }
    }

    private ExtractionWorkflowState Ready(string inputDirectory, Civ6ExtractionOverview overview)
    {
        var snapshot = State;
        return snapshot with
        {
            Stage = "ready",
            IsBusy = false,
            InputDirectory = inputDirectory,
            Overview = overview,
            Result = null,
            Error = null,
            ProgressStage = "inspection-complete",
            Progress = 1,
        };
    }

    private async Task<ExtractionWorkflowState> RunSingleAsync(
        string stage,
        Func<CancellationToken, Task<ExtractionWorkflowState>> operation,
        CancellationToken cancellationToken)
    {
        CancellationTokenSource linkedCancellation;
        lock (sync)
        {
            if (running)
            {
                return state;
            }

            running = true;
            linkedCancellation = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
            operationCancellation = linkedCancellation;
            state = state with
            {
                Stage = stage,
                IsBusy = true,
                Result = null,
                Error = null,
                ProgressStage = stage,
                Progress = 0,
            };
        }
        RaiseStateChanged();

        ExtractionWorkflowState finalState;
        try
        {
            finalState = await operation(linkedCancellation.Token);
        }
        catch (OperationCanceledException) when (linkedCancellation.IsCancellationRequested)
        {
            finalState = State with
            {
                Stage = "cancelled",
                IsBusy = false,
                Error = null,
                ProgressStage = "cancelled",
            };
        }
        catch (ExtractionException error)
        {
            finalState = State with
            {
                Stage = "failed",
                IsBusy = false,
                Error = new(error.Code, error.FieldPath, error.Message),
                ProgressStage = "failed",
            };
        }
        catch (Exception error)
        {
            finalState = State with
            {
                Stage = "failed",
                IsBusy = false,
                Error = new("unexpected-error", null, error.Message),
                ProgressStage = "failed",
            };
        }
        finally
        {
            lock (sync)
            {
                running = false;
                if (ReferenceEquals(operationCancellation, linkedCancellation))
                {
                    operationCancellation = null;
                }
            }
            linkedCancellation.Dispose();
        }

        lock (sync)
        {
            state = finalState;
        }
        RaiseStateChanged();
        return finalState;
    }

    private InlineProgress<ExtractionProgress> ProgressForCurrentOperation() =>
        new InlineProgress<ExtractionProgress>(progress =>
        {
            lock (sync)
            {
                if (!running)
                {
                    return;
                }

                state = state with
                {
                    ProgressStage = progress.Stage,
                    Progress = Math.Clamp(Math.Max(state.Progress, progress.Fraction), 0, 1),
                };
            }
            RaiseStateChanged();
        });

    private void RaiseStateChanged()
    {
        var snapshot = State;
        StateChanged?.Invoke(this, snapshot);
    }

    private sealed class InlineProgress<T>(Action<T> callback) : IProgress<T>
    {
        public void Report(T value) => callback(value);
    }
}
