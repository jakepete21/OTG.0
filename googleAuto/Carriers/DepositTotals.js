/***** ===== Deposit Totals Builder (NEW HEADERS - FIXED v2) ===== *****/

/** Build or refresh the "Deposit Totals" sheet in destSs. */
function buildDepositTotals_(destSs) {
    // 1) Get or rename "Deposit Totals"
    let sh = destSs.getSheetByName("Deposit Totals");
    if (!sh) {
      const s1 = destSs.getSheetByName("Sheet1");
      sh = s1 ? (s1.setName("Deposit Totals"), s1) : destSs.insertSheet("Deposit Totals");
    }
    sh.clearContents();
  
    // ========== TABLE 1: Provider Totals ==========
    // rowsOut: [Provider, Category, Total]
    const rowsOut = [];
  
    rowsOut.push(["Lumen",     "All", sumByHeader_(destSs, "Lumen",     "Commission Amount")]);
    rowsOut.push(["TBO",       "All", sumByHeader_(destSs, "TBO",       "Commission Amount")]);
    rowsOut.push(["MetTel",    "All", sumByHeader_(destSs, "MetTel",    "Commission Amount")]);
    rowsOut.push(["Allstream", "All", sumByHeader_(destSs, "Allstream", "Commission Amount")]);
  
    // GoTo: group by Type, sum Commission Amount
    rowsOut.push(...groupSheetByHeader_(destSs, "GoTo", "Type", "Commission Amount", "GoTo"));
  
    rowsOut.push(["Zayo", "All", sumByHeader_(destSs, "Zayo", "Commission Amount")]);
  
    // Write Table 1
    const headers1 = ["Provider", "Category", "Total"];
    sh.getRange(1, 1, 1, headers1.length).setValues([headers1]).setFontWeight("bold");
  
    let nextRow = 2;
    if (rowsOut.length) {
      sh.getRange(nextRow, 1, rowsOut.length, headers1.length).setValues(rowsOut);
      sh.getRange(nextRow, 3, rowsOut.length, 1).setNumberFormat('$#,##0.00;-$#,##0.00');
      nextRow += rowsOut.length;
    }
  
    // Blank spacer row
    nextRow += 1;
  
    // ========== TABLE 2: Commissionable to OTG (from Matches) ==========
    // NOW: bucket to only carriers + GoTo sections + ENA
    const matchesAgg = groupMatchesForDepositTotals_Bucketed_(destSs); // [Label, Total]
    const headers2 = ["Commissionable to OTG", "Total"];
    sh.getRange(nextRow, 1, 1, headers2.length).setValues([headers2]).setFontWeight("bold");
    nextRow += 1;
  
    if (matchesAgg.length) {
      sh.getRange(nextRow, 1, matchesAgg.length, headers2.length).setValues(matchesAgg);
      sh.getRange(nextRow, 2, matchesAgg.length, 1).setNumberFormat('$#,##0.00;-$#,##0.00');
      nextRow += matchesAgg.length;
    }
  
    sh.autoResizeColumns(1, 5);
    sh.setFrozenRows(1);
  }
  
  
  /** ===== Generic helpers that use HEADER NAMES (not fixed columns) ===== */
  
  function sumByHeader_(ss, sheetName, headerName) {
    const sh = ss.getSheetByName(sheetName);
    if (!sh) return 0;
  
    const lastRow = sh.getLastRow();
    const lastCol = sh.getLastColumn();
    if (lastRow < 2 || lastCol < 1) return 0;
  
    const col = findHeaderCol1_(sh, headerName);
    if (!col) return 0;
  
    const vals = sh.getRange(2, col, lastRow - 1, 1).getValues();
    let sum = 0;
    for (let i = 0; i < vals.length; i++) {
      const n = toNum_(vals[i][0]);
      if (n !== 0) sum += n;
    }
    return +sum.toFixed(2);
  }
  
  /**
   * Group a sheet by a label header, summing a numeric header.
   * Returns rows: [providerName, labelValue, total]
   */
  function groupSheetByHeader_(ss, sheetName, labelHeader, sumHeader, providerName) {
    const sh = ss.getSheetByName(sheetName);
    const out = [];
    if (!sh) return out;
  
    const lastRow = sh.getLastRow();
    const lastCol = sh.getLastColumn();
    if (lastRow < 2 || lastCol < 1) return out;
  
    const labelCol = findHeaderCol1_(sh, labelHeader);
    const sumCol   = findHeaderCol1_(sh, sumHeader);
    if (!labelCol || !sumCol) return out;
  
    const vals = sh.getRange(2, 1, lastRow - 1, lastCol).getValues();
    const map = new Map();
  
    for (let i = 0; i < vals.length; i++) {
      const label = String(vals[i][labelCol - 1] || "").trim() || "(blank)";
      const amt   = toNum_(vals[i][sumCol - 1]);
      if (amt === 0) continue;
      map.set(label, (map.get(label) || 0) + amt);
    }
  
    Array.from(map.entries())
      .sort((a, b) => String(a[0]).localeCompare(String(b[0])))
      .forEach(([label, total]) => out.push([providerName, label, +total.toFixed(2)]));
  
    return out;
  }
  
  /**
   * Matches (NEW): Bucket into only:
   *  - ENA (from Provider)
   *  - GoTo sections (from Carrier Statement, e.g. "GoTo", "GoTo Equipment", "GoTo (SPIFF Upfront)", etc.)
   *  - Everything else by Carrier Statement (Lumen, MetTel, TBO, Zayo, Allstream...)
   *
   * Returns rows: [Label, Total]
   */
  function groupMatchesForDepositTotals_Bucketed_(ss) {
    const sh = ss.getSheetByName("Matches");
    if (!sh) return [];
  
    const lastRow = sh.getLastRow();
    const lastCol = sh.getLastColumn();
    if (lastRow < 2 || lastCol < 1) return [];
  
    const commCol    = findHeaderCol1_(sh, "Commission Amount");
    const providerCol= findHeaderCol1_(sh, "Provider");
    const carrierCol = findHeaderCol1_(sh, "Carrier Statement"); // GoTo Type lives here in Matches
    if (!commCol) return [];
  
    const vals = sh.getRange(2, 1, lastRow - 1, lastCol).getValues();
    const map = new Map();
  
    for (let i = 0; i < vals.length; i++) {
      const comm = toNum_(vals[i][commCol - 1]);
      if (comm === 0) continue;
  
      const provider = providerCol ? String(vals[i][providerCol - 1] || "").trim() : "";
      const carrier  = carrierCol  ? String(vals[i][carrierCol - 1]  || "").trim() : "";
  
      const providerUp = provider.toUpperCase();
      const carrierUp  = carrier.toUpperCase();
  
      let label = carrier || "(blank)";
  
      // 1) ENA bucket (regardless of carrier)
      if (providerUp === "ENA") {
        label = "ENA";
      }
      // 2) GoTo buckets: keep GoTo sections if carrier statement says GoTo...
      else if (carrierUp.startsWith("GOTO")) {
        // keep exact label like "GoTo", "GoTo Equipment", "GoTo (SPIFF Upfront)", etc.
        label = carrier || "GoTo";
      }
      // 3) Otherwise: group by Carrier Statement (your carriers)
      else {
        // normalize a few known carriers if blank / weird
        label = carrier || provider || "(blank)";
      }
  
      map.set(label, (map.get(label) || 0) + comm);
    }
  
    // Optional: sort with your preferred order first, then anything else alphabetically
    const preferred = [
      "Allstream",
      "ENA",
      "GoTo",
      "GoTo (SPIFF Upfront)",
      "GoTo Equipment",
      "Lumen",
      "MetTel",
      "TBO",
      "Zayo"
    ];
  
    const entries = Array.from(map.entries()).map(([k, v]) => [k, +v.toFixed(2)]);
  
    const prefIndex = new Map(preferred.map((x, i) => [x.toUpperCase(), i]));
  
    entries.sort((a, b) => {
      const ai = prefIndex.has(String(a[0]).toUpperCase()) ? prefIndex.get(String(a[0]).toUpperCase()) : 9999;
      const bi = prefIndex.has(String(b[0]).toUpperCase()) ? prefIndex.get(String(b[0]).toUpperCase()) : 9999;
      if (ai !== bi) return ai - bi;
      return String(a[0]).localeCompare(String(b[0]));
    });
  
    return entries;
  }
  
  /** Find a header column by name (case-insensitive, whitespace-normalized). Returns 1-based col # or null. */
  function findHeaderCol1_(sh, headerName) {
    const lastCol = sh.getLastColumn();
    if (!lastCol) return null;
  
    const norm = (s) => String(s == null ? "" : s).trim().toLowerCase().replace(/\s+/g, " ");
    const target = norm(headerName);
  
    const headers = sh.getRange(1, 1, 1, lastCol).getValues()[0].map(norm);
    const idx = headers.indexOf(target);
    return idx === -1 ? null : idx + 1;
  }
  
  /** Parse numbers safely from currency-ish strings. */
  function toNum_(v) {
    const n = parseFloat(String(v).replace(/[^0-9.\-]/g, ''));
    return isNaN(n) ? 0 : n;
  }
  