export interface OoxmlPackageEntry {
  path: string;
  text?: string;
}

const PART_RULES: Array<[RegExp, string]> = [
  [/^_xmlsignatures\//i, "digital signatures"],
  [/^xl\/vbaProjectSignature\.bin$/i, "digital signatures"],
  [/^xl\/vbaProject\.bin$/i, "VBA macros"],
  [/^xl\/charts\//i, "charts"],
  [/^xl\/pivotTables\//i, "pivot tables"],
  [/^xl\/pivotCache\//i, "pivot caches"],
  [/^xl\/externalLinks\//i, "external workbook link metadata"],
  [/^xl\/connections\.xml$/i, "external data connections"],
  [/^xl\/queryTables\//i, "query tables"],
  [/^xl\/embeddings\//i, "embedded objects"],
  [/^xl\/activeX\//i, "ActiveX controls"],
  [/^xl\/ctrlProps\//i, "form controls"],
  [/^xl\/slicers?\//i, "slicers"],
  [/^xl\/slicerCaches\//i, "slicer caches"],
  [/^xl\/threadedComments\//i, "threaded comments"],
  [/^xl\/comments\d*\.xml$/i, "cell comments"],
  [/^xl\/webExtensions\//i, "web extensions"],
  [/^customXml\//i, "custom XML"],
];

const TAG_RULES: Array<[RegExp, string]> = [
  [/<(?:[A-Za-z0-9_]+:)?conditionalFormatting\b/i, "conditional formatting"],
  [/<(?:[A-Za-z0-9_]+:)?dataValidations\b/i, "data validation rules"],
  [/<(?:[A-Za-z0-9_]+:)?hyperlinks\b/i, "hyperlinks"],
  [/<(?:[A-Za-z0-9_]+:)?drawing\b|<(?:[A-Za-z0-9_]+:)?legacyDrawing\b/i, "drawings and embedded images"],
  [/<(?:[A-Za-z0-9_]+:)?oleObjects\b/i, "embedded objects"],
  [/<(?:[A-Za-z0-9_]+:)?controls\b/i, "form controls"],
  [/<(?:[A-Za-z0-9_]+:)?extLst\b/i, "OOXML extension data"],
];

const RELATIONSHIP_RULES: Array<[RegExp, string]> = [
  [/\/digital-signature\//i, "digital signatures"],
  [/\/vbaProject$/i, "VBA macros"],
  [/\/chart$/i, "charts"],
  [/\/pivotTable$/i, "pivot tables"],
  [/\/pivotCacheDefinition$/i, "pivot caches"],
  [/\/externalLink$/i, "external workbook link metadata"],
  [/\/connections$/i, "external data connections"],
  [/\/queryTable$/i, "query tables"],
  [/\/oleObject$/i, "embedded objects"],
  [/\/control$/i, "form controls"],
  [/\/hyperlink$/i, "hyperlinks"],
  [/\/drawing$/i, "drawings and embedded images"],
  [/\/comments$/i, "cell comments"],
  [/\/threadedComment$/i, "threaded comments"],
  [/\/slicer$/i, "slicers"],
  [/\/slicerCache$/i, "slicer caches"],
];

function attribute(tag: string, name: string): string | undefined {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return tag.match(new RegExp("(?:^|\\s)" + escaped + "\\s*=\\s*(['\"])(.*?)\\1", "i"))?.[2];
}

/**
 * Conservative OOXML feature detector. It uses both part names and relationship/content-type
 * declarations because valid packages can rename relationship targets. Any returned feature is
 * treated as unsupported by the reduced WorkbookModel serializer and must block destructive export.
 * This is detection, not a claim that the library can preserve the feature.
 */
export function detectOoxmlUnsupportedFeatures(entries: OoxmlPackageEntry[]): string[] {
  const features = new Set<string>();
  const normalized = entries.map(entry => ({ ...entry, path: entry.path.replace(/^\/+/, "") }));
  const byPath = new Map(normalized.map(entry => [entry.path.toLowerCase(), entry] as const));
  for (const entry of normalized) {
    for (const [pattern, feature] of PART_RULES) {
      if (pattern.test(entry.path)) {
        if (typeof feature === "string") features.add(feature);
      }
    }
    const text = entry.text ?? "";
    if (/^xl\/worksheets\/sheet\d+\.xml$/i.test(entry.path)) {
      for (const [pattern, feature] of TAG_RULES) if (pattern.test(text)) features.add(feature);
      if (/<(?:[A-Za-z0-9_]+:)?sheetProtection\b/i.test(text)) features.add("worksheet protection");
      if (/<(?:[A-Za-z0-9_]+:)?pane\b/i.test(text)) features.add("frozen panes");
    }
    if (/^xl\/workbook\.xml$/i.test(entry.path)) {
      if (/<(?:[A-Za-z0-9_]+:)?workbookProtection\b/i.test(text)) features.add("workbook protection");
      if (/<(?:[A-Za-z0-9_]+:)?extLst\b/i.test(text)) features.add("OOXML extension data");
    }
    if (/\.rels$/i.test(entry.path)) {
      for (const match of text.matchAll(/<Relationship\b[^>]*>/gi)) {
        const type = attribute(match[0], "Type") ?? "";
        const target = attribute(match[0], "Target") ?? "";
        for (const [pattern, feature] of RELATIONSHIP_RULES) if (pattern.test(type)) features.add(feature);
        if (/^https?:/i.test(target) && /\/hyperlink$/i.test(type)) features.add("hyperlinks");
      }
    }
    if (/^\[Content_Types\]\.xml$/i.test(entry.path)) {
      if (/vbaProject/i.test(text)) features.add("VBA macros");
      if (/digital-signature/i.test(text)) features.add("digital signatures");
      if (/pivotCacheDefinition/i.test(text)) features.add("pivot caches");
      if (/pivotTable/i.test(text)) features.add("pivot tables");
      if (/queryTable/i.test(text)) features.add("query tables");
      // Do not match the standard OOXML namespace "…/package/…"; classify only explicit OLE/package parts or content types.
      if (/oleObject/i.test(text) || /PartName=["\'][^"\']*(?:embeddings|oleObject)/i.test(text)) features.add("embedded objects");
    }
  }

  // A relationship can reference a feature-bearing part whose filename is not conventional.
  // Resolve internal targets against the source part's directory and classify by relationship type.
  for (const entry of normalized.filter(item => /\.rels$/i.test(item.path))) {
    const sourcePath = entry.path === "_rels/.rels"
      ? ""
      : entry.path.replace(/(^|\/)\_rels\//, "$1").replace(/\.rels$/i, "");
    for (const match of (entry.text ?? "").matchAll(/<Relationship\b[^>]*>/gi)) {
      const type = attribute(match[0], "Type") ?? "";
      const target = attribute(match[0], "Target") ?? "";
      if (!target || /^https?:/i.test(target) || target.startsWith("/")) continue;
      const base = sourcePath.includes("/") ? sourcePath.slice(0, sourcePath.lastIndexOf("/") + 1) : "";
      const segments: string[] = [];
      for (const part of (base + target).split("/")) {
        if (!part || part === ".") continue;
        if (part === "..") segments.pop(); else segments.push(part);
      }
      const targetEntry = byPath.get(segments.join("/").toLowerCase());
      if (targetEntry) {
        const targetPath = targetEntry.path.toLowerCase();
        if (targetPath.includes("vba") || /\/vbaProject$/i.test(type)) features.add("VBA macros");
        if (targetPath.includes("signature") || /digital-signature/i.test(type)) features.add("digital signatures");
        if (targetPath.includes("pivotcache")) features.add("pivot caches");
        if (targetPath.includes("pivottable")) features.add("pivot tables");
        if (targetPath.includes("querytable")) features.add("query tables");
        if (targetPath.includes("embedding") || targetPath.includes("oleobject")) features.add("embedded objects");
      }
    }
  }
  return [...features].sort();
}
