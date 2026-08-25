import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
await import(pathToFileURL(resolve(projectRoot, "submitted-report-export.js")));
await import(pathToFileURL(resolve(projectRoot, "xlsx-export.js")));

const catalog = {
  categories: [
    { id: "cat-punsch", name: "Punsch" },
    { id: "cat-team", name: "Mitarbeiter" }
  ],
  products: [
    { id: "prod-apfel", categoryId: "cat-punsch", name: "Apfelpunsch", price: 4.5 },
    { id: "prod-kinder", categoryId: "cat-punsch", name: "Kinderpunsch", price: 3.5 },
    { id: "prod-team", categoryId: "cat-team", name: "Mitarbeitergetränk", price: 0 }
  ]
};

const saleA = {
  id: "bon-1", timestamp: "2026-08-23T22:30:00+02:00", total: 9,
  items: [{ productId: "prod-apfel", name: "Apfelpunsch", price: 4.5, quantity: 2, categoryName: "Punsch" }]
};
const saleB = {
  id: "bon-2", timestamp: "2026-08-24T01:10:00+02:00", total: 0,
  items: [{ productId: "prod-team", name: "Mitarbeitergetränk", price: 0, quantity: 1, categoryName: "Mitarbeiter" }]
};
const saleC = {
  id: "bon-3", timestamp: "2026-08-24T19:15:00+02:00", total: 7,
  items: [{ productId: "prod-kinder", name: "Kinderpunsch", price: 3.5, quantity: 2, categoryName: "Punsch" }]
};
const saleD = {
  id: "bon-4", timestamp: "2026-08-24T20:30:00+02:00", total: 4.5,
  items: [{ productId: "prod-apfel", name: "Apfelpunsch", price: 4.5, quantity: 1, categoryName: "Punsch" }]
};

const reports = [
  { id: "daily-1", report_type: "daily", business_date: "2026-08-23", location_id: "punsch", locationName: "Punschhütte", cash_balance: 9, sales: [saleA, saleB], catalog },
  { id: "total-1", report_type: "total", business_date: "2026-08-24", location_id: "punsch", locationName: "Punschhütte", sales: [saleA, saleB, saleD], catalog },
  { id: "daily-2", report_type: "daily", business_date: "2026-08-24", location_id: "bar", locationName: "Bar", cash_balance: 7, sales: [saleC], catalog },
  { id: "daily-3", report_type: "daily", business_date: "2026-08-24", location_id: "punsch", locationName: "Punschhütte", cash_balance: 4.5, sales: [saleD], catalog }
];

function formatDateKey(dateKey) {
  const [year, month, day] = dateKey.split("-");
  return `${day}.${month}.${year}`;
}

function buildSheet(reportSales, { dateLabel, sheetName, cashBalance, locationName }) {
  const categoryNames = catalog.categories
    .filter((category) => catalog.products.some((product) => product.categoryId === category.id && Number(product.price) <= 0))
    .map((category) => category.name);
  const rows = new Map();
  const ensureRow = (name) => {
    const key = name.toLocaleLowerCase("de");
    if (!rows.has(key)) rows.set(key, { name, total: 0, sold: 0, amount: 0, categoryCounts: {} });
    return rows.get(key);
  };
  catalog.products.forEach((product) => ensureRow(product.name));
  reportSales.forEach((sale) => sale.items.forEach((item) => {
    const row = ensureRow(item.name);
    row.total += item.quantity;
    row.amount += item.price * item.quantity;
    if (item.price > 0) row.sold += item.quantity;
    else row.categoryCounts[item.categoryName] = (row.categoryCounts[item.categoryName] || 0) + item.quantity;
  }));
  return { sheetName, dateLabel, rows: [...rows.values()], categoryNames, cashBalance, locationName };
}

const groups = globalThis.SubmittedReportExport.groupSubmittedReports(reports);
if (groups.length !== 3 || groups.reduce((sum, group) => sum + group.sales.length, 0) !== 4) {
  throw new Error("Gruppierung oder Bon-Deduplizierung ist fehlerhaft.");
}
const sheets = groups.map((group) => buildSheet(group.sales, {
  dateLabel: formatDateKey(group.dateKey),
  sheetName: `${group.dateKey.slice(8, 10)}.${group.dateKey.slice(5, 7)} ${group.locationName}`,
  cashBalance: group.cashBalance,
  locationName: group.locationName
}));
const allSales = groups.flatMap((group) => group.sales);
const totalCash = groups.map((group) => group.cashBalance).filter(Number.isFinite).reduce((sum, value) => sum + value, 0);
sheets.push(buildSheet(allSales, {
  dateLabel: "Gesamtabrechnung",
  sheetName: "Gesamtabrechnung",
  cashBalance: totalCash,
  locationName: [...new Set(groups.map((group) => group.locationName))].sort().join(", ")
}));

const outputDir = resolve(projectRoot, "outputs", "01a0385f-c094-7190-a436-40a39e9a31eb");
await mkdir(outputDir, { recursive: true });
const outputPath = resolve(outputDir, "OwnCash-Gesamtabrechnung-Beispiel.xlsx");
await writeFile(outputPath, globalThis.XlsxExport.createWorkbook({ sheets }));
console.log(outputPath);
