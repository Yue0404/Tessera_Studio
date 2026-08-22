using System.Text.Json;
using Tessera.Civ6.Extractor.Core;

return await RunAsync(args);

static async Task<int> RunAsync(string[] arguments)
{
    if (arguments is ["--help"] or ["-h"] || arguments.Length == 0)
    {
        Console.WriteLine("用法: TesseraCiv6Extractor --input <正式游戏目录> --output <输出目录> [--module-version <SemVer>]");
        return arguments.Length == 0 ? 2 : 0;
    }

    try
    {
        var options = ParseOptions(arguments);
        using var cancellation = new CancellationTokenSource();
        Console.CancelKeyPress += (_, eventArgs) =>
        {
            eventArgs.Cancel = true;
            cancellation.Cancel();
        };
        var service = new Civ6ExtractionService();
        var result = await service.ExtractAsync(new ExtractionRequest(
            Require(options, "input"),
            Require(options, "output"),
            options.GetValueOrDefault("module-version", "1.0.0"),
            typeof(Program).Assembly.GetName().Version?.ToString(3) ?? "1.0.0"), cancellation.Token);
        Console.WriteLine(JsonSerializer.Serialize(new
        {
            ok = true,
            outputDirectory = result.OutputDirectory,
            moduleId = result.ModuleId,
            moduleVersion = result.ModuleVersion,
            elementCount = result.ElementCount,
            resourceCount = result.ResourceCount,
        }));
        return 0;
    }
    catch (OperationCanceledException)
    {
        Console.Error.WriteLine(JsonSerializer.Serialize(new { ok = false, code = "operation-cancelled" }));
        return 130;
    }
    catch (ExtractionException error)
    {
        Console.Error.WriteLine(JsonSerializer.Serialize(new
        {
            ok = false,
            code = error.Code,
            fieldPath = error.FieldPath,
            message = error.Message,
        }));
        return 2;
    }
    catch (Exception error)
    {
        Console.Error.WriteLine(JsonSerializer.Serialize(new
        {
            ok = false,
            code = "unexpected-error",
            message = error.Message,
        }));
        return 1;
    }
}

static Dictionary<string, string> ParseOptions(string[] arguments)
{
    if (arguments.Length % 2 != 0)
    {
        throw new ExtractionException("cli-arguments-invalid", "参数必须按 --名称 值 成对提供。", "arguments");
    }

    var options = new Dictionary<string, string>(StringComparer.Ordinal);
    for (var index = 0; index < arguments.Length; index += 2)
    {
        var key = arguments[index];
        if (!key.StartsWith("--", StringComparison.Ordinal) || key.Length <= 2 || !options.TryAdd(key[2..], arguments[index + 1]))
        {
            throw new ExtractionException("cli-arguments-invalid", "参数名无效或重复。", key);
        }
    }

    var supported = new HashSet<string>(["input", "output", "module-version"], StringComparer.Ordinal);
    var unknown = options.Keys.FirstOrDefault(key => !supported.Contains(key));
    if (unknown is not null)
    {
        throw new ExtractionException("cli-arguments-invalid", "存在不支持的参数。", unknown);
    }

    return options;
}

static string Require(IReadOnlyDictionary<string, string> options, string key) =>
    options.TryGetValue(key, out var value) && !string.IsNullOrWhiteSpace(value)
        ? value
        : throw new ExtractionException("cli-argument-required", $"缺少 --{key} 参数。", key);
