using System.Xml;
using System.Xml.Linq;

namespace Tessera.Civ6.Extractor.Core;

internal static class SecureXml
{
    public static XDocument Parse(byte[] bytes, string fieldPath, long maxCharacters = 16 * 1024 * 1024)
    {
        try
        {
            using var input = new MemoryStream(bytes, writable: false);
            using var reader = XmlReader.Create(input, new XmlReaderSettings
            {
                DtdProcessing = DtdProcessing.Prohibit,
                XmlResolver = null,
                MaxCharactersInDocument = maxCharacters,
                MaxCharactersFromEntities = 0,
            });
            return XDocument.Load(reader, LoadOptions.None);
        }
        catch (XmlException error)
        {
            throw new ExtractionException("input-xml-invalid", "输入 XML 无法安全解析。", fieldPath, error);
        }
    }
}
