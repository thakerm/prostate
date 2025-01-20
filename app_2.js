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
 * Convert Gleason sum => approximate Grade Group (1..5)
 */
function gleasonSumToGGG(sum) {
  if (sum <= 6) return 1;
  if (sum === 7) return 2;  // or 3 if you know it's 4+3
  if (sum === 8) return 4;
  return 5; // 9 or 10 => group 5
}

/**
 * Map the user-chosen PSA range to a numeric estimate for the nomogram.
 */
function mapPsaRangeToNumeric(rangeStr) {
  switch(rangeStr) {
    case "<10":  return 5;
    case "10-20":return 15;
    case ">20":  return 25;
  }
  return 5; // fallback
}

/*********************************************************************
 * 2) EVENT: "Process Reports"
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

  // chunk the input
  const chunks = chunkReports(rawText);
  if (!chunks.length) {
    alert("No valid reports found (looking for 'Provider:' lines).");
    return;
  }

  // We'll also read the user's PSA & stage for the *overall* risk group,
  // but that won't necessarily be used in the nomogram unless selected below.
  const psaRange = document.getElementById("psaSelect").value; 
  const tStage = document.getElementById("stageSelect").value;

  // parse each chunk
  chunks.forEach(chunk => {
    const date = parseCollectedDate(chunk) || "Unknown";
    const dobStr = parseDob(chunk);
    if (dobStr && !patientDob) {
      // If we find a DOB in any chunk, store it (first found).
      patientDob = dobStr;
    }

    // parse final dx lines
    const finalDxLines = extractFinalDxLines(chunk);
    const samples = parseSamplesFromDx(finalDxLines);

    // find highest gleason in these samples
    const maxG = findMaxGleasonSum(samples);
    // compute risk (we do the simplified logic with user-chosen PSA range & stage)
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
    alert("Please select which biopsy date to use (radio button) before calculating.");
    return;
  }

  // Let's also read the user's PSA & T stage from the top
  const psaRange = document.getElementById("psaSelect").value;
  const numericPSA = mapPsaRangeToNumeric(psaRange);

  const tStage = document.getElementById("stageSelect").value;

  // We'll get the highest Gleason sum from that single chosen report:
  const chosenReport = allReports[chosenIndex];
  const gleasonSum = chosenReport.maxGleasonSum;
  const ggg = gleasonSumToGGG(gleasonSum);

  // We'll compute positive cores from any sample with "AdenoCA" 
  // (everything else is negative for nomogram).
  const { posCores, totalCores } = computePositiveCores(chosenReport);
  const negCores = totalCores - posCores;

  // We can do a quick age guess from the patientDob if we want
  let ageForNomogram = 65;
  if (patientDob) {
    const possibleAge = calcAgeFromDob(patientDob);
    if (possibleAge && possibleAge > 0) {
      ageForNomogram = possibleAge;
    }
  }

  // Simplify T stage for the nomogram (T1, T2a, T2b, T2c, T3).
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
  // Splits on lines that *start* with "Provider:"
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
  // e.g. "DOB: 1/1/1955"
  let m = text.match(/DOB:\s*([0-9\/-]+)/i);
  if (m) return m[1].trim();

  // e.g. "DOB/Age: 1/1/1955"
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
      // start a new sample
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
 *   Priority: Adenocarcinoma → Prostatitis → Inflammation → Benign → else "N/A"
 *   (ASAP, HGPIN, BPH, etc. also considered "negative" for the nomogram.)
 */
function parseShortDiagnosis(txt) {
  const lower = txt.toLowerCase();
  if (lower.includes("adenocarcinoma")) return "AdenoCA";
  if (lower.includes("prostatitis"))   return "Prostatitis";
  if (lower.includes("inflammation"))  return "Inflammation";
  if (lower.includes("benign"))        return "Benign";
  if (lower.includes("asap"))          return "ASAP";    // also negative
  if (lower.includes("hgpin"))         return "HGPIN";   // also negative
  if (lower.includes("bph"))           return "BPH";     // also negative
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
    // No default checked, user must pick one if desired

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

/**
 * computePositiveCores(report):
 *   1) We only consider AdenoCA samples as contributing positive cores.
 *   2) We parse "X/Y(...)" and then clamp X & Y based on location:
 *       - apex => max=3
 *       - mid => max=2
 *       - base => max=2
 *       - target => max=1  (or if "lesion" is in the location)
 *       - fallback => 2
 *   3) We sum up across all samples in that report.
 *   4) If sumTotal=0 => fallback to (0 pos, 14 total).
 */
function computePositiveCores(report) {
  let sumPos = 0;
  let sumTotal = 0;

  report.samples.forEach(s => {
    // 1) Check if it's AdenoCA
    if (!s.diagnosis.toLowerCase().includes("adeno")) {
      // Not adenocarcinoma => 0
      return;
    }

    // 2) Attempt to parse "X/Y" from s.coresPositive
    if (!s.coresPositive || s.coresPositive === "N/A") {
      // no parseable "X/Y" => treat as 0/0 for this sample
      return;
    }
    const match = s.coresPositive.match(/^(\d+)\/(\d+)/);
    if (!match) {
      // didn't find a pattern like "4/6"
      return;
    }

    let x = parseInt(match[1], 10); // positive
    let y = parseInt(match[2], 10); // total
    if (isNaN(x) || isNaN(y) || y === 0) {
      return; // skip
    }

    // 3) Determine maxCores for this sample based on location text
    const locationLower = (s.location || "").toLowerCase();

    let maxForThisSample = 2; // default if we can't identify apex/mid/base
    if (locationLower.includes("apex")) {
      maxForThisSample = 3;
    } else if (locationLower.includes("mid")) {
      maxForThisSample = 2;
    } else if (locationLower.includes("base")) {
      maxForThisSample = 2;
    }
    // if 'target' or 'lesion' => max=1
    if (locationLower.includes("target") || locationLower.includes("lesion")) {
      maxForThisSample = 1;
    }

    // 4) Clamp x & y to that maximum
    if (y > maxForThisSample) {
      y = maxForThisSample;
    }
    if (x > y) {
      // If the parsed "4/6" becomes "y=3" => if x=4, clamp x=3
      x = y;
    }

    // 5) Add to sum
    sumPos   += x;
    sumTotal += y;
  });

  // If no AdenoCA or no parseable X/Y => sumTotal=0 => fallback
  if (sumTotal === 0) {
    return { posCores: 0, totalCores: 14 };
  }

  // If you want to always force total=14, do it here, e.g.:
  // let leftoverNeg = 14 - sumPos;
  // if (leftoverNeg < 0) leftoverNeg = 0;
  // return { posCores: sumPos, totalCores: sumPos + leftoverNeg };

  // Otherwise, return the actual sum of clamped values
  return { posCores: sumPos, totalCores: sumTotal };
}
