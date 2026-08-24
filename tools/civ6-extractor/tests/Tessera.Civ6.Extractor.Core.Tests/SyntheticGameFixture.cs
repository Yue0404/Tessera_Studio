using System.Security.Cryptography;
using System.Text;
using System.Globalization;

namespace Tessera.Civ6.Extractor.Core.Tests;

internal sealed class SyntheticGameFixture : IDisposable
{
    public SyntheticGameFixture(string storefront = "steam")
    {
        Root = Path.Combine(Path.GetTempPath(), "tessera-civ6-extractor-tests", Guid.NewGuid().ToString("N"));
        Input = Path.Combine(Root, "CivilizationVI");
        Output = Path.Combine(Root, "generated", "tessera.civ6");
        WriteInstallationBaseline(storefront);
        WriteContentBaseline();
        WriteArtDefBaseline();
    }

    public string Root { get; }

    public string Input { get; }

    public string Output { get; }

    public string ArchivePath => Path.Combine(
        Path.GetDirectoryName(Output)!,
        "tessera.civ6.tessera-module.zip");

    /// <summary>仅供测试读取正式 ZIP；生产提取流程不会留下展开目录。</summary>
    public void ExtractArchive(ExtractionResult result)
    {
        Assert.Equal(ArchivePath, result.ArchivePath);
        Assert.False(Directory.Exists(Output));
        System.IO.Compression.ZipFile.ExtractToDirectory(result.ArchivePath, Output);
    }

    public void ReplaceFile(string relativePath, string content) => WriteText(relativePath, content);

    public void ReplaceBinary(string relativePath, byte[] content) => WriteBytes(relativePath, content);

    public static byte[] CreateUiAtlasBlp() => CreateSyntheticUiAtlasBlp();

    public static byte[] CreatePackedUiAtlasBlp(
        uint descriptorIndex = 99,
        ushort blockIndexBytes = 8)
    {
        var bytes = CreateSyntheticUiAtlasBlp();
        WriteUInt32(bytes, 312, descriptorIndex);
        WriteUInt32(bytes, 336, 64);
        WriteUInt32(bytes, 340, blockIndexBytes | (2u << 16));
        WriteUInt32(bytes, 404, unchecked(descriptorIndex + 6));
        return bytes;
    }

    public void CreateSparseFile(string relativePath, long length)
    {
        var path = Path.Combine(Input, relativePath.Replace('/', Path.DirectorySeparatorChar));
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        using var stream = new FileStream(path, FileMode.Create, FileAccess.Write, FileShare.None);
        stream.SetLength(length);
    }

    public void DeleteFile(string relativePath) =>
        File.Delete(Path.Combine(Input, relativePath.Replace('/', Path.DirectorySeparatorChar)));

    public void DeleteExpansion(string expansion)
    {
        var path = Path.Combine(Input, "DLC", expansion);
        if (Directory.Exists(path))
        {
            Directory.Delete(path, recursive: true);
        }
    }

    public void AddModPollution() => WriteText("Mods/Untrusted/Gameplay/Data/Districts.xml", "<malicious />");

    public IReadOnlyDictionary<string, string> SnapshotInput()
    {
        return Directory.EnumerateFiles(Input, "*", SearchOption.AllDirectories)
            .ToDictionary(
                path => Path.GetRelativePath(Input, path).Replace('\\', '/'),
                path => Convert.ToHexString(SHA256.HashData(File.ReadAllBytes(path))),
                StringComparer.Ordinal);
    }

    public void Dispose()
    {
        if (Directory.Exists(Root))
        {
            Directory.Delete(Root, recursive: true);
        }
    }

    private void WriteInstallationBaseline(string storefront)
    {
        WriteText(
            "Base/Civ6.dep",
            "<AssetObjects..GameDependencyData><ID><name text=\"Civ6\"/><id text=\"cb2f71b7-843e-4af3-9ca7-992acda9c195\"/></ID></AssetObjects..GameDependencyData>");
        WriteText("Base/ArtDefs/Districts.artdef", "<AssetObjects..ArtDefSet />");
        WriteText("DLC/Expansion1/Expansion1.dep", "<AssetObjects..GameDependencyData />");
        WriteText("DLC/Expansion2/Expansion2.dep", "<AssetObjects..GameDependencyData />");
        WriteText(
            "DLC/Expansion1/Expansion1.modinfo",
            "<Mod id=\"1B28771A-C749-434B-9053-D1380C553DE9\" version=\"1\" />");
        WriteText(
            "DLC/Expansion2/Expansion2.modinfo",
            "<Mod id=\"4873eb62-8ccc-4574-b784-dda455e74e68\" version=\"1\" />");
        WriteText("DLC/Expansion1/ArtDefs/Districts.artdef", "<AssetObjects..ArtDefSet />");
        WriteText("DLC/Expansion2/ArtDefs/Districts.artdef", "<AssetObjects..ArtDefSet />");

        var binaryDirectory = storefront switch
        {
            "steam" => "Win64Steam",
            "epic" => "Win64EOS",
            "microsoft-store" => "Win64Microsoft",
            _ => throw new ArgumentOutOfRangeException(nameof(storefront)),
        };
        var executable = Environment.ProcessPath
            ?? throw new InvalidOperationException("测试进程没有可复制的合成可执行文件。");
        WriteBytes($"Base/Binaries/{binaryDirectory}/CivilizationVI.exe", File.ReadAllBytes(executable));
    }

    private void WriteContentBaseline()
    {
        foreach (var iconPath in ExtractionLayout.IconTablePaths)
        {
            WriteText(iconPath, "<GameInfo><IconTextureAtlases/><IconDefinitions/></GameInfo>");
        }

        WriteEntityFile("Base/Assets/Gameplay/Data/Terrains.xml", "Terrains", "TerrainType",
            ["TERRAIN_GRASS|LOC_TERRAIN_GRASS_NAME||"]);
        WriteEntityFile("Base/Assets/Gameplay/Data/Features.xml", "Features", "FeatureType",
            ["FEATURE_FOREST|LOC_FEATURE_FOREST_NAME||"]);
        WriteEntityFile("Base/Assets/Gameplay/Data/Resources.xml", "Resources", "ResourceType",
            ["RESOURCE_WHEAT|LOC_RESOURCE_WHEAT_NAME||"]);
        WriteEntityFile("Base/Assets/Gameplay/Data/Improvements.xml", "Improvements", "ImprovementType",
            ["IMPROVEMENT_FARM|LOC_IMPROVEMENT_FARM_NAME|LOC_IMPROVEMENT_FARM_DESCRIPTION|"]);
        WriteEntityFile("Base/Assets/Gameplay/Data/Districts.xml", "Districts", "DistrictType",
        [
            "DISTRICT_CITY_CENTER|LOC_DISTRICT_CITY_CENTER_NAME|LOC_DISTRICT_CITY_CENTER_DESCRIPTION|CityCenter=true",
            "DISTRICT_CAMPUS|LOC_DISTRICT_CAMPUS_NAME|LOC_DISTRICT_CAMPUS_DESCRIPTION|",
        ]);
        WriteEntityFile("Base/Assets/Gameplay/Data/Routes.xml", "Routes", "RouteType",
            ["ROUTE_ANCIENT_ROAD|LOC_ROUTE_ANCIENT_ROAD_NAME|LOC_ROUTE_ANCIENT_ROAD_DESCRIPTION|"]);
        WriteEntityFile("Base/Assets/Gameplay/Data/Buildings.xml", "Buildings", "BuildingType",
        [
            "BUILDING_PYRAMIDS|LOC_BUILDING_PYRAMIDS_NAME|LOC_BUILDING_PYRAMIDS_DESCRIPTION|IsWonder=true",
            "BUILDING_MONUMENT|LOC_BUILDING_MONUMENT_NAME||",
        ]);

        WriteEntityFile("DLC/Expansion1/Data/Expansion1_Features.xml", "Features", "FeatureType",
        [
            "FEATURE_GEOTHERMAL_FISSURE|LOC_FEATURE_GEOTHERMAL_FISSURE_NAME||",
            "FEATURE_SYNTHETIC_NATURAL_WONDER|LOC_FEATURE_SYNTHETIC_NATURAL_WONDER_NAME|LOC_FEATURE_SYNTHETIC_NATURAL_WONDER_DESCRIPTION|NaturalWonder=true;Tiles=3",
        ]);
        WriteEntityFile("DLC/Expansion1/Data/Expansion1_Resources.xml", "Resources", "ResourceType",
            ["RESOURCE_AMBER|LOC_RESOURCE_AMBER_NAME||"]);
        WriteEntityFile("DLC/Expansion1/Data/Expansion1_Improvements.xml", "Improvements", "ImprovementType",
            ["IMPROVEMENT_FISHERY|LOC_IMPROVEMENT_FISHERY_NAME|LOC_IMPROVEMENT_FISHERY_DESCRIPTION|"]);
        WriteText("DLC/Expansion1/Data/Expansion1_Districts.xml", """
            <GameInfo>
              <Types><Row Type="DISTRICT_GOVERNMENT" /></Types>
              <Districts>
                <Row DistrictType="DISTRICT_GOVERNMENT" Name="LOC_DISTRICT_GOVERNMENT_NAME" Description="LOC_DISTRICT_CAMPUS_EXP1_DESCRIPTION" />
                <Update><Where DistrictType="DISTRICT_CAMPUS"/><Set Description="LOC_DISTRICT_CAMPUS_EXP1_DESCRIPTION"/></Update>
              </Districts>
            </GameInfo>
            """);
        WriteEntityFile("DLC/Expansion1/Data/Expansion1_Buildings.xml", "Buildings", "BuildingType",
            ["BUILDING_KILWA_KISIWANI|LOC_BUILDING_KILWA_KISIWANI_NAME|LOC_BUILDING_KILWA_KISIWANI_DESCRIPTION|IsWonder=true"]);

        WriteText("DLC/Expansion2/Data/Expansion2_Features.xml", """
            <GameInfo>
              <Types><Row Type="FEATURE_VOLCANO" /></Types>
              <Features>
                <Row FeatureType="FEATURE_VOLCANO" Name="LOC_FEATURE_VOLCANO_NAME" />
                <Update><Where FeatureType="FEATURE_FOREST"/><Set Name="LOC_FEATURE_FOREST_XP2_NAME"/></Update>
              </Features>
            </GameInfo>
            """);
        WriteText("DLC/Expansion2/Data/Expansion2_Resources.xml", """
            <GameInfo><Resources><Update><Where ResourceType="RESOURCE_WHEAT"/><Set Name="LOC_RESOURCE_WHEAT_XP2_NAME"/></Update></Resources></GameInfo>
            """);
        WriteEntityFile("DLC/Expansion2/Data/Expansion2_Improvements.xml", "Improvements", "ImprovementType",
            ["IMPROVEMENT_SKI_RESORT|LOC_IMPROVEMENT_SKI_RESORT_NAME|LOC_IMPROVEMENT_SKI_RESORT_DESCRIPTION|"]);
        WriteText("DLC/Expansion2/Data/Expansion2_Districts.xml", """
            <GameInfo>
              <Types><Row Type="DISTRICT_CANAL" /></Types>
              <Districts>
                <Row DistrictType="DISTRICT_CANAL" Name="LOC_DISTRICT_CANAL_NAME" Description="LOC_DISTRICT_CANAL_DESCRIPTION" />
                <Update><Where Description="LOC_DISTRICT_CAMPUS_EXP1_DESCRIPTION"/><Set Description="LOC_DISTRICT_CAMPUS_XP2_DESCRIPTION"/></Update>
              </Districts>
            </GameInfo>
            """);
        WriteEntityFile("DLC/Expansion2/Data/Expansion2_Routes.xml", "Routes", "RouteType",
            ["ROUTE_RAILROAD|LOC_ROUTE_RAILROAD_NAME|LOC_ROUTE_RAILROAD_DESCRIPTION|"]);
        WriteEntityFile("DLC/Expansion2/Data/Expansion2_Buildings.xml", "Buildings", "BuildingType",
            ["BUILDING_GOLDEN_GATE_BRIDGE|LOC_BUILDING_GOLDEN_GATE_BRIDGE_NAME|LOC_BUILDING_GOLDEN_GATE_BRIDGE_DESCRIPTION|IsWonder=true"]);

        WriteLocalization("Base/Assets/Text/Vanilla_zh_Hans_CN.xml",
        [
            ("LOC_TERRAIN_GRASS_NAME", "草原"), ("LOC_FEATURE_FOREST_NAME", "森林"),
            ("LOC_RESOURCE_WHEAT_NAME", "小麦"), ("LOC_IMPROVEMENT_FARM_NAME", "农场"),
            ("LOC_IMPROVEMENT_FARM_DESCRIPTION", "基础改良"), ("LOC_DISTRICT_CITY_CENTER_NAME", "市中心"),
            ("LOC_DISTRICT_CITY_CENTER_DESCRIPTION", "城市核心"), ("LOC_DISTRICT_CAMPUS_NAME", "学院"),
            ("LOC_DISTRICT_CAMPUS_DESCRIPTION", "基础学院"), ("LOC_ROUTE_ANCIENT_ROAD_NAME", "古典道路"),
            ("LOC_ROUTE_ANCIENT_ROAD_DESCRIPTION", "基础路线"), ("LOC_BUILDING_PYRAMIDS_NAME", "金字塔"),
            ("LOC_BUILDING_PYRAMIDS_DESCRIPTION", "世界奇观"),
        ]);
        WriteLocalization("DLC/Expansion1/Text/Expansion1_Translations_Text.xml",
        [
            ("LOC_FEATURE_GEOTHERMAL_FISSURE_NAME", "地热裂缝"),
            ("LOC_FEATURE_SYNTHETIC_NATURAL_WONDER_NAME", "合成多格自然奇观"),
            ("LOC_FEATURE_SYNTHETIC_NATURAL_WONDER_DESCRIPTION", "用于验证域组输出"),
            ("LOC_RESOURCE_AMBER_NAME", "琥珀"),
            ("LOC_IMPROVEMENT_FISHERY_NAME", "渔场"), ("LOC_IMPROVEMENT_FISHERY_DESCRIPTION", "水上改良"),
            ("LOC_DISTRICT_GOVERNMENT_NAME", "市政广场"), ("LOC_DISTRICT_GOVERNMENT_DESCRIPTION", "政府区域"),
            ("LOC_DISTRICT_CAMPUS_EXP1_DESCRIPTION", "扩展后的学院"),
        ]);
        WriteLocalization("DLC/Expansion1/Text/Expansion1_Translations_Major_Text.xml",
        [
            ("LOC_BUILDING_KILWA_KISIWANI_NAME", "基尔瓦基斯瓦尼"),
            ("LOC_BUILDING_KILWA_KISIWANI_DESCRIPTION", "扩展奇观"),
        ]);
        WriteLocalization("DLC/Expansion2/Text/Expansion2_Translations_Text.xml",
        [
            ("LOC_FEATURE_VOLCANO_NAME", "火山"), ("LOC_FEATURE_FOREST_XP2_NAME", "森林（风云变幻）"),
            ("LOC_RESOURCE_WHEAT_XP2_NAME", "小麦（风云变幻）"), ("LOC_IMPROVEMENT_SKI_RESORT_NAME", "滑雪场"),
            ("LOC_IMPROVEMENT_SKI_RESORT_DESCRIPTION", "山地改良"), ("LOC_DISTRICT_CANAL_NAME", "运河"),
            ("LOC_DISTRICT_CANAL_DESCRIPTION", "水路区域"), ("LOC_ROUTE_RAILROAD_NAME", "铁路"),
            ("LOC_DISTRICT_CAMPUS_XP2_DESCRIPTION", "风云变幻后的学院"),
            ("LOC_ROUTE_RAILROAD_DESCRIPTION", "工业路线"), ("LOC_BUILDING_GOLDEN_GATE_BRIDGE_NAME", "金门大桥"),
            ("LOC_BUILDING_GOLDEN_GATE_BRIDGE_DESCRIPTION", "扩展奇观"),
        ]);
    }

    private void WriteArtDefBaseline()
    {
        WriteArtDef("Base/ArtDefs/Terrains.artdef", "Terrain", ["TERRAIN_GRASS"]);
        WriteArtDef("Base/ArtDefs/Features.artdef", "Feature", ["FEATURE_FOREST"]);
        WriteArtDef("Base/ArtDefs/Improvements.artdef", "Improvement", ["IMPROVEMENT_FARM"]);
        WriteArtDef("Base/ArtDefs/Districts.artdef", "District", ["DISTRICT_CITY_CENTER", "DISTRICT_CAMPUS"]);
        WriteArtDef("Base/ArtDefs/Routes.artdef", "Route", ["ROUTE_ANCIENT_ROAD"]);
        WriteArtDef("Base/ArtDefs/Buildings.artdef", "Building", ["BUILDING_PYRAMIDS"]);
        WriteText("Base/ArtDefs/Resources.artdef", ArtDefDocument("Resource", """
            <Element>
              <m_Fields><m_Values /></m_Fields>
              <m_ChildCollections><Element><m_CollectionName text="Clutter"/><m_ReplaceMergedCollectionElements>false</m_ReplaceMergedCollectionElements><Element><m_Fields><m_Values>
                <Element class="AssetObjects..StringValue"><m_Value text="CLUTTER_WHEAT"/><m_ParamName text="XrefName"/></Element>
                <Element class="AssetObjects..ArtDefReferenceValue"><m_ElementName text=""/><m_RootCollectionName text=""/><m_ArtDefPath text="Clutter.artdef"/><m_ParamName text="Xref"/></Element>
              </m_Values></m_Fields><m_ChildCollections/><m_Name text="Clutter001"/></Element></Element></m_ChildCollections>
              <m_Name text="RESOURCE_WHEAT"/>
            </Element>
            """));
        WriteText("Base/ArtDefs/Clutter.artdef", ArtDefDocument("ClutterSets", """
            <Element><m_Fields><m_Values>
              <Element class="AssetObjects..BLPEntryValue"><m_EntryName text="RES_Wheat_Tuft04"/><m_XLPClass text="Landmark"/><m_XLPPath text="clutter.xlp"/><m_BLPPackage text="environment/clutter"/><m_LibraryName text="Landmark"/><m_ParamName text="Asset"/></Element>
            </m_Values></m_Fields><m_ChildCollections/><m_Name text="CLUTTER_WHEAT"/></Element>
            """));

        WriteArtDef(
            "DLC/Expansion1/ArtDefs/Features.artdef",
            "Feature",
            ["FEATURE_GEOTHERMAL_FISSURE", "FEATURE_SYNTHETIC_NATURAL_WONDER"]);
        WriteArtDef("DLC/Expansion1/ArtDefs/Resources.artdef", "Resource", ["RESOURCE_AMBER"]);
        WriteArtDef("DLC/Expansion1/ArtDefs/Improvements.artdef", "Improvement", ["IMPROVEMENT_FISHERY"]);
        WriteArtDef("DLC/Expansion1/ArtDefs/Districts.artdef", "District", ["DISTRICT_GOVERNMENT"]);
        WriteArtDef("DLC/Expansion1/ArtDefs/Buildings.artdef", "Building", ["BUILDING_KILWA_KISIWANI"]);

        WriteArtDef("DLC/Expansion2/ArtDefs/Terrains.artdef", "Terrain", []);
        WriteArtDef("DLC/Expansion2/ArtDefs/Features.artdef", "Feature", ["FEATURE_VOLCANO"]);
        WriteArtDef("DLC/Expansion2/ArtDefs/Resources.artdef", "Resource", []);
        WriteArtDef("DLC/Expansion2/ArtDefs/Improvements.artdef", "Improvement", ["IMPROVEMENT_SKI_RESORT"]);
        WriteArtDef("DLC/Expansion2/ArtDefs/Districts.artdef", "District", ["DISTRICT_CANAL"]);
        WriteText("DLC/Expansion2/ArtDefs/Routes.artdef", ArtDefDocument("Route", """
            <Element><m_Fields><m_Values /></m_Fields><m_ChildCollections><Element>
              <m_CollectionName text="StrategicView"/><m_ReplaceMergedCollectionElements>false</m_ReplaceMergedCollectionElements>
              <Element><m_Fields><m_Values><Element class="AssetObjects..ArtDefReferenceValue">
                <m_ElementName text="Railroad_Completed"/><m_RootCollectionName text="Routes"/>
                <m_ArtDefPath text="StrategicView.artdef"/><m_ParamName text="XrefName"/>
              </Element></m_Values></m_Fields><m_ChildCollections/><m_Name text="EXP2_Routes_StrategicView"/></Element>
            </Element></m_ChildCollections><m_Name text="ROUTE_RAILROAD"/></Element>
            """));
        WriteText("DLC/Expansion2/ArtDefs/StrategicView.artdef", ArtDefDocument("Routes", """
            <Element><m_Fields><m_Values><Element class="AssetObjects..BLPEntryValue">
              <m_EntryName text="Railroad"/><m_XLPClass text="StrategicView_Route"/>
              <m_XLPPath text="strategicview_routes.xlp"/><m_BLPPackage text="strategicview/strategicview_routes"/>
              <m_LibraryName text="StrategicView_Route"/><m_ParamName text="RouteXLPEntry"/>
            </Element></m_Values></m_Fields><m_ChildCollections/><m_Name text="Railroad_Completed"/></Element>
            """));
        WriteArtDef("DLC/Expansion2/ArtDefs/Buildings.artdef", "Building", ["BUILDING_GOLDEN_GATE_BRIDGE"]);

        var civBlpHeader = new byte[] { 0x43, 0x49, 0x56, 0x42, 0x4c, 0x50, 0x02, 0x00 };
        WriteBytes("Base/Platforms/Windows/BLPs/environment/clutter.blp", civBlpHeader);
        WriteBytes("Base/Platforms/Windows/BLPs/UI/Icons.blp", civBlpHeader);
        WriteBytes("DLC/Expansion1/Platforms/Windows/BLPs/UI/Icons.blp", civBlpHeader);
        WriteBytes("DLC/Expansion2/Platforms/Windows/BLPs/UI/Icons.blp", civBlpHeader);
        WriteBytes(
            "DLC/Expansion2/Platforms/Windows/BLPs/strategicview/strategicview_routes.blp",
            CreateSyntheticRailroadBlp());
    }

    private static byte[] CreateSyntheticRailroadBlp()
    {
        const int dataStart = 2048;
        const int slotBytes = 32;
        const int descriptorOffset = 512;
        var bytes = new byte[dataStart + slotBytes * 2];
        "CIVBLP\u0002\u0000"u8.CopyTo(bytes);
        WriteUInt32(bytes, 8, 1024);
        WriteUInt32(bytes, 12, 1024);
        WriteUInt32(bytes, 16, dataStart);
        WriteUInt32(bytes, 20, 2);
        WriteUInt32(bytes, 24, bytes.Length);
        WriteAscii(bytes, 256, "Railroad");
        WriteAscii(bytes, 280, "Railroad_Visible");
        WriteAscii(bytes, 312, "Railroad_Revealed");
        WriteAscii(bytes, 120, "RailroadSprite");
        WriteAscii(bytes, 160, "SyntheticAtlas");
        // 正式 StrategicView_Sprite 包条目直接保存一个 (type=2,index) 纹理指针。
        WriteUInt32(bytes, 352, Fnv1a("RailroadSprite"));
        WriteUInt32(bytes, 368, 2);
        WriteUInt32(bytes, 372, 0);
        // 正式 StrategicView_Route 包条目以两个显式 (type=2,index) 指针关联
        // Visible 与 Revealed 纹理；夹具不再依赖名称后缀推断。
        WriteUInt32(bytes, 400, Fnv1a("Railroad"));
        WriteUInt32(bytes, 416, 23);
        WriteUInt32(bytes, 432, 2);
        WriteUInt32(bytes, 436, 0);
        WriteUInt32(bytes, 440, 2);
        WriteUInt32(bytes, 444, 1);
        // 正式 UITexture 逻辑条目直接保存一个 (type=2,index) 纹理指针。
        WriteUInt32(bytes, 672, Fnv1a("SyntheticAtlas"));
        WriteUInt32(bytes, 680, 2);
        WriteUInt32(bytes, 684, 0);
        WriteDescriptor(bytes, descriptorOffset, "Railroad_Visible", 0);
        WriteDescriptor(bytes, descriptorOffset + 104, "Railroad_Revealed", slotBytes);
        WriteSolidBc2Block(bytes.AsSpan(dataStart + 16, 16), 0xf800);
        WriteSolidBc2Block(bytes.AsSpan(dataStart + slotBytes + 16, 16), 0x07e0);
        return bytes;
    }

    private static byte[] CreateSyntheticUiAtlasBlp()
    {
        const int dataStart = 2048;
        const int descriptorOffset = 512;
        const int width = 8;
        const int height = 8;
        const int payloadBytes = width * height * 4;
        var bytes = new byte[dataStart + payloadBytes];
        "CIVBLP\u0002\u0000"u8.CopyTo(bytes);
        WriteUInt32(bytes, 8, 1024);
        WriteUInt32(bytes, 12, 1024);
        WriteUInt32(bytes, 16, dataStart);
        WriteUInt32(bytes, 20, 1);
        WriteUInt32(bytes, 24, bytes.Length);
        WriteAscii(bytes, 120, "SyntheticAtlas");
        WriteAscii(bytes, 160, "Page_0");
        WriteUInt32(bytes, 300, Fnv1a("SyntheticAtlas"));
        WriteUInt32(bytes, 308, 2);
        WriteUInt32(bytes, 312, 0);
        WriteUInt64(bytes, descriptorOffset - 16, 0);
        WriteUInt64(bytes, descriptorOffset - 8, payloadBytes);
        WriteUInt32(bytes, descriptorOffset, Fnv1a("Page_0"));
        WriteUInt16(bytes, descriptorOffset + 40, 28);
        WriteUInt16(bytes, descriptorOffset + 42, width);
        WriteUInt16(bytes, descriptorOffset + 44, height);
        WriteUInt16(bytes, descriptorOffset + 46, 1);
        WriteUInt16(bytes, descriptorOffset + 48, 1);
        WriteUInt16(bytes, descriptorOffset + 50, 1);
        var payload = bytes.AsSpan(dataStart, payloadBytes);
        for (var y = 0; y < height; y++)
        {
            for (var x = 0; x < width; x++)
            {
                var color = (x < 4, y < 4) switch
                {
                    (true, true) => new byte[] { 255, 0, 0, 255 },
                    (false, true) => new byte[] { 0, 255, 0, 255 },
                    (true, false) => new byte[] { 0, 0, 255, 255 },
                    _ => new byte[] { 255, 255, 255, 0 },
                };
                color.CopyTo(payload.Slice((y * width + x) * 4, 4));
            }
        }

        return bytes;
    }

    private static void WriteDescriptor(byte[] bytes, int hashOffset, string name, int slotOffset)
    {
        WriteUInt64(bytes, hashOffset - 16, checked((ulong)slotOffset));
        WriteUInt64(bytes, hashOffset - 8, 16);
        WriteUInt32(bytes, hashOffset, Fnv1a(name));
        WriteUInt16(bytes, hashOffset + 40, 74);
        WriteUInt16(bytes, hashOffset + 42, 4);
        WriteUInt16(bytes, hashOffset + 44, 4);
        WriteUInt16(bytes, hashOffset + 46, 1);
        WriteUInt16(bytes, hashOffset + 48, 1);
        WriteUInt16(bytes, hashOffset + 50, 1);
    }

    private static void WriteSolidBc2Block(Span<byte> block, ushort rgb565)
    {
        block[..8].Fill(0xff);
        System.Buffers.Binary.BinaryPrimitives.WriteUInt16LittleEndian(block[8..], rgb565);
        System.Buffers.Binary.BinaryPrimitives.WriteUInt16LittleEndian(block[10..], rgb565);
    }

    private static void WriteAscii(byte[] bytes, int offset, string value) =>
        Encoding.ASCII.GetBytes(value + "\0").CopyTo(bytes, offset);

    private static void WriteUInt16(byte[] bytes, int offset, ushort value) =>
        System.Buffers.Binary.BinaryPrimitives.WriteUInt16LittleEndian(bytes.AsSpan(offset), value);

    private static void WriteUInt32(byte[] bytes, int offset, int value) =>
        System.Buffers.Binary.BinaryPrimitives.WriteUInt32LittleEndian(bytes.AsSpan(offset), checked((uint)value));

    private static void WriteUInt32(byte[] bytes, int offset, uint value) =>
        System.Buffers.Binary.BinaryPrimitives.WriteUInt32LittleEndian(bytes.AsSpan(offset), value);

    private static void WriteUInt64(byte[] bytes, int offset, ulong value) =>
        System.Buffers.Binary.BinaryPrimitives.WriteUInt64LittleEndian(bytes.AsSpan(offset), value);

    private static uint Fnv1a(string value)
    {
        var hash = 2166136261u;
        foreach (var item in Encoding.UTF8.GetBytes(value))
        {
            hash = unchecked((hash ^ item) * 16777619u);
        }

        return hash;
    }

    private void WriteArtDef(string relativePath, string collection, IReadOnlyList<string> names)
    {
        var elements = string.Join(string.Empty, names.Select(name => $"""
            <Element><m_Fields><m_Values>
              <Element class="AssetObjects..BLPEntryValue"><m_EntryName text="{name}_ICON"/><m_XLPClass text="UITexture"/><m_XLPPath text="icons.xlp"/><m_BLPPackage text="UI/Icons"/><m_LibraryName text="UITexture"/><m_ParamName text="Texture"/></Element>
            </m_Values></m_Fields><m_ChildCollections/><m_Name text="{name}"/></Element>
            """));
        WriteText(relativePath, ArtDefDocument(collection, elements));
    }

    private static string ArtDefDocument(string collection, string elements) => $"""
        <AssetObjects..ArtDefSet>
          <m_Version><major>4</major><minor>0</minor></m_Version>
          <m_TemplateName text="{collection}"/>
          <m_RootCollections><Element><m_CollectionName text="{collection}"/><m_ReplaceMergedCollectionElements>false</m_ReplaceMergedCollectionElements>{elements}</Element></m_RootCollections>
        </AssetObjects..ArtDefSet>
        """;

    private void WriteEntityFile(string relativePath, string table, string primaryKey, IReadOnlyList<string> rows)
    {
        var typeRows = new StringBuilder();
        var entityRows = new StringBuilder();
        foreach (var encoded in rows)
        {
            var parts = encoded.Split('|');
            typeRows.Append(CultureInfo.InvariantCulture, $"<Row Type=\"{parts[0]}\" />");
            entityRows.Append(CultureInfo.InvariantCulture, $"<Row {primaryKey}=\"{parts[0]}\" Name=\"{parts[1]}\"");
            if (!string.IsNullOrEmpty(parts[2]))
            {
                entityRows.Append(CultureInfo.InvariantCulture, $" Description=\"{parts[2]}\"");
            }

            if (!string.IsNullOrEmpty(parts[3]))
            {
                foreach (var attribute in parts[3].Split(';', StringSplitOptions.RemoveEmptyEntries))
                {
                    var pair = attribute.Split('=', 2);
                    entityRows.Append(CultureInfo.InvariantCulture, $" {pair[0]}=\"{pair[1]}\"");
                }
            }

            entityRows.Append(" />");
        }

        WriteText(relativePath, $"<GameInfo><Types>{typeRows}</Types><{table}>{entityRows}</{table}></GameInfo>");
    }

    private void WriteLocalization(string relativePath, IReadOnlyList<(string Key, string Text)> entries)
    {
        var rows = string.Join(string.Empty, entries.Select(value =>
            $"<Replace Tag=\"{value.Key}\" Language=\"zh_Hans_CN\"><Text>{value.Text}</Text></Replace>"));
        WriteText(relativePath, $"<GameData><LocalizedText>{rows}</LocalizedText></GameData>");
    }

    private void WriteText(string relativePath, string content) => WriteBytes(relativePath, Encoding.UTF8.GetBytes(content));

    private void WriteBytes(string relativePath, byte[] bytes)
    {
        var path = Path.Combine(Input, relativePath.Replace('/', Path.DirectorySeparatorChar));
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        File.WriteAllBytes(path, bytes);
    }
}

internal sealed class FixedTimeProvider(DateTimeOffset value) : TimeProvider
{
    public override DateTimeOffset GetUtcNow() => value;
}

internal sealed class RejectingOutputValidator : IPackageOutputValidator
{
    public Task ValidateAsync(string packageDirectory, CancellationToken cancellationToken) =>
        throw new ExtractionException("test-validation-failed", "测试要求拒绝 staging。", "package");
}

internal sealed class FixedVersionReader(string? version) : ICiv6InstallationVersionReader
{
    public ValueTask<string?> ReadVersionAsync(string executablePath, CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        return ValueTask.FromResult(version);
    }
}
