import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import * as PDFLib from "pdf-lib";

globalThis.PDFLib = PDFLib;
await import("../pdf-export.js");

const root = resolve(import.meta.dirname, "..");
const template = await readFile(resolve(root, "assets/pdf/stundenexport-vorlage.pdf"));
await mkdir(resolve(root, "output/pdf"), { recursive: true });
await mkdir(resolve(root, "tmp/pdfs/stundenexport-generated"), { recursive: true });

const blankPayload = {
  employeeReports: [{ employeeName: "NAME", seasonYear: "VORJAHR", rows: [] }]
};

const samplePayload = {
  employeeReports: [{
    employeeName: "Max Mustermann",
    seasonYear: 2025,
    rows: [
      { dateLabel: "29.10.25 Mi", beginLabel: "15:30", endLabel: "21:45", hoursLabel: "06:15", hours: 6.25, hourlyRate: 15, bonus: 10, total: 103.75 },
      { dateLabel: "31.10.25 Fr", beginLabel: "16:00", endLabel: "23:15", hoursLabel: "07:15", hours: 7.25, hourlyRate: 15, bonus: 0, total: 108.75 },
      { dateLabel: "01.11.25 Sa", beginLabel: "14:45", endLabel: "22:30", hoursLabel: "07:45", hours: 7.75, hourlyRate: 15, bonus: 12.5, total: 128.75 },
      { dateLabel: "08.11.25 Sa", beginLabel: "15:00", endLabel: "22:00", hoursLabel: "07:00", hours: 7, hourlyRate: 15, bonus: 0, total: 105 }
    ]
  }]
};

const blank = await globalThis.PdfTimeExport.createTimePdf(blankPayload, template);
await writeFile(resolve(root, "output/pdf/OwnCash-Stundenexport-Formularvorlage.pdf"), blank);

const sample = await globalThis.PdfTimeExport.createTimePdf(samplePayload, template);
await writeFile(resolve(root, "tmp/pdfs/stundenexport-generated/OwnCash-Stundenexport-Beispiel.pdf"), sample);

console.log("OwnCash Stundenexport-Formularvorlage und QA-Beispiel wurden erzeugt.");
