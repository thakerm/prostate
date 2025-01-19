/***************************************************************
 * GLOBAL: allReports[] holds multiple parsed reports
 ***************************************************************/
let allReports = [];

/***************************************************************
 * 1) Event: "Process Reports"
 *    - Grab user inputs (PSA range + T stage)
 *    - Parse the text => multiple reports
 *    - Build table
 *    - Compute highest Gleason sum => calc NCCN risk
 ***************************************************************/
document.getElementById("processBtn").addEventListener("click", () => {
  const rawText = document.getElementById("reportText").value.trim();
  if (!rawText) {
    alert("Please paste at least one report.");
    return;
  }

  // 1) Get user selections
  const psaRange = document.getElementById("psaSelect").value; // "<10", "10-20", ">20"
  const tStage = document.getElementById("stageSelect").value; // e.g. "T2b"

  // 2) Split text into multiple reports
  const chunks = chunkReports(rawText);
  if (!chunks.length) {
    alert("No valid reports found. Checking 'Provider:' markers.");
    return;
  }

  // Clear any old data
  allReports = [];

  // 3) Parse each chunk
  chunks.forEach((chunk) => {
    const parsed = parseSingleReport(chunk);
    const finalDate = parsed.collectedDate || "Unknown";
    if (!parsed.samples.length && finalDate === "Unknown") return;

    allReports.push({
      date: finalDate,
      samples: parsed.samples
    });
  });

  // 4) Sort by date desc
  sortReportsByDateDesc(allReports);

  // 5) Build table
  buildComparisonTable(allReports);

  // 6) Find highest Gleason sum
  const maxGleason = findMaxGleasonSum(allReports);

  // 7) Compute simplified NCCN risk
  const riskGroup = calcNCCNRiskGroup(psaRange, maxGleason, tStage);

  // 8) Display
  document.getElementById("nccnRiskResult").textContent = riskGroup;
});

/***************************************************************
 * chunkReports => detect multiple "Provider:" blocks
 ***************************************************************/
function chunkReports(raw) {
  const splitted = raw.split(/(?=^Provider:\s)/im);
  return splitted.map(s => s.trim()).filter(Boolean);
}

/***************************************************************
 * parseSingleReport => { collectedDate, samples[] }
 ***************************************************************/
function parseSingleReport(txt) {
  const date = parseCollectedDate(txt);
  const samples = parseSamples(txt);
  return { collectedDate: date, samples };
}

/***************************************************************
 * parseCollectedDate => "Collected: 12/6/2023"
 ***************************************************************/
function parseCollectedDate(text) {
  const m = text.match(/Collected:\s*([0-9\/-]+)/i);
  return m ? m[1].trim() : "";
}

/***************************************************************
 * parseSamples => multi-line approach for A), B), ...
 ***************************************************************/
function parseSamples(text) {
  const lines = text.split(/\r?\n/);
  const samples = [];

  let curr = null;
  const sampleHeaderRegex = /^([A-Z])[\.\)]\s*(.*)/;

  lines.forEach(line => {
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
        if (!curr.foundDx) curr.locLines.push(trimmed);
        else curr.diagLines.push(trimmed);
      }
    }
  });
  if (curr) samples.push(finalizeSample(curr));
  return samples;
}

/***************************************************************
 * finalizeSample => parse location, diagnosis, gleason, etc.
 ***************************************************************/
function finalizeSample(s) {
  const locRaw = s.locLines.join(" ");
  const shortLoc = parseLocation(locRaw, s.label);

  const diagText = s.diagLines.join(" ");
  const shortDx = parseShortDiagnosis(diagText);
  const gl = extractGleasonScore(diagText);
  const cpos = extractCoresPositive(diagText);
  const size = extractMaxCoreSize(diagText);

  return {
    sampleLabel: s.label,
    location: shortLoc,
    diagnosis: shortDx, 
    gleasonScore: gl, // e.g. "3+4=7"
    coresPositive: cpos,
    maxCoreSize: size
  };
}

function parseLocation(loc, label) {
  let str = loc.replace(/PROSTATE[^,]*,\s*/i, "");
  str = str.replace(/NEEDLE\s*CORE\s*BIOPSY/i, "");
  str = str.replace(/LESION\s*ZONE\s*[A-Z]+\s*-\s*/i, "");
  str = str.replace(/\bMRI\s*DIRECTED\s*\b.*$/i, "");
  str = str.replace(/\s+:\s*$/, "");
  str = str.trim();

  // if "target #1" => "Target 1"
  str = str.replace(/target\s*#(\d+)/i, "Target $1");
  const match = str.match(/(Target\s*\d+)/i);
  if (match) {
    str = match[1];
  }

  // remove leading label + space
  if (str.startsWith(label + " ")) {
    str = str.slice(label.length + 1);
  }

  return str || "N/A";
}

function parseShortDiagnosis(txt) {
  if (/adenocarcinoma/i.test(txt)) return "AdenoCA";
  if (/benign/i.test(txt)) return "Benign";
  return "N/A";
}

/***************************************************************
 * Gleason => "3+4=7" or "N/A"
 ***************************************************************/
function extractGleasonScore(text) {
  const m = text.match(/gleason\s*(score)?\s*(\d+\s*\+\s*\d+\s*=\s*\d+)/i);
  if (m) return m[2].replace(/\s+/g, "");
  return "N/A";
}

/***************************************************************
 * Cores => "2/3(67%)" or "N/A"
 ***************************************************************/
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

/***************************************************************
 * Size => "5mm" or "N/A"
 ***************************************************************/
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

/***************************************************************
 * findMaxGleasonSum(reports)
 * scans all samples => highest sum from e.g. "3+4=7" => 7
 ***************************************************************/
function findMaxGleasonSum(reports) {
  let maxSum = 0;
  reports.forEach(r => {
    r.samples.forEach(s => {
      if (s.gleasonScore && s.gleasonScore !== "N/A") {
        const sumMatch = s.gleasonScore.match(/(\d+)\+\d+=(\d+)/);
        if (sumMatch) {
          const sumVal = parseInt(sumMatch[2], 10);
          if (sumVal > maxSum) {
            maxSum = sumVal;
          }
        }
      }
    });
  });
  return maxSum;
}

/***************************************************************
 * calcNCCNRiskGroup(psaRange, maxGleason, tStage)
 * Very simplified logic:
 *  - if T1c + Gleason <=6 + PSA<10 => Very Low
 *  - if T1-T2a + Gleason<=6 + PSA<10 => Low
 *  - if Gleason=7 or T2 + PSA 10-20 => Intermediate
 *  - if Gleason>=8 or T3 or PSA>20 => High/VeryHigh
 ***************************************************************/
function calcNCCNRiskGroup(psaRange, gleasonSum, tStage) {
  // convert T2a => stageNum=2, T3b =>3...
  const stageNum = parseTStageNumber(tStage);

  // Convert PSA range to numeric range
  let minPSA = 0;
  let maxPSA = 9999; 
  if (psaRange === "<10") {
    maxPSA = 10;
  } else if (psaRange === "10-20") {
    minPSA = 10; 
    maxPSA = 20;
  } else if (psaRange === ">20") {
    minPSA = 20.1;
  }

  // We'll define boolean checks:
  const isPSAunder10 = (maxPSA <= 10);
  const isPSA10to20 = (minPSA === 10 && maxPSA === 20);
  const isPSAover20 = (minPSA > 20);

  // 1) Very Low
  //    T1c, Gleason <=6, PSA <10
  if (tStage === "T1c" && gleasonSum <= 6 && isPSAunder10) {
    return "Very Low";
  }

  // 2) Low
  //    T1-T2a, Gleason <=6, PSA<10
  if (stageNum <= 2 && gleasonSum <= 6 && isPSAunder10) {
    return "Low";
  }

  // 3) Intermediate
  //    (T2b or T2c) or Gleason=7 or PSA 10-20 => "Intermediate"
  //    We won't break out Fav vs Unfav here, just "Intermediate"
  if (gleasonSum === 7 || (isPSA10to20) || (stageNum === 2)) {
    return "Intermediate";
  }

  // 4) High/Very High
  //    Gleason >=8 or T3 or PSA>20 => "High" or "Very High"
  if (gleasonSum >= 8 || stageNum >= 3 || isPSAover20) {
    // if T3b or T4 => Very High
    if (tStage === "T3b" || tStage === "T4") {
      return "Very High";
    }
    return "High";
  }

  // fallback
  return "Low";
}

function parseTStageNumber(tStage) {
  const m = tStage.match(/^T(\d+)/i);
  if (m) return parseInt(m[1], 10);
  return 1;
}

/***************************************************************
 * sortReportsByDateDesc => newest first
 ***************************************************************/
function sortReportsByDateDesc(arr) {
  arr.sort((a, b) => {
    const dA = Date.parse(a.date);
    const dB = Date.parse(b.date);
    return (isNaN(dB) ? 0 : dB) - (isNaN(dA) ? 0 : dA);
  });
}

/***************************************************************
 * buildComparisonTable => single cell per report
 ***************************************************************/
function buildComparisonTable(reports) {
  const thead = document.querySelector("#comparisonTable thead");
  const tbody = document.querySelector("#comparisonTable tbody");
  thead.innerHTML = "";
  tbody.innerHTML = "";

  if (!reports.length) return;

  // gather sample labels
  const allLabels = new Set();
  reports.forEach(r => {
    r.samples.forEach(s => allLabels.add(s.sampleLabel));
  });
  const sortedLabels = [...allLabels].sort();

  // header row => Sample, Location, then 1 col per date
  const hdrRow = document.createElement("tr");

  // Sample
  const smpTh = document.createElement("th");
  smpTh.textContent = "Sample";
  hdrRow.appendChild(smpTh);

  // Location
  const locTh = document.createElement("th");
  locTh.textContent = "Location";
  hdrRow.appendChild(locTh);

  // each report => date col
  reports.forEach(r => {
    const th = document.createElement("th");
    th.textContent = r.date;
    hdrRow.appendChild(th);
  });
  thead.appendChild(hdrRow);

  // body => 1 row per sample
  sortedLabels.forEach(label => {
    const row = document.createElement("tr");

    // sample cell
    const labelTd = document.createElement("td");
    labelTd.textContent = label;
    row.appendChild(labelTd);

    // location => from first that has label
    let foundLoc = "N/A";
    for (let i = 0; i < reports.length; i++) {
      const s = reports[i].samples.find(x => x.sampleLabel === label);
      if (s) {
        foundLoc = s.location;
        break;
      }
    }
    const locTd = document.createElement("td");
    locTd.textContent = foundLoc;
    row.appendChild(locTd);

    // single cell for each report
    reports.forEach(rep => {
      const cell = document.createElement("td");
      const sample = rep.samples.find(x => x.sampleLabel === label);
      if (!sample) {
        cell.textContent = "N/A";
      } else {
        // build short text e.g. "AdenoCA, G=3+4=7, C=2/3(67%), Sz=5mm"
        let combined = "";
        if (sample.diagnosis && sample.diagnosis !== "N/A") {
          combined += sample.diagnosis;
        }
        if (sample.gleasonScore && sample.gleasonScore !== "N/A") {
          combined += (combined ? ", G=" : "G=") + sample.gleasonScore;
        }
        if (sample.coresPositive && sample.coresPositive !== "N/A") {
          combined += (combined ? ", C=" : "C=") + sample.coresPositive;
        }
        if (sample.maxCoreSize && sample.maxCoreSize !== "N/A") {
          combined += (combined ? ", Sz=" : "Sz=") + sample.maxCoreSize;
        }
        if (!combined) combined = "N/A";
        cell.textContent = combined;
      }
      row.appendChild(cell);
    });

    tbody.appendChild(row);
  });
}
