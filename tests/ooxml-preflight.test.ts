import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { detectOoxmlUnsupportedFeatures } from "../src/lib/excel/ooxml-preflight";

describe("relationship-aware OOXML preflight", () => {
  it("detects workbook features from relationship types even when target names are nonstandard", () => {
    const features = detectOoxmlUnsupportedFeatures([
      { path: "xl/worksheets/sheet1.xml", text: '<worksheet><conditionalFormatting/><dataValidations/><hyperlinks/></worksheet>' },
      { path: "xl/worksheets/_rels/sheet1.xml.rels", text: '<Relationships><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart" Target="../charts/custom-chart.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="https://example.com" TargetMode="External"/></Relationships>' },
      { path: "xl/charts/custom-chart.xml", text: "<chartSpace/>" },
      { path: "[Content_Types].xml", text: '<Types><Override PartName="/xl/charts/custom-chart.xml" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"/></Types>' }
    ]);
    assert.ok(features.includes("charts"), features.join(", "));
    assert.ok(features.includes("hyperlinks"), features.join(", "));
    assert.ok(features.includes("conditional formatting"), features.join(", "));
    assert.ok(features.includes("data validation rules"), features.join(", "));
  });

  it("detects VBA, digital signatures, pivot caches, query tables and embedded objects", () => {
    const features = detectOoxmlUnsupportedFeatures([
      { path: "xl/vbaProject.bin" },
      { path: "_xmlsignatures/sig1.xml", text: "<Signature/>" },
      { path: "xl/pivotCache/custom-cache.xml" },
      { path: "xl/queryTables/queryTable1.xml" },
      { path: "xl/embeddings/oleObject1.bin" },
      { path: "[Content_Types].xml", text: '<Types><Default Extension="bin" ContentType="application/vnd.ms-office.vbaProject"/><Override PartName="/_xmlsignatures/sig1.xml" ContentType="application/vnd.openxmlformats-package.digital-signature-xmlsignature+xml"/></Types>' }
    ]);
    for (const feature of ["VBA macros", "digital signatures", "pivot caches", "query tables", "embedded objects"]) {
      assert.ok(features.includes(feature), "missing " + feature + ": " + features.join(", "));
    }
  });

  it("recognizes feature relationships even when the target part is renamed", () => {
    const features = detectOoxmlUnsupportedFeatures([
      { path: "xl/workbook.xml" },
      { path: "xl/_rels/workbook.xml.rels", text: '<Relationships><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/pivotCacheDefinition" Target="odd-cache.xml"/></Relationships>' },
      { path: "xl/odd-cache.xml", text: "<pivotCacheDefinition/>" }
    ]);
    assert.ok(features.includes("pivot caches"), features.join(", "));
  });
});
