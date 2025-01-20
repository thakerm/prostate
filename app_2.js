/*********************************************************************
 * 1) GLOBAL DATA
 *********************************************************************/

// We'll store all parsed reports in this array.
let allReports = [];

// A single DOB for the entire patient (if found in any report).
let patientDob = null;

// We'll define a ranking for NCCN risk levels:
const RISK_ORDER = {
  "Very Low": 1,
  "Low": 2,
  "Intermediate": 3,
  "High": 4,
  "Very High": 5
};

/**
 * Return the "highest/worst" risk among an array of risk strings.
 */
function getHighestNccnRisk(reportArray) {
  let highestRank = 0;
  let highestStr = "Low"; // fallback
  reportArray.forEach(r => {
    const rank = RISK_ORDER[r.nccnRisk] || 0;
    if (rank > highestRank) {
      highestRank = rank;
      highestStr = r.nccnRisk;
    }
  });
  return highestStr;
}

/**
 * mapPsaRangeToNumeric: given "<10", "10-20", or ">20", 
 * returns an approximate numeric value for the nomogram (5, 15, 25).
 */
function mapPsaRangeToNumeric(rangeStr) {
  switch(rangeStr) {
    case "<10":   return 5;
    case "10-20": return 15;
    case ">20":   return 25;
  }
  // fallback if not recognized
  return 5;
}

/**
 * Convert Gleason sum => approximate Grade Group (1..5)
 */
function gleasonSumToGGG(sum) {
  if (sum <= 6) return 1;
  if (sum === 7) return 2; 
  if (sum === 8) return 4;
  return 5; // for 9 or 10
}

/*********************************************************************
 * EVENT: "Process Reports"
 *********************************************************************/
document.getElementById("processBtn").addEventListener("click", () => {
  const rawText = document.getElementById("reportText").value.trim();
  if (!rawText) {
    alert("Please paste at least one pathology report.");
    return;
  }

  // Clear existing data
  allReports = [];
  patientDob = null;

  // chunk the input by "Provider:"
  const chunks = chunkReports(rawText);
  if (!chunks.length) {
    alert("No valid reports found (looking for 'Provider:' lines).");
    return;
  }

  // We'll also read the user's PSA & stage for a simplified risk calculation,
  // but this does not necessarily become the final nomogram input 
  // unless you specifically want it.
  const psaRange = document.getElementById("psaSelect").value; 
  const tStage = document.getElementById("stageSelect").value;

  // parse each chunk
  chunks.forEach(chunk => {
    const date = parseCollectedDate(chunk) || "Unknown";
    const dobStr = parseDob(chunk);
    if (dobStr && !patientDob) {
      // store the first DOB found
      patientDob = dobStr;
    }

    // parse final dx lines
    const finalDxLines = extractFinalDxLines(chunk);
    const samples = parseSamplesFromDx(finalDxLines);

    // find highest gleason in these samples
    const maxG = findMaxGleasonSum(samples);
    // compute simplified NCCN risk
    const riskGroup = calcNCCNRiskGroup(psaRange, maxG, tStage);

    allReports.push({
      date,
      samples,
      maxGleasonSum: maxG,
      nccnRisk: riskGroup
    });
  });

  // sort desc by date => newest at index 0
  sortReportsByDateDesc(allReports);

  // build table
  buildComparisonTable(allReports);

  // find the worst risk across all
  if (allReports.length > 0) {
    const highestRisk = getHighestNccnRisk(allReports);
    document.getElementById("dobSpan").textContent = patientDob || "N/A";
    document.getElementById("nccnRiskResult").textContent = highestRisk;

    // find overall highest Gleason from all
    const overallMaxGleason = allReports.reduce((acc, r) => {
      return Math.max(acc, r.maxGleasonSum || 0);
    }, 0);

    // show top-level details
    const detailStr = `PSA=${psaRange}, Gleason=${overallMaxGleason}, Stage=${tStage}`;
    document.getElementById("riskDetails").textContent = `(${detailStr})`;
  } else {
    document.getElementById("dobSpan").textContent = "N/A";
    document.getElementById("nccnRiskResult").textContent = "N/A";
    document.getElementById("riskDetails").textContent = "(PSA=?, Gleason=?, Stage=?)";
  }
});

/*********************************************************************
 * EVENT: "Calculate Nomogram" - uses whichever report the user selected.
 *********************************************************************/
document.getElementById("calcNomogramBtn").addEventListener("click", () => {
  // Find which radio is selected
  const radios = document.querySelectorAll(".nomogram-radio");
  let chosenIndex = -1;
  radios.forEach(r => {
    if (r.checked) {
      chosenIndex = parseInt(r.value, 10);
    }
  });

  if (chosenIndex < 0 || !allReports[chosenIndex]) {
    alert("Please select which biopsy date to use for the nomogram first.");
    return;
  }

  // read the user's PSA & T stage from the top
  const psaRange = document.getElementById("psaSelect").value;
  const numericPSA = mapPsaRangeToNumeric(psaRange);
  const tStage = document.getElementById("stageSelect").value;

  // get the highest Gleason sum from that single chosen report
  const chosenReport = allReports[chosenIndex];
  const gleasonSum = chosenReport.maxGleasonSum;
  const ggg = gleasonSumToGGG(gleasonSum);

  // compute positive cores from that chosen report
  const { posCores, totalCores } = computePositiveCores(chosenReport);
  const negCores = totalCores - posCores;

  // guess an age from patientDob
  let ageForNomogram = 65;
  if (patientDob) {
    const possibleAge = calcAgeFromDob(patientDob);
    if (possibleAge && possibleAge > 0) {
      ageForNomogram = possibleAge;
    }
  }

  // Simplify T stage for the nomogram
  let stageForNomogram = "T1";
  if (/^T2a/i.test(tStage)) stageForNomogram = "T2a";
  else if (/^T2b/i.test(tStage)) stageForNomogram = "T2b";
  else if (/^T2c/i.test(tStage)) stageForNomogram = "T2c";
  else if (/^T3/i.test(tStage))  stageForNomogram = "T3";

  // Now send data to nomogram
  const frame = document.getElementById("nomogramFrame");
  if (frame && frame.contentWindow && typeof frame.contentWindow.setNomogramData === "function") {
    frame.contentWindow.setNomogramData({
      age: ageForNomogram,
      psa: numericPSA,
      ggg: ggg,
      stage: stageForNomogram,
      posCores: posCores,
      negCores: negCores,
      hormoneTherapy: "No",
      radiationTherapy: "No"
    });
  } else {
    alert("Nomogram frame is not available or setNomogramData not found.");
  }
});

/*********************************************************************
 * chunkReports
 *********************************************************************/
function chunkReports(raw) {
  return raw.split(/(?=^Provider:\s)/im)
            .map(s => s.trim())
            .filter(Boolean);
}

/*********************************************************************
 * parseCollectedDate
 *********************************************************************/
function parseCollectedDate(text) {
  const m = text.match(/Collected:\s*([0-9\/-]+)/i);
  return m ? m[1].trim() : "";
}

/*********************************************************************
 * parseDob
 *********************************************************************/
function parseDob(text) {
  let m = text.match(/DOB:\s*([0-9\/-]+)/i);
  if (m) return m[1].trim();

  m = text.match(/DOB\/Age:\s*([0-9\/-]+)/i);
  if (m) return m[1].trim();

  return null;
}

/*********************************************************************
 * calcAgeFromDob
 *********************************************************************/
function calcAgeFromDob(dobStr) {
  const dobMs = Date.parse(dobStr);
  if (isNaN(dobMs)) return null;
  const dobDate = new Date(dobMs);
  const now = new Date();
  let age = now.getFullYear() - dobDate.getFullYear();
  const mDiff = now.getMonth() - dobDate.getMonth();
  if (mDiff < 0 || (mDiff === 0 && now.getDate() < dobDate.getDate())) {
    age--;
  }
  return age;
}

/*********************************************************************
 * extractFinalDxLines
 *********************************************************************/
function extractFinalDxLines(reportText) {
  const lines = reportText.split(/\r?\n/).map(l => l.trim());
  let inFinal = false;
  let dxLines = [];

  for (let line of lines) {
    if (/^FINAL\s+PATHOLOGIC\s+DIAGNOSIS/i.test(line)) {
      inFinal = true;
      continue;
    }
    if (!inFinal) continue;

    // stop triggers
    if (/^Comment\s*$/i.test(line)) break;
    if (/^Gross\s+Description\s*$/i.test(line)) break;
    if (/^Clinical\s+History\s*$/i.test(line)) break;
    if (/^Specimen\(s\)\s*Received/i.test(line)) break;
    if (/^FHIR\s+Pathology/i.test(line)) break;

    // skip disclaimers, signoffs
    if (/disclaimer/i.test(line)) continue;
    if (/immunohistochemistry/i.test(line)) continue;
    if (/\*\*\s*Report\s*Electronically\s*Signed\s*by/i.test(line)) continue;
    if (/electronically\s*signed\s*by/i.test(line)) continue;

    if (!line) continue;
    dxLines.push(line);
  }
  return dxLines;
}

/*********************************************************************
 * parseSamplesFromDx
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
    } else if (current) {
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

  // finalize last sample
  if (current) {
    samples.push(finalizeSample(current));
  }
  return samples;
}

function finalizeSample(s) {
  const rawLoc = s.locationLines.join(" ");
  const location = parseLocation(rawLoc, s.sampleLabel);

  let diagText = s.diagnosisLines.join(" ");
  diagText = diagText.replace(/\s+/g, " ").trim();

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

/**
 * parseShortDiagnosis:
 *   Priority: Adenocarcinoma → Prostatitis → Inflammation → Benign → ASAP → HGPIN → BPH → else "N/A"
 */
function parseShortDiagnosis(txt) {
  const lower = txt.toLowerCase();
  if (lower.includes("adenocarcinoma")) return "AdenoCA";
  if (lower.includes("prostatitis"))   return "Prostatitis";
  if (lower.includes("inflammation"))  return "Inflammation";
  if (lower.includes("benign"))        return "Benign";
  if (lower.includes("asap"))          return "ASAP";
  if (lower.includes("hgpin"))         return "HGPIN";
  if (lower.includes("bph"))           return "BPH";
  return "N/A";
}

function extractGleasonScore(text) {
  const m = text.match(/gleason\s*(score)?\s*(\d+\s*\+\s*\d+\s*=\s*\d+)/i);
  if (m) return m[2].replace(/\s+/g, "");
  return "N/A";
}

/**
 * extractCoresPositive => "2/3(66%)" or "N/A"
 */
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
    const pct = Math.round((X / Y)*100);
    return `${X}/${Y}(${pct}%)`;
  }
  return "N/A";
}

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
 * findMaxGleasonSum
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

  // Very Low if T1c + Gleason <=6 + PSA<10
  if (tStage === "T1c" && gleasonSum <= 6 && isPSAunder10) {
    return "Very Low";
  }
  // Low if stage <=2 + Gleason <=6 + PSA<10
  if (stageNum <= 2 && gleasonSum <= 6 && isPSAunder10) {
    return "Low";
  }
  // Intermediate if Gleason=7 OR PSA=10-20 OR T2
  if (gleasonSum === 7 || isPSA10to20 || stageNum === 2) {
    return "Intermediate";
  }
  // High if Gleason>=8 OR stage>=3 OR PSA>20
  // Very High if T3b or T4
  if (gleasonSum >= 8 || stageNum >= 3 || isPSAover20) {
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
 * buildComparisonTable
 *   We add a new "Nomogram" column in the table header with radio buttons,
 *   so the user can pick which report to use for the nomogram.
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

  // row #1 => "Sample","Location", then 1 col per report date,
  // plus a radio button to select which one is used for nomogram
  const row1 = document.createElement("tr");

  const sampleTh = document.createElement("th");
  sampleTh.textContent = "Sample";
  row1.appendChild(sampleTh);

  const locTh = document.createElement("th");
  locTh.textContent = "Location";
  row1.appendChild(locTh);

  // for each report => 1 col => "Date (NCCN: risk)" + radio
  allReports.forEach((r, i) => {
    const th = document.createElement("th");

    // Add a radio button
    const radio = document.createElement("input");
    radio.type = "radio";
    radio.name = "nomogramSelect";
    radio.className = "nomogram-radio";
    radio.value = i.toString();
    // No default checked

    // We'll label it with the date and the risk
    const label = document.createElement("label");
    label.style.display = "block";
    label.textContent = `${r.date} (NCCN: ${r.nccnRisk})`;

    th.appendChild(radio);
    th.appendChild(label);

    row1.appendChild(th);
  });

  thead.appendChild(row1);

  // now build body => 1 row per sample label
  sortedLabels.forEach(label => {
    const tr = document.createElement("tr");

    // sample label
    const sampleTd = document.createElement("td");
    sampleTd.textContent = label;
    tr.appendChild(sampleTd);

    // location => from first report that has it
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

    // for each report => single text cell with diagnosis summary
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

/*********************************************************************
 * computePositiveCores(report):
 *   Example approach to sum AdenoCA "X/Y" cores. 
 *   For demonstration, we do no special clamping.
 *   If we find no AdenoCA, fallback (0,14).
 */
function computePositiveCores(report) {
  // Example: sum up all "X" if diagnosis="AdenoCA"
  // fallback total=14 if none found
  let sumPos = 0;
  let anyFound = false;

  report.samples.forEach(s => {
    if (s.diagnosis.toLowerCase().includes("adeno")) {
      // parse "X/Y"
      if (s.coresPositive && s.coresPositive !== "N/A") {
        const match = s.coresPositive.match(/^(\d+)\/(\d+)/);
        if (match) {
          const x = parseInt(match[1], 10);
          // add to sum
          if (!isNaN(x)) {
            sumPos += x;
            anyFound = true;
          }
        }
      }
    }
  });

  if (!anyFound) {
    return { posCores: 0, totalCores: 14 };
  } else {
    // e.g., if 6 positives, total=14 => neg=8
    // or you can force total=16, etc. Adjust as needed.
    const forcedTotal = 14; 
    return { posCores: sumPos, totalCores: forcedTotal };
  }
}
