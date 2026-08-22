using System.Text.Json;
using Tessera.Civ6.Extractor.Core;

return await RunAsync(args);

static async Task<int> RunAsync(string[] arguments)
{
    if (arguments is ["--help"] or ["-h"] || arguments.Length == 0)
    {
        Console.WriteLine("用法: TesseraCiv6Extractor inspect --input <正式游戏目录>");
        Console.WriteLine("      TesseraCiv6Extractor catalog inspect --input <正式游戏目录>");
        Console.WriteLine("      TesseraCiv6Extractor art inspect --input <正式游戏目录>");
        Console.WriteLine("      TesseraCiv6Extractor texture inspect --input <正式游戏目录>");
        Console.WriteLine("      TesseraCiv6Extractor extract --input <正式游戏目录> --output <输出目录> [--module-version <SemVer>]");
        return arguments.Length == 0 ? 2 : 0;
    }

    try
    {
        var command = arguments is ["catalog", "inspect", ..] ? "catalog-inspect"
            : arguments is ["art", "inspect", ..] ? "art-inspect"
            : arguments is ["texture", "inspect", ..] ? "texture-inspect"
            : arguments[0] is "inspect" or "extract" ? arguments[0]
            : "extract";
        var optionArguments = command is "catalog-inspect" or "art-inspect" or "texture-inspect" ? arguments[2..]
            : command == arguments[0] ? arguments[1..]
            : arguments;
        var options = ParseOptions(optionArguments, command);
        using var cancellation = new CancellationTokenSource();
        Console.CancelKeyPress += (_, eventArgs) =>
        {
            eventArgs.Cancel = true;
            cancellation.Cancel();
        };
        if (command == "inspect")
        {
            var inspection = await new Civ6InstallationProbe().InspectAsync(Require(options, "input"), cancellation.Token);
            Console.WriteLine(Serialize(new
            {
                ok = true,
                inspection.Storefront,
                inspection.GameVersion,
                inspection.VersionStatus,
                inspection.Files,
                inspection.Diagnostics,
            }));
            return 0;
        }

        if (command == "catalog-inspect")
        {
            var catalog = await new Civ6ExtractionService().InspectCatalogAsync(Require(options, "input"), cancellation.Token);
            Console.WriteLine(Serialize(new
            {
                ok = true,
                catalog.GameVersion,
                catalog.TotalCount,
                catalog.ChineseNameCount,
                catalog.FallbackNameCount,
                catalog.Categories,
                catalog.Diagnostics,
            }));
            return 0;
        }

        if (command == "art-inspect")
        {
            var art = await new Civ6ExtractionService().InspectArtAssetsAsync(Require(options, "input"), cancellation.Token);
            Console.WriteLine(Serialize(new
            {
                ok = true,
                art.GameVersion,
                art.TotalContentCount,
                art.MappedContentCount,
                art.ResolvedContainerCount,
                art.StaticImageExtractionAvailable,
                art.StaticImageBlockerCode,
                art.MaxReferenceDepth,
                art.Categories,
                art.Samples,
                art.Diagnostics,
            }));
            return 0;
        }

        if (command == "texture-inspect")
        {
            var texture = await new Civ6ExtractionService().InspectTextureContainersAsync(
                Require(options, "input"),
                cancellation.Token);
            Console.WriteLine(Serialize(new
            {
                ok = true,
                texture.GameVersion,
                texture.Blp,
                texture.CivBigSamples,
            }));
            return 0;
        }

        var service = new Civ6ExtractionService();
        var result = await service.ExtractAsync(new ExtractionRequest(
            Require(options, "input"),
            Require(options, "output"),
            options.GetValueOrDefault("module-version", "1.0.0"),
            typeof(Program).Assembly.GetName().Version?.ToString(3) ?? "1.0.0"), cancellation.Token);
        Console.WriteLine(Serialize(new
        {
            ok = true,
            outputWritten = true,
            moduleId = result.ModuleId,
            moduleVersion = result.ModuleVersion,
            elementCount = result.ElementCount,
            resourceCount = result.ResourceCount,
        }));
        return 0;
    }
    catch (OperationCanceledException)
    {
        Console.Error.WriteLine(Serialize(new { ok = false, code = "operation-cancelled" }));
        return 130;
    }
    catch (ExtractionException error)
    {
        Console.Error.WriteLine(Serialize(new
        {
            ok = false,
            code = error.Code,
            fieldPath = error.FieldPath,
            message = error.Message,
        }));
        return 2;
    }
    catch (Exception)
    {
        Console.Error.WriteLine(Serialize(new
        {
            ok = false,
            code = "unexpected-error",
            message = "发生未分类错误，未写入输出。",
        }));
        return 1;
    }
}

static Dictionary<string, string> ParseOptions(string[] arguments, string command)
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

    var supported = command is "inspect" or "catalog-inspect" or "art-inspect" or "texture-inspect"
        ? new HashSet<string>(["input"], StringComparer.Ordinal)
        : new HashSet<string>(["input", "output", "module-version"], StringComparer.Ordinal);
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

static string Serialize<T>(T value) => JsonSerializer.Serialize(value, new JsonSerializerOptions
{
    PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
});
