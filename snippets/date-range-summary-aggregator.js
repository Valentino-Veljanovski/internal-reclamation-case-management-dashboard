/**
 * Date-Range Summary Aggregator
 * =============================
 *
 * Reads case rows from one or more region-specific worksheets (already
 * fetched upstream via Microsoft Graph) and computes:
 *
 *   - per-region counts by status,
 *   - per-region totals (open value, paid value),
 *   - grand totals across all included regions,
 *
 * Filtered by an inclusive date range on the "reported on" column.
 *
 * Why this is more than a one-liner:
 *
 *   - The date column is not consistent across the team's sheets:
 *     some rows have ISO `YYYY-MM-DD`, some have German `DD.MM.YYYY`,
 *     some have Excel serial numbers (the column was a Date type at
 *     some point). The parser handles all three.
 *
 *   - Numeric value columns may use a comma decimal separator (German
 *     locale) and may be padded with currency symbols. We strip and
 *     parse defensively.
 *
 *   - Sheets may contain "section divider" rows that shouldn't be
 *     counted — recognized by a marker character in the first column
 *     or by the header row repeating in the middle of the data.
 *
 * Used in: n8n Code node, after parallel reads of each region's
 * worksheet have been merged into a single input array. Each item in
 * the input array carries that region's rows under `.values`.
 *
 * Output: { results, grandTotalValue, grandTotalPaid, grandCount,
 * now, period, regionTitle, userId } — pass to a Slack-formatting
 * node to build the summary DM.
 */

// Inputs from upstream parser:
const dateFrom = $("Parse Date Range").first().json.dateFrom;
const dateTo = $("Parse Date Range").first().json.dateTo;
const filterRegion = $("Parse Date Range").first().json.region;
const userId = $("Parse Date Range").first().json.userId;

// The region labels in the same order as the upstream merge produces.
const regionLabels = ["Berlin", "Mainz", "Köln", "München", "Stuttgart"];

// ── Helpers ──────────────────────────────────────────────────

/** Convert YYYY-MM-DD or DD.MM.YYYY or Excel serial to YYYYMMDD int. */
function parseDate(val) {
  if (!val) return 0;
  const s = val.toString().trim();

  // German DD.MM.YYYY
  const m1 = s.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  if (m1) return parseInt(m1[3] + m1[2] + m1[1]);

  // ISO YYYY-MM-DD
  const m2 = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m2) return parseInt(m2[1] + m2[2] + m2[3]);

  // Excel serial number (days since 1900-01-01-ish)
  const num = parseFloat(s);
  if (!isNaN(num) && num > 40000) {
    const d = new Date((num - 25569) * 86400000);
    const y = d.getUTCFullYear();
    const mo = String(d.getUTCMonth() + 1).padStart(2, "0");
    const day = String(d.getUTCDate()).padStart(2, "0");
    return parseInt(y + mo + day);
  }

  return 0;
}

/** "1.234,56" → 1234.56 ; "1234.56" → 1234.56 ; missing → 0 */
function parseAmount(val) {
  if (!val) return 0;
  const s = val.toString().replace(/[^\d.,-]/g, "").replace(",", ".");
  const n = parseFloat(s);
  return isNaN(n) ? 0 : n;
}

/** Fold from-to dates into integer YYYYMMDD bounds (or 0 for unbounded). */
const fromInt = parseDate(dateFrom);
const toInt = parseDate(dateTo);

// ── Main loop ────────────────────────────────────────────────

const allItems = $input.all();
const results = [];
let grandTotalValue = 0;
let grandTotalPaid = 0;
let grandCount = 0;

for (let i = 0; i < allItems.length; i++) {
  const label = regionLabels[i];
  if (filterRegion !== "all" && filterRegion !== label) continue;

  const rows = allItems[i].json.values || [];
  let inProgress = 0;
  let completed = 0;
  let onHold = 0;
  let cancelled = 0;
  let totalValue = 0;
  let totalPaid = 0;
  let count = 0;

  for (const row of rows) {
    // Column indexes follow the spreadsheet's actual layout.
    // Adjust these to match your sheet.
    const company = (row[0] || "").toString().trim();

    // Skip header rows and section dividers.
    if (!company || company.includes("▸") || company === "Company") continue;

    // Date filter
    const reportedDate = parseDate(row[7]);
    if (fromInt && toInt) {
      if (!reportedDate || reportedDate < fromInt || reportedDate > toInt) {
        continue;
      }
    }

    const status = (row[14] || "").toString().trim();
    const value = parseAmount(row[16]);
    const paidOn = (row[18] || "").toString().trim();

    // Bucket by status. Adjust labels to match your operational vocabulary.
    if (status === "In Progress") inProgress++;
    else if (status === "Completed") completed++;
    else if (status === "On Hold") onHold++;
    else if (status === "Cancelled") cancelled++;

    totalValue += value;
    if (paidOn) totalPaid += value;
    count++;
  }

  grandTotalValue += totalValue;
  grandTotalPaid += totalPaid;
  grandCount += count;

  // Skip empty regions in the output unless user explicitly asked for them.
  if (count > 0 || filterRegion === label) {
    results.push({
      label,
      count,
      inProgress,
      completed,
      onHold,
      cancelled,
      totalValue,
      totalPaid,
    });
  }
}

// ── Format metadata ──────────────────────────────────────────

const now = new Date().toLocaleString("de-DE", {
  timeZone: "Europe/Berlin",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

const period =
  dateFrom && dateTo ? `${dateFrom} — ${dateTo}` : "All time";
const regionTitle = filterRegion === "all" ? "All regions" : filterRegion;

return [
  {
    json: {
      results,
      grandTotalValue,
      grandTotalPaid,
      grandCount,
      now,
      period,
      regionTitle,
      userId,
    },
  },
];
