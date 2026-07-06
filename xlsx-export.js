(function (global) {
  const encoder = new TextEncoder();

  function escapeXml(value) {
    return String(value ?? "").replace(/[<>&'"]/g, (character) => ({
      "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;"
    }[character]));
  }

  function columnName(index) {
    let name = "";
    for (let value = index + 1; value > 0; value = Math.floor((value - 1) / 26)) {
      name = String.fromCharCode(65 + ((value - 1) % 26)) + name;
    }
    return name;
  }

  function crc32(bytes) {
    let crc = -1;
    for (const byte of bytes) {
      crc ^= byte;
      for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xEDB88320 & -(crc & 1));
    }
    return (crc ^ -1) >>> 0;
  }

  function writeU16(view, offset, value) {
    view.setUint16(offset, value, true);
  }

  function writeU32(view, offset, value) {
    view.setUint32(offset, value >>> 0, true);
  }

  function makeZip(files) {
    const now = new Date();
    const dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | Math.floor(now.getSeconds() / 2);
    const dosDate = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
    const chunks = [];
    const central = [];
    let offset = 0;

    Object.entries(files).forEach(([filename, content]) => {
      const name = encoder.encode(filename);
      const data = typeof content === "string" ? encoder.encode(content) : content;
      const crc = crc32(data);
      const local = new Uint8Array(30 + name.length);
      const localView = new DataView(local.buffer);
      writeU32(localView, 0, 0x04034b50);
      writeU16(localView, 4, 20);
      writeU16(localView, 6, 0x0800);
      writeU16(localView, 8, 0);
      writeU16(localView, 10, dosTime);
      writeU16(localView, 12, dosDate);
      writeU32(localView, 14, crc);
      writeU32(localView, 18, data.length);
      writeU32(localView, 22, data.length);
      writeU16(localView, 26, name.length);
      writeU16(localView, 28, 0);
      local.set(name, 30);
      chunks.push(local, data);

      const directory = new Uint8Array(46 + name.length);
      const directoryView = new DataView(directory.buffer);
      writeU32(directoryView, 0, 0x02014b50);
      writeU16(directoryView, 4, 20);
      writeU16(directoryView, 6, 20);
      writeU16(directoryView, 8, 0x0800);
      writeU16(directoryView, 10, 0);
      writeU16(directoryView, 12, dosTime);
      writeU16(directoryView, 14, dosDate);
      writeU32(directoryView, 16, crc);
      writeU32(directoryView, 20, data.length);
      writeU32(directoryView, 24, data.length);
      writeU16(directoryView, 28, name.length);
      writeU16(directoryView, 30, 0);
      writeU16(directoryView, 32, 0);
      writeU16(directoryView, 34, 0);
      writeU16(directoryView, 36, 0);
      writeU32(directoryView, 38, 0);
      writeU32(directoryView, 42, offset);
      directory.set(name, 46);
      central.push(directory);
      offset += local.length + data.length;
    });

    const centralSize = central.reduce((sum, chunk) => sum + chunk.length, 0);
    const end = new Uint8Array(22);
    const endView = new DataView(end.buffer);
    writeU32(endView, 0, 0x06054b50);
    writeU16(endView, 4, 0);
    writeU16(endView, 6, 0);
    writeU16(endView, 8, central.length);
    writeU16(endView, 10, central.length);
    writeU32(endView, 12, centralSize);
    writeU32(endView, 16, offset);
    writeU16(endView, 20, 0);

    const all = [...chunks, ...central, end];
    const output = new Uint8Array(all.reduce((sum, chunk) => sum + chunk.length, 0));
    let cursor = 0;
    all.forEach((chunk) => {
      output.set(chunk, cursor);
      cursor += chunk.length;
    });
    return output;
  }

  function stringCell(reference, value, style = 0) {
    return `<c r="${reference}" t="inlineStr" s="${style}"><is><t xml:space="preserve">${escapeXml(value)}</t></is></c>`;
  }

  function numberCell(reference, value, style = 3) {
    return `<c r="${reference}" s="${style}"><v>${Number(value) || 0}</v></c>`;
  }

  function countCell(reference, value, style = 3) {
    return Number(value) > 0 ? numberCell(reference, value, style) : `<c r="${reference}" s="${style}"/>`;
  }

  function emptyCell(reference, style = 0) {
    return `<c r="${reference}" s="${style}"/>`;
  }

  function createWorkbook(payload) {
    const sheetConfigs = Array.isArray(payload.sheets) && payload.sheets.length ? payload.sheets : [payload];
    const buildSheetXml = ({ dateLabel, rows, categoryNames, cashBalance = null, locationName = "" }) => {
    const headers = [dateLabel, "Gesamt", "Verkauft", ...categoryNames, "Gesamtbetrag Artikel"];
    const amountColumnIndex = headers.length - 1;
    const sheetRows = [
      `<row r="1" ht="24" customHeight="1">${headers.map((value, index) =>
        stringCell(`${columnName(index)}1`, value, index === 0 ? 1 : (index === 2 ? 3 : 2))
      ).join("")}</row>`
    ];

    rows.forEach((row, rowIndex) => {
      const number = rowIndex + 2;
      const alternatingStyle = rowIndex % 2 === 0 ? 4 : 5;
      const alternatingNumberStyle = rowIndex % 2 === 0 ? 6 : 7;
      const alternatingCurrencyStyle = rowIndex % 2 === 0 ? 9 : 10;
      const cells = [
        stringCell(`A${number}`, row.name, alternatingStyle),
        countCell(`B${number}`, row.total, alternatingNumberStyle),
        countCell(`C${number}`, row.sold, 8),
        ...categoryNames.map((category, index) =>
          countCell(`${columnName(index + 3)}${number}`, row.categoryCounts[category] || 0, alternatingNumberStyle)
        ),
        numberCell(`${columnName(amountColumnIndex)}${number}`, row.amount || 0, alternatingCurrencyStyle)
      ];
      sheetRows.push(`<row r="${number}" ht="20" customHeight="1">${cells.join("")}</row>`);
    });

    const totalRowNumber = rows.length + 2;
    const totals = {
      total: rows.reduce((sum, row) => sum + row.total, 0),
      sold: rows.reduce((sum, row) => sum + row.sold, 0),
      amount: rows.reduce((sum, row) => sum + (row.amount || 0), 0)
    };
    const totalCells = [
      stringCell(`A${totalRowNumber}`, "Gesamtbetrag aller Artikel", 11),
      emptyCell(`B${totalRowNumber}`, 11),
      emptyCell(`C${totalRowNumber}`, 12),
      ...categoryNames.map((category, index) => emptyCell(`${columnName(index + 3)}${totalRowNumber}`, 11)),
      numberCell(`${columnName(amountColumnIndex)}${totalRowNumber}`, totals.amount, 13)
    ];
    sheetRows.push(`<row r="${totalRowNumber}" ht="24" customHeight="1">${totalCells.join("")}</row>`);
    const cashRowNumber = totalRowNumber + 1;
    const differenceRowNumber = totalRowNumber + 2;
    const hasCashBalance = Number.isFinite(cashBalance);
    sheetRows.push(`<row r="${cashRowNumber}" ht="22" customHeight="1">${[
      stringCell(`A${cashRowNumber}`, "Kassenstand", 11),
      ...Array.from({ length: headers.length - 2 }, (_, index) => emptyCell(`${columnName(index + 1)}${cashRowNumber}`, 11)),
      hasCashBalance
        ? numberCell(`${columnName(amountColumnIndex)}${cashRowNumber}`, cashBalance, 13)
        : emptyCell(`${columnName(amountColumnIndex)}${cashRowNumber}`, 13)
    ].join("")}</row>`);
    sheetRows.push(`<row r="${differenceRowNumber}" ht="22" customHeight="1">${[
      stringCell(`A${differenceRowNumber}`, "Differenz", 12),
      ...Array.from({ length: headers.length - 2 }, (_, index) => emptyCell(`${columnName(index + 1)}${differenceRowNumber}`, 12)),
      hasCashBalance
        ? numberCell(`${columnName(amountColumnIndex)}${differenceRowNumber}`, cashBalance - totals.amount, 14)
        : emptyCell(`${columnName(amountColumnIndex)}${differenceRowNumber}`, 14)
    ].join("")}</row>`);
    const locationRowNumber = differenceRowNumber + 1;
    sheetRows.push(`<row r="${locationRowNumber}" ht="22" customHeight="1">${[
      stringCell(`A${locationRowNumber}`, "Standort", 11),
      ...Array.from({ length: headers.length - 2 }, (_, index) => emptyCell(`${columnName(index + 1)}${locationRowNumber}`, 11)),
      stringCell(`${columnName(amountColumnIndex)}${locationRowNumber}`, locationName, 11)
    ].join("")}</row>`);

    const lastColumn = columnName(headers.length - 1);
    const lastDataRow = Math.max(rows.length + 1, 1);
    const sheetXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <dimension ref="A1:${lastColumn}${locationRowNumber}"/>
  <sheetViews><sheetView showGridLines="0" workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>
  <sheetFormatPr defaultRowHeight="20"/>
  <cols><col min="1" max="1" width="32" customWidth="1"/><col min="2" max="${Math.max(headers.length - 1, 2)}" width="16" customWidth="1"/><col min="${headers.length}" max="${headers.length}" width="24" customWidth="1"/></cols>
  <sheetData>${sheetRows.join("")}</sheetData>
  <autoFilter ref="A1:${lastColumn}${lastDataRow}"/>
</worksheet>`;

      return sheetXml;
    };

    const worksheetXml = sheetConfigs.map(buildSheetXml);
    const workbookSheets = sheetConfigs.map((sheet, index) =>
      `<sheet name="${escapeXml(sheet.sheetName || sheet.dateLabel || `Tag ${index + 1}`)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`
    ).join("");
    const worksheetRelationships = sheetConfigs.map((_, index) =>
      `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`
    ).join("");
    const worksheetOverrides = sheetConfigs.map((_, index) =>
      `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`
    ).join("");
    const documentTitle = sheetConfigs.length > 1 ? "Gesamtabrechnung" : `Abrechnung ${sheetConfigs[0].dateLabel}`;

    const files = {
      "[Content_Types].xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${worksheetOverrides}<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>`,
      "_rels/.rels": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>`,
      "xl/workbook.xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><bookViews><workbookView/></bookViews><sheets>${workbookSheets}</sheets></workbook>`,
      "xl/_rels/workbook.xml.rels": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${worksheetRelationships}<Relationship Id="rId${sheetConfigs.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
      ...Object.fromEntries(worksheetXml.map((xml, index) => [`xl/worksheets/sheet${index + 1}.xml`, xml])),
      "xl/styles.xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="1"><numFmt numFmtId="164" formatCode="#,##0.00 [$€-407]"/></numFmts><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="5"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFFFFF00"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFDDEBF7"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFC6E0B4"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="2"><border/><border><left style="thin"><color rgb="FF5B9BD5"/></left><right style="thin"><color rgb="FF5B9BD5"/></right><top style="thin"><color rgb="FF5B9BD5"/></top><bottom style="thin"><color rgb="FF5B9BD5"/></bottom></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="15"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf><xf numFmtId="0" fontId="0" fillId="3" borderId="1" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf><xf numFmtId="0" fontId="0" fillId="4" borderId="1" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf><xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyAlignment="1"><alignment horizontal="left" vertical="center"/></xf><xf numFmtId="0" fontId="0" fillId="3" borderId="1" xfId="0" applyAlignment="1"><alignment horizontal="left" vertical="center"/></xf><xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf><xf numFmtId="0" fontId="0" fillId="3" borderId="1" xfId="0" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf><xf numFmtId="0" fontId="0" fillId="4" borderId="1" xfId="0" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf><xf numFmtId="164" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf><xf numFmtId="164" fontId="0" fillId="3" borderId="1" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf><xf numFmtId="0" fontId="1" fillId="3" borderId="1" xfId="0" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf><xf numFmtId="0" fontId="1" fillId="4" borderId="1" xfId="0" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf><xf numFmtId="164" fontId="1" fillId="3" borderId="1" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf><xf numFmtId="164" fontId="1" fillId="4" borderId="1" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`,
      "docProps/core.xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${escapeXml(documentTitle)}</dc:title><dc:creator>Kassenraum</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${new Date().toISOString()}</dcterms:created></cp:coreProperties>`,
      "docProps/app.xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>Kassenraum</Application></Properties>`
    };
    return makeZip(files);
  }

  function downloadWorkbook(payload, filename) {
    const bytes = createWorkbook(payload);
    const blob = new Blob([bytes], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function styleSheet(sheet, widths, currencyColumns = [], decimalColumns = []) {
    sheet["!cols"] = widths.map((width) => ({ wch: width }));
    const range = XLSX.utils.decode_range(sheet["!ref"]);
    for (let column = range.s.c; column <= range.e.c; column += 1) {
      const cell = sheet[XLSX.utils.encode_cell({ r: 0, c: column })];
      if (cell) {
        cell.s = {
          font: { bold: true, color: { rgb: "FFFFFFFF" } },
          fill: { patternType: "solid", fgColor: { rgb: "FF19745F" } },
          alignment: { horizontal: "center", vertical: "center" },
          border: { bottom: { style: "thin", color: { rgb: "FFB7C9C3" } } }
        };
      }
    }
    for (let row = 1; row <= range.e.r; row += 1) {
      currencyColumns.forEach((column) => {
        const cell = sheet[XLSX.utils.encode_cell({ r: row, c: column })];
        if (cell) cell.z = '#,##0.00 [$€-407]';
      });
      decimalColumns.forEach((column) => {
        const cell = sheet[XLSX.utils.encode_cell({ r: row, c: column })];
        if (cell) cell.z = "0.00";
      });
    }
    sheet["!autofilter"] = { ref: XLSX.utils.encode_range({ r: 0, c: 0 }, { r: Math.max(range.e.r - 1, 0), c: range.e.c }) };
    sheet["!freeze"] = { xSplit: 0, ySplit: 1, topLeftCell: "A2", activePane: "bottomLeft", state: "frozen" };
  }

  function createTimeWorkbook(payload) {
    if (!global.XLSX) throw new Error("Excel-Bibliothek ist nicht verfügbar.");
    const dailyRows = payload.dailyRows || [];
    const employeeRows = payload.employeeRows || [];
    const detailRows = payload.detailRows || [];
    const workbook = XLSX.utils.book_new();

    const details = [["Datum", "Mitarbeiter", "Standort", "Eingestempelt", "Ausgestempelt", "Stunden", "Stundensatz", "Grundlohn", "Status"]];
    detailRows.forEach((row) => details.push([
      row.dateLabel, row.employeeName, row.locationName, row.clockInLabel, row.clockOutLabel,
      row.hours, row.hourlyRate, row.wages, row.open ? "Offen" : "Abgeschlossen"
    ]));
    const detailSheet = XLSX.utils.aoa_to_sheet(details);
    styleSheet(detailSheet, [14, 24, 20, 21, 21, 12, 15, 15, 15], [6, 7], [5]);
    XLSX.utils.book_append_sheet(workbook, detailSheet, "Stempelzeiten");

    const detailLastRow = Math.max(detailRows.length + 1, 2);
    const daily = [["Datum", "Mitarbeiter", "Stunden", "Stundensatz", "Grundlohn", "Bonus", "Gesamt", "Bonusnotiz"]];
    dailyRows.forEach((row, index) => {
      const excelRow = index + 2;
      daily.push([
        row.dateLabel,
        row.employeeName,
        { t: "n", f: `SUMIFS('Stempelzeiten'!$F$2:$F$${detailLastRow},'Stempelzeiten'!$A$2:$A$${detailLastRow},A${excelRow},'Stempelzeiten'!$B$2:$B$${detailLastRow},B${excelRow})`, v: row.hours },
        { t: "n", f: `IFERROR(E${excelRow}/C${excelRow},0)`, v: row.hourlyRate },
        { t: "n", f: `SUMIFS('Stempelzeiten'!$H$2:$H$${detailLastRow},'Stempelzeiten'!$A$2:$A$${detailLastRow},A${excelRow},'Stempelzeiten'!$B$2:$B$${detailLastRow},B${excelRow})`, v: row.wages },
        row.bonus,
        { t: "n", f: `E${excelRow}+F${excelRow}`, v: row.total },
        row.bonusNote
      ]);
    });
    const dailySheet = XLSX.utils.aoa_to_sheet(daily);
    styleSheet(dailySheet, [14, 24, 12, 15, 15, 14, 15, 30], [3, 4, 5, 6], [2]);
    XLSX.utils.book_append_sheet(workbook, dailySheet, "Tagesabrechnung");

    const dailyLastRow = Math.max(dailyRows.length + 1, 2);
    const employeeSummary = [["Mitarbeiter", "Gesamtstunden", "Grundlohn", "Bonus", "Gesamtsumme"]];
    employeeRows.forEach((row, index) => {
      const excelRow = index + 2;
      employeeSummary.push([
        row.employeeName,
        { t: "n", f: `SUMIF('Tagesabrechnung'!$B$2:$B$${dailyLastRow},A${excelRow},'Tagesabrechnung'!$C$2:$C$${dailyLastRow})`, v: row.hours },
        { t: "n", f: `SUMIF('Tagesabrechnung'!$B$2:$B$${dailyLastRow},A${excelRow},'Tagesabrechnung'!$E$2:$E$${dailyLastRow})`, v: row.wages },
        { t: "n", f: `SUMIF('Tagesabrechnung'!$B$2:$B$${dailyLastRow},A${excelRow},'Tagesabrechnung'!$F$2:$F$${dailyLastRow})`, v: row.bonus },
        { t: "n", f: `C${excelRow}+D${excelRow}`, v: row.total }
      ]);
    });
    const employeeTotalFormula = (column) => employeeRows.length ? `SUM(${column}2:${column}${employeeRows.length + 1})` : "0";
    employeeSummary.push([
      "Gesamt",
      { t: "n", f: employeeTotalFormula("B"), v: payload.totals?.hours || 0 },
      { t: "n", f: employeeTotalFormula("C"), v: payload.totals?.wages || 0 },
      { t: "n", f: employeeTotalFormula("D"), v: payload.totals?.bonus || 0 },
      { t: "n", f: employeeTotalFormula("E"), v: payload.totals?.total || 0 }
    ]);
    employeeSummary.push(["Standort", payload.locationName, "", "", ""]);
    employeeSummary.push(["Zeitraum", payload.periodLabel, "", "", ""]);
    const summarySheet = XLSX.utils.aoa_to_sheet(employeeSummary);
    styleSheet(summarySheet, [25, 17, 17, 15, 18], [2, 3, 4], [1]);
    XLSX.utils.book_append_sheet(workbook, summarySheet, "Mitarbeitersummen");

    workbook.Props = {
      Title: `Arbeitszeitabrechnung ${payload.periodLabel}`,
      Subject: payload.locationName,
      Author: "Kassenraum",
      CreatedDate: new Date()
    };
    workbook.SheetNames = ["Mitarbeitersummen", "Tagesabrechnung", "Stempelzeiten"];
    return workbook;
  }

  function downloadTimeWorkbook(payload, filename) {
    const workbook = createTimeWorkbook(payload);
    XLSX.writeFile(workbook, filename, { compression: true, cellStyles: true });
  }

  global.XlsxExport = { createWorkbook, downloadWorkbook, createTimeWorkbook, downloadTimeWorkbook };
})(globalThis);
