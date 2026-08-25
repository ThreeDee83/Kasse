(function (global) {
  "use strict";

  function localDateKey(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  function bondDateKey(timestamp, cutoffHour = 4) {
    const date = timestamp instanceof Date ? new Date(timestamp) : new Date(timestamp);
    if (Number.isNaN(date.getTime())) return "";
    if (date.getHours() < cutoffHour) date.setDate(date.getDate() - 1);
    return localDateKey(date);
  }

  function reportSales(report) {
    return Array.isArray(report?.sales) ? report.sales : [];
  }

  function reportType(report) {
    return report?.report_type || report?.reportType || "daily";
  }

  function reportDateKey(report) {
    return String(report?.business_date || report?.businessDate || "");
  }

  function reportLocationId(report) {
    return String(report?.location_id || report?.locationId || report?.location?.id || "");
  }

  function reportLocationName(report) {
    return String(report?.location?.name || report?.locationName || "").trim();
  }

  function reportLocationKey(report) {
    const id = reportLocationId(report).trim();
    if (id) return `id:${id}`;
    const name = reportLocationName(report).toLocaleLowerCase("de");
    return name ? `name:${name}` : "unknown:standort";
  }

  function saleKey(sale, report) {
    const locationKey = reportLocationKey(report);
    const id = String(sale?.id || "").trim();
    if (id) return `${locationKey}:id:${id}`;
    const items = (sale?.items || []).map((item) => [
      item?.productId || "",
      item?.name || "",
      Number(item?.price || 0),
      Number(item?.quantity || 0),
      item?.status || "",
      Boolean(item?.canceled)
    ]);
    return `${locationKey}:fallback:${sale?.timestamp || ""}:${Number(sale?.total || 0)}:${JSON.stringify(items)}`;
  }

  function bondDateKeysForReport(report) {
    return [...new Set(reportSales(report).map((sale) => bondDateKey(sale?.timestamp)).filter(Boolean))].sort();
  }

  function groupSubmittedReports(reports) {
    const uniqueSales = new Map();
    (reports || []).forEach((report) => {
      const locationKey = reportLocationKey(report);
      const locationId = reportLocationId(report);
      const locationName = reportLocationName(report) || "Standort";
      reportSales(report).forEach((sale) => {
        const key = saleKey(sale, report);
        if (!uniqueSales.has(key)) {
          uniqueSales.set(key, { sale, locationKey, locationId, locationName });
        }
      });
    });

    const groupMap = new Map();
    uniqueSales.forEach(({ sale, locationKey, locationId, locationName }) => {
      const dateKey = bondDateKey(sale?.timestamp);
      if (!dateKey) return;
      const groupKey = `${dateKey}|${locationKey}`;
      if (!groupMap.has(groupKey)) {
        groupMap.set(groupKey, { dateKey, locationKey, locationId, locationName, sales: [], cashBalance: null });
      }
      groupMap.get(groupKey).sales.push(sale);
    });

    (reports || []).forEach((report) => {
      if (reportType(report) !== "daily") return;
      const dateKey = reportDateKey(report);
      const group = groupMap.get(`${dateKey}|${reportLocationKey(report)}`);
      const cashBalance = Number(report?.cash_balance ?? report?.cashBalance);
      if (!group || !Number.isFinite(cashBalance)) return;
      if (!Number.isFinite(group.cashBalance)) group.cashBalance = cashBalance;
    });

    return [...groupMap.values()].sort((a, b) =>
      a.dateKey.localeCompare(b.dateKey) || a.locationName.localeCompare(b.locationName, "de")
    );
  }

  global.SubmittedReportExport = { bondDateKey, bondDateKeysForReport, groupSubmittedReports };
})(globalThis);
