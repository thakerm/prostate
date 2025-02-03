/*********************************************************************
 * 1) GLOBAL DATA: allReports[] holds multiple reports, each with:
 *    {
 *      date: "12/6/2023",    // from "Collected: ..."
 *      dob: "1/1/1954",      // optional
 *      age: 69,              // computed from dob
 *      samples: [ ... ],     // parsed A/B/C sample data
 *      maxGleasonSum: number,
 *      nccnRisk: "Low"|"Intermediate"|...,
 *      ...
 *    }
 *********************************************************************/
let allReports = [];

/*********************************************************************
 * 2) EVENT: "Process Reports"
 *    - Split text by "Provider:" => multiple chunks
 *    - For each chunk, parse "DOB" (if present), parse "FINAL PATHOLOGIC DIAGNOSIS",
 *      ignoring disclaimers, etc.
 *    - Extract sample data, find max Gleason => compute nccn risk
 *    - Also compute age from the found DOB
 *    - Build comparison table, show risk of the newest report
 *********************************************************************/
document.getElementById("processBtn").addEventListener("click", () => {
  const rawText = document.getElementById("reportText").value.trim();
  if (!rawText) {
    alert("Please paste at least one pathology report.");
    return;
  }

  // 1) get PSA range + T stage
  const psaRange = document.getElementById("psaSelect").value; 
  const tStage = document.getElementById("stageSelect").value;

  // 2) chunk by "Provider:"
  const chunks = chunkReports(rawText);
  if (!chunks.length) {
    alert("No valid reports found. Checking for 'Provider:' lines.");
    return;
  }

  allReports = []; // reset

  // 3) parse each chunk
  chunks.forEach(chunk => {
    const date = parseCollectedDate(chunk) || "Unknown";
    
    // parse DOB if present
    const dobStr = parseDob(chunk);
    const ageVal = dobStr ? calcAgeFromDob(dobStr) : null;

    // parse final dx lines ignoring disclaimers
    const finalDxLines = extractFinalDxLines(chunk);
    const samples = parseSamplesFromDx(finalDxLines);

    // find highest gleason in these samples
    const maxG = findMaxGleasonSum(samples);
    // compute risk
    const riskGroup = calcNCCNRiskGroup(psaRange, maxG, tStage);

    // store
    allReports.push({
      date,
      dob: dobStr,
      age: ageVal,
      samples,
      maxGleasonSum: maxG,
      nccnRisk: riskGroup
    });
  });

  // 4) sort desc by date
  sortReportsByDateDesc(allReports);

  // 5) build table
  buildComparisonTable(allReports);

  // 6) show the risk of the newest (index 0)
  if (allReports.length > 0) {
    document.getElementById("nccnRiskResult").textContent = allReports[0].nccnRisk;
  } else {
    document.getElementById("nccnRiskResult").textContent = "N/A";
  }
});

/*********************************************************************
 * chunkReports: split text by lines that start with "Provider:"
 *********************************************************************/
function chunkReports(raw) {
  return raw.split(/(?=^Provider:\s)/im)
            .map(s => s.trim())
            .filter(Boolean);
}

/*********************************************************************
 * parseCollectedDate: e.g. "Collected: 12/6/2023"
 *********************************************************************/
function parseCollectedDate(text) {
  const m = text.match(/Collected:\s*([0-9\/-]+)/i);
  return m ? m[1].trim() : "";
}

/*********************************************************************
 * parseDob: tries to find lines like:
 *   "DOB: 1/1/1954"
 *   or "DOB/Age:  1/1/1954 (Age: 69)"
 *********************************************************************/
function parseDob(text) {
  // 1) simplest pattern => "DOB:\s*MM/DD/YYYY"
  let m = text.match(/DOB:\s*([0-9\/-]+)/i);
  if (m) {
    return m[1].trim();
  }

  // 2) if "DOB/Age:\s*1/1/1954"
  m = text.match(/DOB\/Age:\s*([0-9\/-]+)/i);
  if (m) {
    return m[1].trim();
  }

  // 3) fallback => not found
  return null;
}

/*********************************************************************
 * calcAgeFromDob: convert dob string => approximate age in years
 * we assume US "MM/DD/YYYY" or "YYYY-MM-DD" format is parseable by Date
 *********************************************************************/
function calcAgeFromDob(dobStr) {
  const dobMs = Date.parse(dobStr);
  if (isNaN(dobMs)) return null; // parse fail

  const dobDate = new Date(dobMs);
  const now = new Date();
  let age = now.getFullYear() - dobDate.getFullYear();
  // check if we haven't hit birthday yet this year
  const monthDiff = now.getMonth() - dobDate.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && now.getDate() < dobDate.getDate())) {
    age--;
  }
  return age;
}

/*********************************************************************
 * extractFinalDxLines(chunk):
 *   1) find "FINAL PATHOLOGIC DIAGNOSIS"
 *   2) read lines until "Comment", "Gross Description", ...
 *   3) skip disclaimers, sign-offs, blank lines, etc.
 *********************************************************************/
function extractFinalDxLines(reportText) {
  const lines = reportText.split(/\r?\n/).map(l => l.trim());
  let inFinalDx = false;
  let dxLines = [];

  for (let line of lines) {
    if (/^FINAL\s+PATHOLOGIC\s+DIAGNOSIS/i.test(line)) {
      inFinalDx = true;
      continue;
    }
    if (!inFinalDx) continue; // skip until we see final dx start

    // if we see these headings => stop
    if (/^Comment\s*$/i.test(line)) break;
    if (/^Gross\s+Description\s*$/i.test(line)) break;
    if (/^Clinical\s+History\s*$/i.test(line)) break;
    if (/^Specimen\(s\)\s*Received/i.test(line)) break;
    if (/^FHIR\s+Pathology/i.test(line)) break;

    // skip disclaimers / signature lines
    if (/disclaimer/i.test(line)) continue;
    if (/immunohistochemistry/i.test(line)) continue;
    if (/\*\*\s*Report\s*Electronically\s*Signed\s*by/i.test(line)) continue;
    if (/electronically\s*signed\s*by/i.test(line)) continue;

    if (!line) continue; // skip blank

    dxLines.push(line);
  }
  return dxLines;
}

/*********************************************************************
 * parseSamplesFromDx: looks for "A) ", "B) ", etc.
 *********************************************************************/
function parseSamplesFromDx(dxLines) {
  const samples = [];
  let current = null;

  const sampleHeaderRegex = /^([A-Z])[\.\)]\s*(.*)/;

  dxLines.forEach(line => {
    const match = line.match(sampleHeaderRegex);
    if (match) {
      if (current) {
        samples.push(finalizeSample(current));
      }
      current = {
        sampleLabel: match[1],
        locationLines: [],
        diagnosisLines: [],
        foundDiagnosis: false
      };
      if (match[2]) current.locationLines.push(match[2].trim());
    }
    else if (current) {
      if (line.startsWith("-")) {
        current.foundDiagnosis = true;
        current.diagnosisLines.push(line.replace(/^-+\s*/, ""));
      } else {
        if (!current.foundDiagnosis) {
          current.locationLines.push(line);
        } else {
          current.diagnosisLines.push(line);
        }
      }
    }
  });

  if (current) {
    samples.push(finalizeSample(current));
  }
  return samples;
}

/*********************************************************************
 * finalizeSample => combine location & diagnosis lines,
 *                   extract short summary
 *********************************************************************/
function finalizeSample(s) {
  // location
  const rawLoc = s.locationLines.join(" ");
  const location = parseLocation(rawLoc, s.sampleLabel);

  // diagnosis text
  let diagText = s.diagnosisLines.join(" ");
  diagText = diagText.replace(/\s+/g, " ").trim();

  // glean fields
  const dxShort = parseShortDiagnosis(diagText);
  const gleason = extractGleasonScore(diagText);
  const cpos = extractCoresPositive(diagText);
  const size = extractMaxCoreSize(diagText);

  return {
    sampleLabel: s.sampleLabel,
    location,
    diagnosis: dxShort,
    gleasonScore: gleason,
    coresPositive: cpos,
    maxCoreSize: size
  };
}

/*********************************************************************
 * parseLocation => remove prefixes like "PROSTATE NEEDLE BX -"
 *********************************************************************/
function parseLocation(text, label) {
  let loc = text;
  loc = loc.replace(/^PROSTATE\s*NEEDLE\s*BX\s*-\s*/i, "");
  loc = loc.replace(/^PROSTATE,\s*NEEDLE\s*CORE\s*BIOPSY\s*-\s*/i, "");
  loc = loc.replace(/:\s*$/, "");
  if (loc.startsWith(label + " ")) {
    loc = loc.slice(label.length + 1);
  }
  return loc.trim();
}

function parseShortDiagnosis(txt) {
  if (/adenocarcinoma/i.test(txt)) return "AdenoCA";
  if (/benign/i.test(txt)) return "Benign";
  return "N/A";
}

/*********************************************************************
 * extractGleasonScore => "3+4=7"
 *********************************************************************/
function extractGleasonScore(text) {
  const m = text.match(/gleason\s*(score)?\s*(\d+\s*\+\s*\d+\s*=\s*\d+)/i);
  if (m) return m[2].replace(/\s+/g, "");
  return "N/A";
}

/*********************************************************************
 * extractCoresPositive => "4/6(67%)"
 *********************************************************************/
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

/*********************************************************************
 * extractMaxCoreSize => "5mm"
 *********************************************************************/
function extractMaxCoreSize(text) {
  const pattern = /tumor\s+measures\s+(\d+)\s*mm\s+in\s+(\d+)\s*mm\s*core/gi;
  let match;
  let maxSize = null;
  while ((match = pattern.exec(text.toLowerCase())) !== null) {
    const sz = parseInt(match[1], 10);
    if (maxSize === null || sz > maxSize) {
      maxSize = sz;
    }
  }
  if (maxSize === null) return "N/A";
  return `${maxSize}mm`;
}

/*********************************************************************
 * findMaxGleasonSum(samples): returns numeric sum e.g. 7
 *********************************************************************/
function findMaxGleasonSum(samples) {
  let maxSum = 0;
  samples.forEach(s => {
    if (s.gleasonScore && s.gleasonScore !== "N/A") {
      const m = s.gleasonScore.match(/(\d+)\+\d+=(\d+)/);
      if (m) {
        const sumVal = parseInt(m[2], 10);
        if (sumVal > maxSum) {
          maxSum = sumVal;
        }
      }
    }
  });
  return maxSum;
}

/*********************************************************************
 * calcNCCNRiskGroup => simplified
 *********************************************************************/
function calcNCCNRiskGroup(psaRange, gleasonSum, tStage) {
  const stageNum = parseTStageNumber(tStage);

  const isPSAunder10 = (psaRange === "<10");
  const isPSA10to20 = (psaRange === "10-20");
  const isPSAover20 = (psaRange === ">20");

  if (tStage === "T1c" && gleasonSum <= 6 && isPSAunder10) {
    return "Very Low";
  }
  if (stageNum <= 2 && gleasonSum <= 6 && isPSAunder10) {
    return "Low";
  }
  if (gleasonSum === 7 || isPSA10to20 || stageNum === 2) {
    return "Intermediate";
  }
  if (gleasonSum >= 8 || stageNum >= 3 || isPSAover20) {
    if (tStage === "T3b" || tStage === "T4") {
      return "Very High";
    }
    return "High";
  }
  return "Low";
}

function parseTStageNumber(tStage) {
  const m = tStage.match(/^T(\d+)/i);
  if (m) return parseInt(m[1], 10);
  return 1;
}

/*********************************************************************
 * sortReportsByDateDesc => newest first
 *********************************************************************/
function sortReportsByDateDesc(reps) {
  reps.sort((a, b) => {
    const dA = Date.parse(a.date);
    const dB = Date.parse(b.date);
    return (isNaN(dB) ? 0 : dB) - (isNaN(dA) ? 0 : dA);
  });
}

/*********************************************************************
 * calcAgeFromDob(dobStr): parse "1/1/1954" => approx age in years
 *********************************************************************/
function calcAgeFromDob(dobStr) {
  const dobMs = Date.parse(dobStr);
  if (isNaN(dobMs)) return null; // parse fail
  const dobDate = new Date(dobMs);
  const now = new Date();
  let age = now.getFullYear() - dobDate.getFullYear();
  const monthDiff = now.getMonth() - dobDate.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && now.getDate() < dobDate.getDate())) {
    age--;
  }
  return age;
}

/*********************************************************************
 * buildComparisonTable(allReports):
 *    (Unchanged logic for building your side-by-side columns.)
 *********************************************************************/
function buildComparisonTable(allReports) {
  const thead = document.querySelector("#comparisonTable thead");
  const tbody = document.querySelector("#comparisonTable tbody");
  thead.innerHTML = "";
  tbody.innerHTML = "";

  if (!allReports.length) return;

  // gather sample labels
  const allSampleLabels = new Set();
  allReports.forEach(r => {
    r.samples.forEach(s => allSampleLabels.add(s.sampleLabel));
  });
  const sortedLabels = [...allSampleLabels].sort();

  // row #1 => "Sample","Location", then 1 col per date
  const row1 = document.createElement("tr");

  const sampleTh = document.createElement("th");
  sampleTh.textContent = "Sample";
  row1.appendChild(sampleTh);

  const locTh = document.createElement("th");
  locTh.textContent = "Location";
  row1.appendChild(locTh);

  // for each report => 1 col => "Date + (DOB + Age?)" or "Date (NCCN: risk)" 
  // Example: "12/6/2023 (NCCN: Low) DOB:1/1/1954 (Age:69)"
  allReports.forEach(r => {
    const th = document.createElement("th");
    let content = `${r.date} (NCCN: ${r.nccnRisk})`;
    if (r.dob && r.age != null) {
      content += ` DOB:${r.dob} (Age:${r.age})`;
    }
    th.textContent = content;
    row1.appendChild(th);
  });

  thead.appendChild(row1);

  // now build body => 1 row per sample
  sortedLabels.forEach(label => {
    const tr = document.createElement("tr");

    // sample
    const sampleTd = document.createElement("td");
    sampleTd.textContent = label;
    tr.appendChild(sampleTd);

    // location => from first or any
    let foundLoc = "N/A";
    for (let i=0; i<allReports.length; i++) {
      const smp = allReports[i].samples.find(s => s.sampleLabel === label);
      if (smp) {
        foundLoc = smp.location;
        break;
      }
    }
    const locTd = document.createElement("td");
    locTd.textContent = foundLoc;
    tr.appendChild(locTd);

    // for each report => single text cell (Dx, G=, C=, Sz=, etc.)
    allReports.forEach(r => {
      const sampleObj = r.samples.find(s => s.sampleLabel === label);
      const cell = document.createElement("td");
      if (!sampleObj) {
        cell.textContent = "N/A";
      } else {
        let combined = "";
        if (sampleObj.diagnosis && sampleObj.diagnosis !== "N/A") {
          combined += sampleObj.diagnosis;
        }
        if (sampleObj.gleasonScore && sampleObj.gleasonScore !== "N/A") {
          combined += (combined ? ", G=" : "G=") + sampleObj.gleasonScore;
        }
        if (sampleObj.coresPositive && sampleObj.coresPositive !== "N/A") {
          combined += (combined ? ", C=" : "C=") + sampleObj.coresPositive;
        }
        if (sampleObj.maxCoreSize && sampleObj.maxCoreSize !== "N/A") {
          combined += (combined ? ", Sz=" : "Sz=") + sampleObj.maxCoreSize;
        }
        if (!combined) combined = "N/A";

        cell.textContent = combined;
      }
      tr.appendChild(cell);
    });

    tbody.appendChild(tr);
  });
}
