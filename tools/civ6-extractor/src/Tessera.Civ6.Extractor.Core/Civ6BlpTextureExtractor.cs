using System.Buffers.Binary;
using System.IO.Compression;
using System.Xml.Linq;

namespace Tessera.Civ6.Extractor.Core;

/// <summary>保留铁路真实样本探针，但纹理目录和解码统一复用通用实现。</summary>
internal static class Civ6BlpTextureExtractor
{
    private const string RouteArtDefPath = "DLC/Expansion2/ArtDefs/Routes.artdef";
    private const string StrategicArtDefPath = "DLC/Expansion2/ArtDefs/StrategicView.artdef";
    private const string ContainerPath = "DLC/Expansion2/Platforms/Windows/BLPs/strategicview/strategicview_routes.blp";
    private const string PackageEntryName = "Railroad";

    public static async Task<Civ6BlpTextureInspection> InspectRailroadTextureAsync(
        SafeInputRoot input,
        CancellationToken cancellationToken)
    {
        await ValidateArtDefChainAsync(input, cancellationToken);
        var container = await Civ6BlpContainer.OpenAsync(input, ContainerPath, cancellationToken);
        var texture = await container.ReadPackageTextureAsync(
            PackageEntryName,
            "StrategicView_Route",
            cancellationToken);
        return new(
            texture.RelativePath,
            texture.EntryName,
            texture.DxgiFormat,
            texture.Width,
            texture.Height,
            texture.ArraySize,
            texture.MipCount,
            texture.PayloadBytes,
            texture.SlotOffset,
            texture.PrefixBytes);
    }

    private static async Task ValidateArtDefChainAsync(
        SafeInputRoot input,
        CancellationToken cancellationToken)
    {
        var routes = SecureXml.Parse(
            await input.ReadAllBytesAsync(RouteArtDefPath, cancellationToken),
            RouteArtDefPath);
        var route = FindRootElement(routes, "Route", "ROUTE_RAILROAD", RouteArtDefPath);
        var routeReferences = route.Descendants("Element")
            .Where(value =>
                (string?)value.Attribute("class") == "AssetObjects..ArtDefReferenceValue" &&
                Text(value, "m_ElementName") == "Railroad_Completed" &&
                Text(value, "m_RootCollectionName") == "Routes" &&
                Text(value, "m_ArtDefPath") == "StrategicView.artdef")
            .ToArray();
        if (routeReferences.Length != 1)
        {
            throw Unsupported(RouteArtDefPath);
        }

        var strategic = SecureXml.Parse(
            await input.ReadAllBytesAsync(StrategicArtDefPath, cancellationToken),
            StrategicArtDefPath);
        var completed = FindRootElement(strategic, "Routes", "Railroad_Completed", StrategicArtDefPath);
        var packageReferences = completed.Descendants("Element")
            .Where(value =>
                (string?)value.Attribute("class") == "AssetObjects..BLPEntryValue" &&
                Text(value, "m_EntryName") == PackageEntryName &&
                Text(value, "m_XLPClass") == "StrategicView_Route" &&
                Text(value, "m_XLPPath").Equals("strategicview_routes.xlp", StringComparison.OrdinalIgnoreCase) &&
                Text(value, "m_BLPPackage") == "strategicview/strategicview_routes")
            .ToArray();
        if (packageReferences.Length != 1)
        {
            throw Unsupported(StrategicArtDefPath);
        }
    }

    private static XElement FindRootElement(
        XDocument document,
        string collectionName,
        string name,
        string path)
    {
        var matches = document.Root?.Element("m_RootCollections")?.Elements("Element")
            .Where(value => Text(value, "m_CollectionName") == collectionName)
            .SelectMany(value => value.Elements("Element"))
            .Where(value => Text(value, "m_Name") == name)
            .ToArray() ?? [];
        if (matches.Length != 1)
        {
            throw Unsupported($"{path}/{collectionName}/{name}");
        }

        return matches[0];
    }

    private static string Text(XElement element, string childName) =>
        element.Element(childName)?.Attribute("text")?.Value ?? string.Empty;

    private static ExtractionException Unsupported(string path) =>
        new("asset-artdef-chain-unsupported", "铁路 ArtDef 没有已验证的 StrategicView 引用链。", path);
}

internal static class PngEncoder
{
    private static readonly byte[] Signature = [137, 80, 78, 71, 13, 10, 26, 10];

    public static byte[] EncodeRgba(int width, int height, ReadOnlySpan<byte> rgba)
    {
        if (width <= 0 || height <= 0 || rgba.Length != checked(width * height * 4))
        {
            throw new ArgumentException("RGBA 像素尺寸不匹配。", nameof(rgba));
        }

        using var output = new MemoryStream();
        output.Write(Signature);
        Span<byte> header = stackalloc byte[13];
        BinaryPrimitives.WriteUInt32BigEndian(header, checked((uint)width));
        BinaryPrimitives.WriteUInt32BigEndian(header[4..], checked((uint)height));
        header[8] = 8;
        header[9] = 6;
        WriteChunk(output, "IHDR"u8, header);

        using var compressed = new MemoryStream();
        using (var zlib = new ZLibStream(compressed, CompressionLevel.SmallestSize, leaveOpen: true))
        {
            for (var row = 0; row < height; row++)
            {
                zlib.WriteByte(0);
                zlib.Write(rgba.Slice(checked(row * width * 4), checked(width * 4)));
            }
        }

        WriteChunk(output, "IDAT"u8, compressed.ToArray());
        WriteChunk(output, "IEND"u8, []);
        return output.ToArray();
    }

    private static void WriteChunk(Stream output, ReadOnlySpan<byte> type, ReadOnlySpan<byte> data)
    {
        Span<byte> value = stackalloc byte[4];
        BinaryPrimitives.WriteUInt32BigEndian(value, checked((uint)data.Length));
        output.Write(value);
        output.Write(type);
        output.Write(data);
        var crc = 0xffffffffu;
        crc = UpdateCrc(crc, type);
        crc = UpdateCrc(crc, data) ^ 0xffffffffu;
        BinaryPrimitives.WriteUInt32BigEndian(value, crc);
        output.Write(value);
    }

    private static uint UpdateCrc(uint crc, ReadOnlySpan<byte> data)
    {
        foreach (var item in data)
        {
            crc ^= item;
            for (var bit = 0; bit < 8; bit++)
            {
                crc = (crc >> 1) ^ (0xedb88320u & unchecked((uint)-(int)(crc & 1)));
            }
        }

        return crc;
    }
}
