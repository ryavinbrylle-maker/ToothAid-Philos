/**
 * Build treatment summary data from visits (filtered by month/year).
 * Report structure is derived from TREATMENT_OPTIONS so it stays in sync with treatment types.
 */
import { TREATMENT_OPTIONS, TREATMENT_CHART_LABELS, getTreatmentCategoryAndValue } from './treatmentTypes';
import { getAllChildren } from '../db/indexedDB';

/**
 * Filter visits to those in the given month (1-12) and year.
 */
export function filterVisitsByMonthYear(visits, month, year) {
  return visits.filter((v) => {
    const d = new Date(v.date);
    return d.getMonth() + 1 === month && d.getFullYear() === year;
  });
}

/**
 * Filter visits to those in the given year.
 */
export function filterVisitsByYear(visits, year) {
  return visits.filter((v) => new Date(v.date).getFullYear() === year);
}

/**
 * Inclusive date range on calendar day (local).
 */
export function filterVisitsByDateRange(visits, fromYmd, toYmd) {
  if (!fromYmd || !toYmd) return visits;
  const fromD = new Date(fromYmd);
  const toD = new Date(toYmd);
  if (Number.isNaN(fromD.getTime()) || Number.isNaN(toD.getTime())) return visits;
  fromD.setHours(0, 0, 0, 0);
  toD.setHours(23, 59, 59, 999);
  return visits.filter((v) => {
    const d = new Date(v.date);
    return !Number.isNaN(d.getTime()) && d >= fromD && d <= toD;
  });
}

function mondayOfWeekContaining(d) {
  const x = new Date(d);
  const day = x.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  x.setDate(x.getDate() + diff);
  x.setHours(0, 0, 0, 0);
  return x;
}

function sortTreatmentCategoryList(categorySet) {
  const known = TREATMENT_CHART_LABELS.filter((l) => categorySet.has(l));
  const extras = [...categorySet].filter((c) => !TREATMENT_CHART_LABELS.includes(c));
  extras.sort((a, b) => a.localeCompare(b));
  return [...known, ...extras];
}

function buildVisitsByPeriodForExport(exportRange, month, year, visits) {
  const out = [];
  if (exportRange === 'monthly') {
    const slots = 5;
    const counts = Array(slots).fill(0);
    visits.forEach((v) => {
      const d = new Date(v.date);
      if (d.getFullYear() !== year || d.getMonth() + 1 !== month || Number.isNaN(d.getTime())) return;
      const slot = Math.min(slots - 1, Math.floor((d.getDate() - 1) / 7));
      counts[slot] += 1;
    });
    for (let i = 0; i < slots; i++) {
      const firstDayOfSlot = new Date(year, month - 1, i * 7 + 1);
      const mon = mondayOfWeekContaining(firstDayOfSlot);
      const monStr = mon.toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' });
      out.push({ label: `Week ${i + 1} (Mon ${monStr})`, count: counts[i] });
    }
  } else {
    const counts = Array(12).fill(0);
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    visits.forEach((v) => {
      const d = new Date(v.date);
      if (d.getFullYear() !== year || Number.isNaN(d.getTime())) return;
      counts[d.getMonth()] += 1;
    });
    for (let i = 0; i < 12; i++) {
      out.push({ label: monthNames[i], count: counts[i] });
    }
  }
  return out;
}

/**
 * Build report row spec (key + label) from TREATMENT_OPTIONS so report always matches treatment types.
 * Options with subType are expanded into detailed rows (extraction → 2, fillings → 3, temporary_filling → 1).
 */
function getReportRowSpec() {
  const rows = [];
  for (const opt of TREATMENT_OPTIONS) {
    if (opt.id === 'extraction') {
      rows.push({ key: 'extraction_permanent', label: 'Extraction (Permanent Teeth)' });
      rows.push({ key: 'extraction_temporary', label: 'Extraction (Temporary Teeth)' });
    } else if (opt.id === 'fillings') {
      rows.push({ key: 'fillings_number_teeth', label: 'Fillings – Number of teeth' });
      rows.push({ key: 'fillings_gi_per_surface', label: 'Fillings – Glass Ionomer per surface' });
      rows.push({ key: 'fillings_composite_per_surface', label: 'Fillings – Synthetic/Composite per surface' });
    } else if (opt.id === 'temporary_filling') {
      rows.push({ key: 'temporary_filling_per_surface', label: 'Temporary Filling per Surface' });
    } else {
      rows.push({ key: opt.id, label: opt.label });
    }
  }
  return rows;
}

const REPORT_ROW_SPEC = getReportRowSpec();
const REPORT_ROW_KEYS = REPORT_ROW_SPEC.map((r) => r.key);
const REPORT_ROW_LABELS = Object.fromEntries(REPORT_ROW_SPEC.map((r) => [r.key, r.label]));

/**
 * Parse a single treatment string and return updates to add to the detailed totals.
 * Returns a partial object like { extraction_permanent: 2 } or { oral_prophylaxis: 1 }.
 */
function parseTreatmentForReport(t) {
  const s = (t || '').trim();
  if (!s) return null;

  const toothScoped = s.match(/^Tooth\s+[^:]+:\s*(.+)$/i);
  if (toothScoped) return parseTreatmentForReport(toothScoped[1].trim());

  // Extraction (Permanent: X, Temporary: Y) or (Permanent: X) or (Temporary: Y) or legacy
  if (s.startsWith('Extraction (')) {
    const out = {};
    const bothMatch = s.match(/Permanent:\s*(\d+),\s*Temporary:\s*(\d+)/i);
    const permOnlyMatch = s.match(/Permanent:\s*(\d+)\)/i);
    const tempOnlyMatch = s.match(/Temporary:\s*(\d+)\)/i);
    if (bothMatch) {
      out.extraction_permanent = parseInt(bothMatch[1], 10);
      out.extraction_temporary = parseInt(bothMatch[2], 10);
    } else if (permOnlyMatch) {
      out.extraction_permanent = parseInt(permOnlyMatch[1], 10);
    } else if (tempOnlyMatch) {
      out.extraction_temporary = parseInt(tempOnlyMatch[1], 10);
    } else {
      const permMatch = s.match(/Permanent Teeth:\s*(\d+)/i);
      const tempMatch = s.match(/Temporary Teeth:\s*(\d+)/i);
      if (permMatch) out.extraction_permanent = parseInt(permMatch[1], 10);
      if (tempMatch) out.extraction_temporary = parseInt(tempMatch[1], 10);
      if (!permMatch && !tempMatch && s.includes('Teeth')) {
        if (s.includes('Permanent')) out.extraction_permanent = 1;
        else if (s.includes('Temporary')) out.extraction_temporary = 1;
      }
    }
    if (Object.keys(out).length) return out;
    return { extraction_permanent: 1 };
  }

  // Fillings / Restorations (Teeth: N, GI: X, Composite: Y) or legacy (N teeth, GI: X, Composite: Y)
  if (s.startsWith('Fillings / Restorations (')) {
    const m = s.match(/\(Teeth:\s*(\d+),\s*GI:\s*(\d+),\s*Composite:\s*(\d+)\)/i) || s.match(/\((\d+)\s*teeth,\s*GI:\s*(\d+),\s*Composite:\s*(\d+)\)/i);
    if (m) {
      return {
        fillings_number_teeth: parseInt(m[1], 10),
        fillings_gi_per_surface: parseInt(m[2], 10),
        fillings_composite_per_surface: parseInt(m[3], 10),
      };
    }
    return { fillings_number_teeth: 1, fillings_gi_per_surface: 0, fillings_composite_per_surface: 0 };
  }

  // Temporary Filling per Surface (Surfaces: N) or legacy (N)
  if (s.startsWith('Temporary Filling per Surface (')) {
    const m = s.match(/\(Surfaces:\s*(\d+)\)/i) || s.match(/\((\d+)\)/);
    return { temporary_filling_per_surface: m ? parseInt(m[1], 10) : 1 };
  }

  // Exact label match – any treatment type from TREATMENT_OPTIONS (simple ones, no subType detail)
  const opt = TREATMENT_OPTIONS.find((o) => o.label === s);
  if (opt && !opt.subType) return { [opt.id]: 1 };
  return { others: 1 };
}

/**
 * Aggregate visits into detailed report totals (extraction perm/temp, fillings teeth/GI/composite, etc.).
 */
export function aggregateTreatmentsDetailed(visits) {
  const totals = {};
  REPORT_ROW_KEYS.forEach((k) => { totals[k] = 0; });

  visits.forEach((visit) => {
    if (!visit.treatmentTypes || !visit.treatmentTypes.length) return;
    visit.treatmentTypes.forEach((treatment) => {
      const update = parseTreatmentForReport(treatment);
      if (update) {
        Object.entries(update).forEach(([key, value]) => {
          if (totals[key] !== undefined) totals[key] += value;
        });
      }
    });
  });
  return totals;
}

/**
 * Build Excel rows for the detailed report (all rows in fixed order).
 */
function buildDetailedReportRows(totals, title) {
  const rows = [
    [title],
    [],
    ['Treatment Type', 'Count'],
  ];
  REPORT_ROW_KEYS.forEach((key) => {
    rows.push([REPORT_ROW_LABELS[key], totals[key] || 0]);
  });
  return rows;
}

/**
 * Build rows for Excel (monthly): title "Treatment summary for [Month] [Year]"
 */
export function buildSummaryRows(aggregated, month, year) {
  const monthNames = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ];
  const title = `Treatment summary for ${monthNames[month - 1]} ${year}`;
  return buildDetailedReportRows(aggregated, title);
}

/**
 * Build rows for Excel (yearly): title "Treatment summary for [Year]"
 */
export function buildSummaryRowsForYear(aggregated, year) {
  const title = `Treatment summary for ${year}`;
  return buildDetailedReportRows(aggregated, title);
}

/** Legacy: aggregate for pie chart (big titles only). Derived from TREATMENT_OPTIONS + detailed totals. */
export function aggregateTreatmentsFromVisits(visits) {
  const detailed = aggregateTreatmentsDetailed(visits);
  const counts = {};
  for (const opt of TREATMENT_OPTIONS) {
    if (opt.id === 'extraction') {
      counts[opt.label] = (detailed.extraction_permanent || 0) + (detailed.extraction_temporary || 0);
    } else if (opt.id === 'fillings') {
      const hasFillings = (detailed.fillings_number_teeth || 0) + (detailed.fillings_gi_per_surface || 0) + (detailed.fillings_composite_per_surface || 0) > 0;
      counts[opt.label] = hasFillings ? 1 : 0;
    } else if (opt.id === 'temporary_filling') {
      counts[opt.label] = detailed.temporary_filling_per_surface || 0;
    } else {
      counts[opt.label] = detailed[opt.id] || 0;
    }
  }
  return counts;
}

/**
 * Generate and download an Excel file for the treatment summary.
 * @param {Array} visits - All visits (will be filtered by period)
 * @param {'monthly'|'yearly'} range - 'monthly' = one month, 'yearly' = full year
 * @param {number} month - 1-12 (used when range === 'monthly')
 * @param {number} year - e.g. 2025
 */
/**
 * @param {object} [options]
 * @param {{ from: string, to: string }} [options.dashboardDateFilter] — intersect with export month/year
 */
export async function downloadTreatmentSummaryExcel(visits, range, month, year, options = {}) {
  const { dashboardDateFilter } = options;
  const XLSX = await import('xlsx');
  const lib = XLSX.default || XLSX;
  let filtered = range === 'yearly'
    ? filterVisitsByYear(visits, year)
    : filterVisitsByMonthYear(visits, month, year);
  if (dashboardDateFilter?.from && dashboardDateFilter?.to) {
    filtered = filterVisitsByDateRange(filtered, dashboardDateFilter.from, dashboardDateFilter.to);
  }
  const aggregated = aggregateTreatmentsDetailed(filtered);
  const rows = range === 'yearly'
    ? buildSummaryRowsForYear(aggregated, year)
    : buildSummaryRows(aggregated, month, year);
  rows.push([]);
  rows.push(['Total visits in period', filtered.length]);

  const ws = lib.utils.aoa_to_sheet(rows);
  const colWidths = [{ wch: 40 }, { wch: 18 }];
  ws['!cols'] = colWidths;
  const wb = lib.utils.book_new();
  lib.utils.book_append_sheet(wb, ws, 'Treatment Summary');

  const children = await getAllChildren();
  const childMap = Object.fromEntries(children.map((c) => [c.childId, c]));

  const monthNamesLong = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ];
  const periodTitle =
    range === 'yearly'
      ? `Dataset overview — ${year}`
      : `Dataset overview — ${monthNamesLong[month - 1]} ${year}`;
  const overviewRows = [[periodTitle], []];
  if (dashboardDateFilter?.from && dashboardDateFilter?.to) {
    overviewRows.push(['Additional date filter (intersect)', `${dashboardDateFilter.from} to ${dashboardDateFilter.to}`]);
    overviewRows.push([]);
  }
  overviewRows.push(['Total visits (export scope)', filtered.length]);
  overviewRows.push(['Distinct patients with visits', new Set(filtered.map((v) => v.childId)).size]);
  overviewRows.push([
    'Distinct schools (from visits)',
    new Set(
      filtered.map((v) => childMap[v.childId]?.school).filter(Boolean)
    ).size
  ]);
  overviewRows.push([]);

  overviewRows.push(['Visits by school', 'Count']);
  const visitCountBySchool = {};
  filtered.forEach((v) => {
    const sch = childMap[v.childId]?.school;
    if (sch) visitCountBySchool[sch] = (visitCountBySchool[sch] || 0) + 1;
  });
  Object.entries(visitCountBySchool)
    .sort((a, b) => b[1] - a[1])
    .forEach(([school, count]) => overviewRows.push([school, count]));

  overviewRows.push([]);
  overviewRows.push([
    range === 'monthly' ? 'Visits by week (Mon = week of)' : 'Visits by month',
    'Count'
  ]);
  buildVisitsByPeriodForExport(range, month, year, filtered).forEach((row) => {
    overviewRows.push([row.label, row.count]);
  });

  overviewRows.push([]);
  overviewRows.push(['Treatment category (same logic as dashboard)', 'Count']);
  const treatmentCategorySet = new Set();
  filtered.forEach((visit) => {
    if (visit.treatmentTypes && visit.treatmentTypes.length > 0) {
      visit.treatmentTypes.forEach((treatment) => {
        const parsed = getTreatmentCategoryAndValue(treatment);
        if (parsed) treatmentCategorySet.add(parsed.category);
      });
    }
  });
  const treatmentStackKeys = sortTreatmentCategoryList(treatmentCategorySet);
  const treatmentsByTypeCounts = {};
  treatmentStackKeys.forEach((k) => {
    treatmentsByTypeCounts[k] = 0;
  });
  filtered.forEach((visit) => {
    if (visit.treatmentTypes && visit.treatmentTypes.length > 0) {
      visit.treatmentTypes.forEach((treatment) => {
        const parsed = getTreatmentCategoryAndValue(treatment);
        if (parsed && treatmentsByTypeCounts[parsed.category] != null) {
          treatmentsByTypeCounts[parsed.category] += parsed.value;
        } else if (parsed) {
          treatmentsByTypeCounts[parsed.category] = (treatmentsByTypeCounts[parsed.category] || 0) + parsed.value;
        }
      });
    }
  });
  treatmentStackKeys.forEach((type) => {
    const c = treatmentsByTypeCounts[type] || 0;
    if (c > 0) overviewRows.push([type, c]);
  });

  const ws2 = lib.utils.aoa_to_sheet(overviewRows);
  ws2['!cols'] = [{ wch: 48 }, { wch: 14 }];
  lib.utils.book_append_sheet(wb, ws2, 'Dashboard overview');

  const fileName = range === 'yearly'
    ? `treatment-summary-${year}.xlsx`
    : `treatment-summary-${year}-${String(month).padStart(2, '0')}.xlsx`;
  lib.writeFile(wb, fileName);
}
