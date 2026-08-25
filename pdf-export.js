(function (global) {
  const PURPLE = [0.403922, 0.345098, 0.854902];
  const LIGHT_PURPLE = [0.968627, 0.968627, 0.996078];
  const YELLOW = [1, 1, 0];
  const BLACK = [0, 0, 0];
  const WHITE = [1, 1, 1];
  const TABLE_LEFT = 51.36;
  const TABLE_RIGHT = 437.64;
  const TABLE_WIDTH = TABLE_RIGHT - TABLE_LEFT;
  const COLUMN_EDGES = [51.36, 106.56, 134.52, 172.56, 212.76, 264.6, 320.28, 371.76, 437.64];
  const FIRST_PAGE_CAPACITY = 50;
  const FINAL_PAGE_CAPACITY = 9;

  function color(rgb) {
    return global.PDFLib.rgb(...rgb);
  }

  function currency(value) {
    return new Intl.NumberFormat("de-AT", { style: "currency", currency: "EUR" })
      .format(Number(value || 0))
      .replace(/\u00a0/g, " ");
  }

  function decimal(value) {
    return Number(value || 0).toFixed(2).replace(".", ",");
  }

  function fitText(text, font, initialSize, maxWidth, minimumSize = 6) {
    let size = initialSize;
    while (size > minimumSize && font.widthOfTextAtSize(String(text), size) > maxWidth) size -= 0.25;
    return size;
  }

  function drawCentered(page, text, x, y, width, font, size, textColor = BLACK) {
    const value = String(text ?? "");
    const fittedSize = fitText(value, font, size, Math.max(1, width - 4));
    const textWidth = font.widthOfTextAtSize(value, fittedSize);
    page.drawText(value, {
      x: x + Math.max(2, (width - textWidth) / 2),
      y,
      size: fittedSize,
      font,
      color: color(textColor)
    });
  }

  function drawEmployeeHeader(page, report, regular, bold) {
    page.drawRectangle({ x: TABLE_LEFT, y: 768.96, width: TABLE_WIDTH, height: 45, color: color(YELLOW) });
    drawCentered(page, report.employeeName || "NAME", TABLE_LEFT, 792.5, TABLE_WIDTH, bold, 16);
    drawCentered(
      page,
      `Saison "${report.seasonYear ?? "VORJAHR"}" Punschstandl`,
      TABLE_LEFT,
      775.5,
      TABLE_WIDTH,
      regular,
      15
    );
  }

  function clearFirstPageTable(page) {
    page.drawRectangle({ x: 49.8, y: 59.8, width: 389.1, height: 701, color: color(WHITE) });
  }

  function drawGrid(page, top, rows, includeHeader, regular, bold) {
    const headerHeight = includeHeader ? 11 : 0;
    const rowHeight = 13;
    const bodyTop = top - headerHeight;
    const bottom = bodyTop - rows.length * rowHeight;
    const purple = color(PURPLE);

    if (includeHeader) {
      page.drawRectangle({ x: TABLE_LEFT, y: bodyTop, width: TABLE_WIDTH, height: headerHeight, color: purple });
      const headers = [
        ["Datum", COLUMN_EDGES[0], COLUMN_EDGES[2]],
        ["Beginn", COLUMN_EDGES[2], COLUMN_EDGES[3]],
        ["Ende", COLUMN_EDGES[3], COLUMN_EDGES[4]],
        ["Stunden", COLUMN_EDGES[4], COLUMN_EDGES[5]],
        ["€/Std.", COLUMN_EDGES[5], COLUMN_EDGES[6]],
        ["Prämie", COLUMN_EDGES[6], COLUMN_EDGES[7]],
        ["Gesamtbetrag", COLUMN_EDGES[7], COLUMN_EDGES[8]]
      ];
      headers.forEach(([label, left, right]) => drawCentered(page, label, left, bodyTop + 2.3, right - left, bold, 7.5, WHITE));
    }

    rows.forEach((row, index) => {
      const rowBottom = bodyTop - (index + 1) * rowHeight;
      page.drawRectangle({ x: TABLE_LEFT, y: rowBottom, width: TABLE_WIDTH, height: rowHeight, color: color(LIGHT_PURPLE) });
      const dateParts = String(row.dateLabel || "").split(/\s+/);
      drawCentered(page, dateParts[0] || "", COLUMN_EDGES[0], rowBottom + 3.1, COLUMN_EDGES[1] - COLUMN_EDGES[0], regular, 8.7);
      drawCentered(page, dateParts.slice(1).join(" "), COLUMN_EDGES[1], rowBottom + 3.1, COLUMN_EDGES[2] - COLUMN_EDGES[1], regular, 8.7);
      drawCentered(page, row.beginLabel || "", COLUMN_EDGES[2], rowBottom + 3.1, COLUMN_EDGES[3] - COLUMN_EDGES[2], regular, 8.4);
      drawCentered(page, row.endLabel || "", COLUMN_EDGES[3], rowBottom + 3.1, COLUMN_EDGES[4] - COLUMN_EDGES[3], regular, 8.4);
      drawCentered(page, row.hoursLabel || "00:00", COLUMN_EDGES[4], rowBottom + 3.1, COLUMN_EDGES[5] - COLUMN_EDGES[4], regular, 8.7);
      drawCentered(page, currency(row.hourlyRate), COLUMN_EDGES[5], rowBottom + 3.1, COLUMN_EDGES[6] - COLUMN_EDGES[5], regular, 8.1);
      drawCentered(page, currency(row.bonus), COLUMN_EDGES[6], rowBottom + 3.1, COLUMN_EDGES[7] - COLUMN_EDGES[6], regular, 8.1);
      drawCentered(page, currency(row.total), COLUMN_EDGES[7], rowBottom + 3.1, COLUMN_EDGES[8] - COLUMN_EDGES[7], regular, 8.1);
    });

    const lineTop = includeHeader ? top : bodyTop;
    COLUMN_EDGES.forEach((x) => page.drawLine({ start: { x, y: lineTop }, end: { x, y: bottom }, color: purple, thickness: 0.6 }));
    if (includeHeader) page.drawLine({ start: { x: TABLE_LEFT, y: top }, end: { x: TABLE_RIGHT, y: top }, color: purple, thickness: 0.6 });
    page.drawLine({ start: { x: TABLE_LEFT, y: bodyTop }, end: { x: TABLE_RIGHT, y: bodyTop }, color: purple, thickness: 0.6 });
    for (let index = 1; index <= rows.length; index += 1) {
      const y = bodyTop - index * rowHeight;
      page.drawLine({ start: { x: TABLE_LEFT, y }, end: { x: TABLE_RIGHT, y }, color: purple, thickness: 0.6 });
    }
    return bottom;
  }

  function drawTotals(page, report, regular, bold) {
    const totals = (report.rows || []).reduce((sum, row) => ({
      hours: sum.hours + Number(row.hours || 0),
      wages: sum.wages + Math.max(0, Number(row.total || 0) - Number(row.bonus || 0)),
      bonus: sum.bonus + Number(row.bonus || 0),
      total: sum.total + Number(row.total || 0)
    }), { hours: 0, wages: 0, bonus: 0, total: 0 });
    const y = 680.28;
    const height = 17.52;
    const purple = color(PURPLE);
    page.drawRectangle({ x: COLUMN_EDGES[1], y, width: COLUMN_EDGES[4] - COLUMN_EDGES[1], height, color: purple });
    drawCentered(page, "Gesamte Arbeitszeit", COLUMN_EDGES[1], y + 4.1, COLUMN_EDGES[4] - COLUMN_EDGES[1], bold, 9.5, WHITE);
    const cells = [
      [decimal(totals.hours), COLUMN_EDGES[4], COLUMN_EDGES[5]],
      [currency(totals.wages), COLUMN_EDGES[5], COLUMN_EDGES[6]],
      [currency(totals.bonus), COLUMN_EDGES[6], COLUMN_EDGES[7]],
      [currency(totals.total), COLUMN_EDGES[7], COLUMN_EDGES[8]]
    ];
    cells.forEach(([value, left, right]) => {
      page.drawRectangle({ x: left, y, width: right - left, height, color: color(LIGHT_PURPLE), borderColor: purple, borderWidth: 0.6 });
      drawCentered(page, value, left, y + 4.1, right - left, bold, 8.7);
    });
  }

  function addTextField(form, page, name, x, y, width, height, font, fontSize = 9) {
    const field = form.createTextField(name);
    field.addToPage(page, {
      x, y, width, height,
      font,
      borderColor: color(PURPLE),
      borderWidth: 0.6,
      backgroundColor: color(WHITE),
      textColor: color(BLACK)
    });
    field.setFontSize(fontSize);
    return field;
  }

  function addSettlementFields(form, page, index, font) {
    const prefix = `mitarbeiter_${index + 1}`;
    addTextField(form, page, `${prefix}_sonstiges_beschreibung`, 121, 644, 213, 15, font);
    addTextField(form, page, `${prefix}_sonstiges_betrag`, 382, 644, 48, 15, font);
    addTextField(form, page, `${prefix}_sonderpraemie_beschreibung`, 121, 618, 211, 15, font);
    addTextField(form, page, `${prefix}_sonderpraemie_betrag`, 382, 618, 48, 15, font);
    addTextField(form, page, `${prefix}_sachbezuege_beschreibung`, 121, 592, 211, 15, font);
    addTextField(form, page, `${prefix}_sachbezuege_betrag`, 382, 592, 48, 15, font);
    addTextField(form, page, `${prefix}_auszahlungsbetrag_gesamt`, 382, 566, 48, 15, font);
    addTextField(form, page, `${prefix}_bar_erhalten_am`, 220, 540, 109, 15, font);
    addTextField(form, page, `${prefix}_unterschrift`, 205, 505, 197, 24, font, 10);
  }

  function splitRows(rows) {
    const remaining = [...(rows || [])];
    const firstPageChunks = [];
    if (remaining.length <= FIRST_PAGE_CAPACITY) {
      firstPageChunks.push(remaining.splice(0));
    } else {
      while (remaining.length > FINAL_PAGE_CAPACITY) {
        const count = Math.min(FIRST_PAGE_CAPACITY, remaining.length - FINAL_PAGE_CAPACITY);
        firstPageChunks.push(remaining.splice(0, count));
      }
    }
    return { firstPageChunks, finalRows: remaining };
  }

  async function createTimePdf(payload, templateBytes) {
    if (!global.PDFLib) throw new Error("PDF-Bibliothek ist nicht verfügbar.");
    const { PDFDocument, StandardFonts } = global.PDFLib;
    const template = await PDFDocument.load(templateBytes);
    if (template.getPageCount() < 2) throw new Error("Die Stundenexport-Vorlage muss zwei Seiten enthalten.");

    const output = await PDFDocument.create();
    const regular = await output.embedFont(StandardFonts.Helvetica);
    const bold = await output.embedFont(StandardFonts.HelveticaBold);
    const form = output.getForm();
    const reports = payload.employeeReports || [];
    if (!reports.length) throw new Error("Keine Mitarbeiterdaten für den PDF-Export vorhanden.");

    for (let reportIndex = 0; reportIndex < reports.length; reportIndex += 1) {
      const report = reports[reportIndex];
      const { firstPageChunks, finalRows } = splitRows(report.rows);
      for (const rows of firstPageChunks) {
        const [page] = await output.copyPages(template, [0]);
        output.addPage(page);
        clearFirstPageTable(page);
        drawEmployeeHeader(page, report, regular, bold);
        drawGrid(page, 758.8, rows, true, regular, bold);
      }

      const [finalPage] = await output.copyPages(template, [1]);
      output.addPage(finalPage);
      finalPage.drawRectangle({ x: 49.8, y: 679.5, width: 389.1, height: 136, color: color(WHITE) });
      if (finalRows.length) drawGrid(finalPage, 814.1, finalRows, false, regular, bold);
      drawTotals(finalPage, report, regular, bold);
      addSettlementFields(form, finalPage, reportIndex, regular);
    }

    form.updateFieldAppearances(regular);
    output.setTitle("OwnCash Stundenexport");
    output.setAuthor("OwnCash");
    output.setSubject("Arbeitszeitabrechnung");
    output.setCreator("OwnCash Web-App");
    output.setProducer("pdf-lib");
    return output.save({ useObjectStreams: false });
  }

  async function downloadTimePdf(payload, templateUrl, filename) {
    const response = await fetch(templateUrl, { cache: "no-cache" });
    if (!response.ok) throw new Error("PDF-Vorlage konnte nicht geladen werden.");
    const bytes = await createTimePdf(payload, await response.arrayBuffer());
    const blob = new Blob([bytes], { type: "application/pdf" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  }

  global.PdfTimeExport = { createTimePdf, downloadTimePdf };
})(globalThis);
