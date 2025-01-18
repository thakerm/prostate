/************************************************
 * GLOBAL: allReports[] to store parsed reports
 ************************************************/
let allReports = [];

/************************************************
 * 1) Add to Comparison
 *    - Splits user input into multiple reports
 *    - Parses each
 *    - Sort by date desc
 *    - Builds table
 ************************************************/
document.getElementById("processMultipleBtn").addEventListener("click", () => {
  const rawText = document.getElementById("reportText").value.trim();
  if (!rawText) {
    alert("Please paste at least one report.");
    return;
  }

  const chunks = chunkReports(rawText);
  if (!chunks.length) {
    alert("No valid reports found (looking for 'Provider:' markers).");
    return;
  }

  chunks.forEach((chunk) => {
    const parsed = parseSingleReport(chunk);
    const finalDate = parsed.collectedDate || "Unknown";
    if (!parsed.samples.length && finalDate === "Unknown") {
      // skip truly empty
      return;
    }
    allReports.push({
      date: finalDate,
      samples: parsed.samples
    });
  });

  document.getElementById("reportText").value = "";
  sortReportsByDateDesc(allReports);
  buildComparisonTable(allReports);
});

/************************************************
 * chunkReports => detect multiple "Provider:"
 ************************************************/
function chunkReports(raw) {
  const splitted = raw.split(/(?=^Provider:\s)/im);
  return splitted.map(s => s.trim()).filter(Boolean);
}

/************************************************
 * parseSingleReport => { collectedDate, samples[] }
 ************************************************/
function parseSingleReport(txt) {
  const date = parseCollectedDate(txt);
  const samples = parseSamples(txt);
  return { collectedDate: date, samples };
}

function parseCollectedDate(text) {
  const m = text.match(/Collected:\s*([0-9\/-]+)/i);
  return m ? m[1].trim() : "";
}

/************************************************
 * parseSamples => multi-line approach
 ************************************************/
function parseSamples(text) {
  const lines = text.split(/\r?\n/);
  const samples = [];
  let curr = null;
  const sampleHeaderRegex = /^([A-Z])[\.\)]\s*(.*)/;

  for (let line of lines) {
    const trimmed = line.trim();
    const headerMatch = trimmed.match(sampleHeaderRegex);
    if (headerMatch) {
      if (curr) samples.push(finalizeSample(curr));
      curr = {
        label: headerMatch[1],
        locLines: [],
        diagLines: [],
        foundDx: false
      };
      if (headerMatch[2]) curr.locLines.push(headerMatch[2].trim());
    } else if (curr) {
      if (trimmed.startsWith("-")) {
        curr.foundDx = true;
        curr.diagLines.push(trimmed.replace(/^-+\s*/, ""));
      } else {
        if (!curr.foundDx) {
          curr.locLines.push(trimmed);
        } else {
          curr.diagLines.push(trimmed);
        }
      }
    }
  }
  if (curr) samples.push(finalizeSample(curr));
  return samples;
}

/************************************************
 * finalizeSample => short location, short dx
 ************************************************/
function finalizeSample(s) {
  const locRaw = s.locLines.join(" ");
  const shortLoc = parseLocation(locRaw, s.label);

  const diagText = s.diagLines.join(" ");
  const shortDx = parseShortDiagnosis(diagText);
  const gl = extractGleasonScore(diagText);
  const crs = extractCoresPositive(diagText);
  const sz = extractMaxCoreSize(diagText);

  return {
    sampleLabel: s.label,
    location: shortLoc,
    diagnosis: shortDx,
    gleasonScore: gl,
    coresPositive: crs,
    maxCoreSize: sz
  };
}

/************************************************
 * parseLocation => remove "PROSTATE, NEEDLE...", etc.
 * For targets, label only "Target 1", "Target 2," etc.
 ************************************************/
function parseLocation(loc, label) {
  let str = loc;
  // remove "PROSTATE, LEFT APEX, NEEDLE CORE BIOPSY"
  // or "PROSTATE, RIGHT MID, LESION ZONE..."
  str = str.replace(/PROSTATE[^,]*,\s*/i, "");
  str = str.replace(/NEEDLE\s*CORE\s*BIOPSY/i, "");
  str = str.replace(/LESION\s*ZONE\s*[A-Z]+\s*-\s*/i, "");
  str = str.replace(/\bMRI\s*DIRECTED\s*(NEEDLE\s*CORE\s*BIOPSY)?/i, "");
  // unify spacing
  str = str.replace(/\s+/g, " ").trim();

  // If it contains "Target #1" => we rename "Target 1" only
  // or if it says "target #2," etc.
  str = str.replace(/target\s*#(\d+)/i, "Target $1");

  // If user wants NOTHING else if it's a target lesion:
  // e.g. if we detect "Target 1" in the string, we remove the rest
  if (/Target\s*\d+/i.test(str)) {
    // just keep "Target X"
    const match = str.match(/(Target\s*\d+)/i);
    if (match) {
      str = match[1]; // e.g. "Target 1"
    }
  }

  // If there's a trailing colon
  str = str.replace(/:\s*$/, "");

  // remove "A " if it exactly matches sample label + space
  const prefix = label + " ";
  if (str.startsWith(prefix)) {
    str = str.slice(prefix.length);
  }

  return str.trim() || "N/A";
}

/************************************************
 * parseShortDiagnosis => e.g. "AdenoCA; PNI"
 ************************************************/
function parseShortDiagnosis(txt) {
  // skip signature lines
  if (/electronically\s*signed\s*by/i.test(txt)) return "";
  if (/\bM\.?D\.?\b/i.test(txt)) return "";

  const low = txt.toLowerCase();
  let parts = [];

  if (/adenocarcinoma/i.test(txt)) parts.push("AdenoCA");
  if (/small cell/i.test(txt)) parts.push("SmallCell");
  if (/perineural invasion/i.test(txt)) parts.push("PNI");
  if (/cribriform/i.test(txt)) parts.push("Cribriform");
  
  if (!parts.length) {
    if (/benign/i.test(txt)) return "Benign";
    return "N/A";
  }
  return parts.join("; ");
}

/************************************************
 * extractGleasonScore, extractCoresPositive, etc.
 ************************************************/
function extractGleasonScore(text) {
  const m = text.match(/gleason\s*(score)?\s*(\d+\s*\+\s*\d+\s*=\s*\d+)/i);
  if (m) return m[2].replace(/\s+/g, "");
  return "N/A";
}

function extractCoresPositive(text) {
  let m = text.match(/involving\s*(\d+)\s*of\s*(\d+)\s*cores/i);
  if (m) return formatCores(m[1], m[2]);
  m = text.match(/involving\s*(\d+)\/(\d+)\s*cores/i);
  if (m) return formatCores(m[1], m[2]);
  m = text.match(/(\d+)\s*of\s*(\d+)\s*cores/i);
  if (m) return formatCores(m[1], m[2]);
  m = text.match(/(\d+)\/(\d+)\s*cores/i);
  if (m) return formatCores(m[1], m[2]);
  return "N/A";
}

function formatCores(x, y) {
  const X = parseInt(x, 10);
  const Y = parseInt(y, 10);
  if (!isNaN(X) && !isNaN(Y) && Y !== 0) {
    const pct = Math.round((X / Y) * 100);
    return `${X}/${Y}(${pct}%)`;
  }
  return "N/A";
}

function extractMaxCoreSize(text) {
  const norm = text.replace(/\s+/g, " ").toLowerCase();
  const pattern = /tumor\s+measures\s+(\d+)\s*mm\s+in\s+(\d+)\s*mm\s*core/g;
  let match;
  let maxSize = null;
  while ((match = pattern.exec(norm)) !== null) {
    const sz = parseInt(match[1], 10);
    if (maxSize === null || sz > maxSize) {
      maxSize = sz;
    }
  }
  return maxSize === null ? "N/A" : `${maxSize}mm`;
}

/************************************************
 * sortReportsByDateDesc => newest first
 ************************************************/
function sortReportsByDateDesc(arr) {
  arr.sort((a, b) => {
    const dA = Date.parse(a.date);
    const dB = Date.parse(b.date);
    return (isNaN(dB) ? 0 : dB) - (isNaN(dA) ? 0 : dA);
  });
}

/************************************************
 * 2) buildComparisonTable => 
 *    1 row per sample, 1 col for Sample, 1 col for Loc,
 *    then 1 col per report with combined data
 ************************************************/
function buildComparisonTable(reports) {
  const thead = document.querySelector("#comparisonTable thead");
  const tbody = document.querySelector("#comparisonTable tbody");
  thead.innerHTML = "";
  tbody.innerHTML = "";

  if (!reports.length) return;

  // gather all sample labels
  const labels = new Set();
  reports.forEach((r) => {
    r.samples.forEach((s) => labels.add(s.sampleLabel));
  });
  const sortedLabels = [...labels].sort();

  // build header
  const hdrRow = document.createElement("tr");

  // sample + location
  const smpTh = document.createElement("th");
  smpTh.textContent = "Sample";
  hdrRow.appendChild(smpTh);

  const locTh = document.createElement("th");
  locTh.textContent = "Location";
  hdrRow.appendChild(locTh);

  // then each report => date col
  reports.forEach((r) => {
    const th = document.createElement("th");
    th.textContent = r.date;
    hdrRow.appendChild(th);
  });
  thead.appendChild(hdrRow);

  // build body
  sortedLabels.forEach((label) => {
    const row = document.createElement("tr");

    const labelTd = document.createElement("td");
    labelTd.textContent = label;
    row.appendChild(labelTd);

    // location => from first (most recent) that has it
    let foundLoc = "N/A";
    for (let i = 0; i < reports.length; i++) {
      const smp = reports[i].samples.find(s => s.sampleLabel === label);
      if (smp) {
        foundLoc = smp.location;
        break;
      }
    }
    const locTd = document.createElement("td");
    locTd.textContent = foundLoc;
    row.appendChild(locTd);

    // for each report => single cell
    reports.forEach((rep) => {
      const sample = rep.samples.find(s => s.sampleLabel === label);
      const cell = document.createElement("td");

      if (sample) {
        // combine dx, gleason, cores, size into short text
        let combined = "";
        if (sample.diagnosis && sample.diagnosis !== "N/A") {
          combined += sample.diagnosis;
        }
        if (sample.gleasonScore && sample.gleasonScore !== "N/A") {
          combined += (combined ? "; G=" : "G=") + sample.gleasonScore;
        }
        if (sample.coresPositive && sample.coresPositive !== "N/A") {
          combined += (combined ? "; C=" : "C=") + sample.coresPositive;
        }
        if (sample.maxCoreSize && sample.maxCoreSize !== "N/A") {
          combined += (combined ? "; Sz=" : "Sz=") + sample.maxCoreSize;
        }
        if (!combined) {
          // if all fields are N/A => "N/A" or "Benign"
          // here we check if diagnosis was "Benign"
          if (sample.diagnosis === "Benign") {
            combined = "Benign";
          } else {
            combined = "N/A";
          }
        }

        cell.textContent = combined;
      } else {
        cell.textContent = "N/A";
      }
      row.appendChild(cell);
    });
    tbody.appendChild(row);
  });
}
