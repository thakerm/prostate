/*********************************************************************
 * 1) GLOBAL DATA
 *********************************************************************/

let allReports = [];
let patientDob = null;

const RISK_ORDER = {
  "Very Low": 1,
  "Low": 2,
  "Intermediate - Favorable": 3,
  "Intermediate - Unfavorable": 4,
  "High": 5,
  "Very High": 6
};

function getHighestNccnRisk(reportArray) {
  let highestRank = 0;
  let highestStr = "Low";
  reportArray.forEach(r => {
    const rank = RISK_ORDER[r.nccnRisk] || 0;
    if (rank > highestRank) {
      highestRank = rank;
      highestStr = r.nccnRisk;
    }
  });
  return highestStr;
}

function mapPsaRangeToNumeric(rangeStr) {
  switch (rangeStr) {
    case "<10":   return 5;
    case "10-20": return 15;
    case ">20":   return 25;
  }
  return 5;
}

/*********************************************************************
 * GRADE GROUP
 *********************************************************************/
function extractGradeGroup(text) {
  const re = /grade\s+group\s+(\d+)/i;
  const m = text.match(re);
  if (!m) return 0;
  const gg = parseInt(m[1], 10);
  if (gg >= 1 && gg <= 5) return gg;
  return 0;
}

function gradeGroupToGleasonSum(gg) {
  switch (gg) {
    case 1: return 6;
    case 2: return 7;
    case 3: return 7;
    case 4: return 8;
    case 5: return 9;
    default: return 6;
  }
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
  allReports = [];
  patientDob = null;

  const chunks = chunkReports(rawText);
  if (!chunks.length) {
    alert("No valid reports found (looking for 'Provider:' lines).");
    return;
  }

  const psaRange = document.getElementById("psaSelect").value; 
  const tStage = document.getElementById("stageSelect").value;

  chunks.forEach(chunk => {
    const date = parseCollectedDate(chunk) || "Unknown";
    const dobStr = parseDob(chunk);
    if (dobStr && !patientDob) {
      patientDob = dobStr;
    }

    const finalDxLines = extractFinalDxLines(chunk);
    const samples = parseSamplesFromDx(finalDxLines);

    const maxGG = findMaxGradeGroup(samples);
    const maxGleasonSum = gradeGroupToGleasonSum(maxGG);

    const { posCores, totalCores } = computePositiveCoresFromSamples(samples);
    const riskGroup = calcNCCNRiskGroup(psaRange, maxGG, tStage, posCores, totalCores);

    allReports.push({
      date,
      samples,
      maxGradeGroup: maxGG,
      maxGleasonSum,
      posCores,
      totalCores,
      nccnRisk: riskGroup
    });
  });

  sortReportsByDateDesc(allReports);
  buildComparisonTable(allReports);

  if (allReports.length > 0) {
    const highestRisk = getHighestNccnRisk(allReports);
    document.getElementById("dobSpan").textContent = patientDob || "N/A";
    document.getElementById("nccnRiskResult").textContent = highestRisk;

    const overallMaxGleason = allReports.reduce((acc, r) => {
      return Math.max(acc, r.maxGleasonSum || 0);
    }, 0);
    const detailStr = `PSA=${psaRange}, Gleason=${overallMaxGleason}, Stage=${tStage}`;
    document.getElementById("riskDetails").textContent = `(${detailStr})`;
  } else {
    document.getElementById("dobSpan").textContent = "N/A";
    document.getElementById("nccnRiskResult").textContent = "N/A";
    document.getElementById("riskDetails").textContent = "(PSA=?, Gleason=?, Stage=?)";
  }
});

/*********************************************************************
 * EVENT: "Calculate Nomogram"
 *********************************************************************/
document.getElementById("calcNomogramBtn").addEventListener("click", () => {
  const nomogramDiv = document.getElementById("nomogramDiv");
  nomogramDiv.style.display = "block";
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

  const psaRange = document.getElementById("psaSelect").value;
  const numericPSA = mapPsaRangeToNumeric(psaRange);
  const tStage = document.getElementById("stageSelect").value;

  const chosenReport = allReports[chosenIndex];
  const gg = chosenReport.maxGradeGroup || 1;
  const gleasonSum = gradeGroupToGleasonSum(gg);

  const posCores = chosenReport.posCores;
  const totalCores = chosenReport.totalCores;
  const negCores = totalCores - posCores;

  let ageForNomogram = 65;
  if (patientDob) {
    const possibleAge = calcAgeFromDob(patientDob);
    if (possibleAge && possibleAge > 0) {
      ageForNomogram = possibleAge;
    }
  }

  let stageForNomogram = "T1";
  if (/^T2a/i.test(tStage)) stageForNomogram = "T2a";
  else if (/^T2b/i.test(tStage)) stageForNomogram = "T2b";
  else if (/^T2c/i.test(tStage)) stageForNomogram = "T2c";
  else if (/^T3/i.test(tStage))  stageForNomogram = "T3";

  if (typeof setNomogramData === "function") {
    setNomogramData({
      age: ageForNomogram,
      psa: numericPSA,
      ggg: gg,
      stage: stageForNomogram,
      posCores,
      negCores,
      hormoneTherapy: "No",
      radiationTherapy: "No"
    });
  } else {
    alert("setNomogramData not found.");
  }
});

/*********************************************************************
 * chunkReports, parseCollectedDate, parseDob, ...
 *********************************************************************/
function chunkReports(raw) {
  return raw.split(/(?=^Provider:\s)/im).map(s => s.trim()).filter(Boolean);
}
function parseCollectedDate(text) {
  const m = text.match(/Collected:\s*([0-9\/-]+)/i);
  return m ? m[1].trim() : "";
}
function parseDob(text) {
  let m = text.match(/DOB:\s*([0-9\/-]+)/i);
  if (m) return m[1].trim();
  m = text.match(/DOB\/Age:\s*([0-9\/-]+)/i);
  if (m) return m[1].trim();
  return null;
}
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
    if (/^Comment\s*$/i.test(line)) break;
    if (/^Gross\s+Description\s*$/i.test(line)) break;
    if (/^Clinical\s+History\s*$/i.test(line)) break;
    if (/^Specimen\(s\)\s*Received/i.test(line)) break;
    if (/^FHIR\s+Pathology/i.test(line)) break;
    if (/disclaimer|immunohistochemistry|\*\*\s*Report\s*Electronically\s*Signed\s*by|electronically\s*signed\s*by/i.test(line)) {
      continue;
    }
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
      if (current) samples.push(finalizeSample(current));
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
  if (current) samples.push(finalizeSample(current));
  return samples;
}

function parseLocation(text, label) {
  let loc = (text || "").trim();
  loc = loc.replace(/:\s*$/, ""); // remove trailing colon
  
  // 1) Remove common boilerplates
  loc = loc.replace(/^PROSTATE\s*,?\s*/i, "");
  loc = loc.replace(/\bNEEDLE\s*(CORE\s*)?BIOPSY\b/i, "");
  loc = loc.replace(/\bNEEDLE\s*BX\b/i, "");
  loc = loc.replace(/\bMRI\s*(directed|software\s*fusion)\b/i, "");
  loc = loc.replace(/\bLESION\s*ZONE\b/gi, "");
  loc = loc.replace(/\bLESION\b/gi, "");
  
  // 2) remove sample label if present
  const labelRegex = new RegExp(`\\b${label}\\b\\s*`, "i");
  loc = loc.replace(labelRegex, "");

  // 3) Clean leftover punctuation like " - " or ", "
  loc = loc.replace(/\s*-\s*/g, " ");
  loc = loc.replace(/\s*,\s*/g, " ");
  loc = loc.trim();

  // 4) Attempt to find "TARGET #?" => store as "Target N" 
  // leftover => e.g. "Rt Apex Lateral PZ"
  let targetMatch = loc.match(/\btarget\s*#?\s*(\d+)\b/i);
  if (targetMatch) {
    const tNum = targetMatch[1];
    // remove that "Target #n" from leftover
    let leftover = loc.replace(targetMatch[0], "").trim();
    leftover = leftover.replace(/\s+/g, " ").trim();

    // Return two pieces of info:
    return {
      mainLocation: `Target ${tNum}`,   // just "Target 1"
      leftoverSite: capitalizeWords(leftover), // e.g. "Rt Apex Lateral Pz"
      isTarget: true
    };
  }
  
  // If not a target, leftover is the entire cleaned location
  return {
    mainLocation: capitalizeWords(loc),
    leftoverSite: "",
    isTarget: false
  };
}

// optional helper for title-case
function capitalizeWords(str) {
  return str
    .split(/\s+/)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
}

/**
 * capitalizeWords(str):
 *   optional helper to make "left apex" => "Left Apex", "lateral pz" => "Lateral Pz"
 *   or skip if you prefer original casing.
 */
function capitalizeWords(str) {
  return str
    .split(/\s+/)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
}
function parseShortDiagnosis(txt) {
  const lower = txt.toLowerCase();
  if (lower.includes("acinar adenocarcinoma")) return "Acinar AdenoCA";
  if (lower.includes("ductal adenocarcinoma")) return "Ductal AdenoCA";
  if (lower.includes("transitional cell carcinoma")) return "Transitional Cell CA";
  if (lower.includes("squamous cell carcinoma")) return "Squamous Cell CA";
  if (lower.includes("small cell neuroendocrine carcinoma") || lower.includes("small cell carcinoma")) return "Small Cell CA";
  if (lower.includes("large cell neuroendocrine carcinoma") || lower.includes("large cell carcinoma")) return "Large Cell CA";
  if (lower.includes("adenocarcinoma")) return "AdenoCA";
  if (lower.includes("asap"))          return "ASAP";
  if (lower.includes("hgpin"))         return "HGPIN";
  if (lower.includes("focal atypical small acinar proliferation"))          return "Focal ASAP";
  if (lower.includes("focal high grade prostatic intraepithelial neoplasia"))          return "Focal HGPIN";
  if (lower.includes("prostatitis"))   return "Prostatitis";
  if (lower.includes("inflammation"))  return "Inflammation";
  if (lower.includes("benign") || lower.includes("negative")) return "Benign";
  if (lower.includes("bph"))           return "BPH";
  return "N/A";
}

function parseAncillaryFeatures(txt) {
  const lower = txt.toLowerCase();
  const feats = [];
  if (lower.includes("perineural")) feats.push("PNI");
  if (lower.includes("lymphovascular")) feats.push("LVI");
  if (lower.includes("cribriform")) feats.push("Cribriform");
  if (lower.includes("intraductal")) feats.push("Intraductal");
  return feats.length ? feats.join(", ") : "None";
}

function parsePatternDistribution(txt) {
  const lower = txt.toLowerCase();
  let pattern4 = null, pattern5 = null, tert = null;

  let m = lower.match(/pattern\s*4\s*=\s*(<?\d+%)/);
  if (m) pattern4 = m[1];

  m = lower.match(/pattern\s*5\s*=\s*(<?\d+%)/);
  if (m) pattern5 = m[1];

  const tertRe = /tertiary\s*pattern\s*(\d+)\s+(\<?\d+%)/i;
  m = tertRe.exec(txt);
  if (m) {
    tert = `Tert${m[1]}=${m[2]}`;
  }

  const parts = [];
  if (pattern4) parts.push(`Pattern 4=${pattern4}`);
  if (pattern5) parts.push(`Pattern 5=${pattern5}`);
  if (tert) parts.push(`Tertiary ${tert}`);

  if (!parts.length) return null;
  return parts.join(", ");
}

function parseCoreLengths(text) {
  const pattern = /tumor\s+measures\s+(\d+)\s*mm\s+in\s+a?\s*(\d+)\s*mm\s*core/gi;
  let match;
  const result = [];
  while ((match = pattern.exec(text.toLowerCase())) !== null) {
    const tumorMm = parseInt(match[1], 10);
    const totalMm = parseInt(match[2], 10);
    result.push({ tumorMm, totalMm });
  }
  return result;
}

/*********************************************************************
 * finalizeSample
 *********************************************************************/
function finalizeSample(s) {
  // Combine all location lines
  const rawLoc = s.locationLines.join(" ");
  
  // Use the enhanced parseLocation, which returns { mainLocation, leftoverSite, isTarget }
  const parsedLoc = parseLocation(rawLoc, s.sampleLabel);
  // e.g. parsedLoc.mainLocation = "Target 1" or "Left Mid"
  //      parsedLoc.leftoverSite = "Rt Apex Lateral PZ" (for target)
  //      parsedLoc.isTarget = true/false

  // Combine all diagnosis lines and clean up
  let diagText = s.diagnosisLines.join(" ");
  diagText = diagText.replace(/\s+/g, " ").trim();

  // Existing parse/logic (unchanged)
  const dxShort = parseShortDiagnosis(diagText);
  const ggg = extractGradeGroup(diagText);
  const cpos = extractCoresPositive(diagText);
  const size = extractMaxCoreSize(diagText);
  const feats = parseAncillaryFeatures(diagText);
  const patt = parsePatternDistribution(diagText);
  const coreLens = parseCoreLengths(diagText);

  // Return an object with the new fields plus existing ones
  return {
    sampleLabel: s.sampleLabel,
    // new location breakdown
    location: parsedLoc.mainLocation,   // e.g. "Target 1" or "Left Apex"
    leftoverSite: parsedLoc.leftoverSite, // e.g. "Rt Apex Lateral PZ" (if target)
    isTarget: parsedLoc.isTarget,

    // existing fields
    diagnosis: dxShort,
    gradeGroup: ggg,
    coresPositive: cpos,
    maxCoreSize: size,
    ancillaryFeatures: feats,
    patternDist: patt,
    coreLengths: coreLens
  };
}

function extractCoresPositive(text) {
  let m;

  // 1) "involving X of Y [partially] fragmented cores"
  m = text.match(/involving\s*(\d+)\s*of\s*(\d+)\s*(?:partially\s+fragmented|fragmented)?\s*cores/i);
  if (m) return formatCores(m[1], m[2]);

  // 2) "involving X/Y [partially] fragmented cores"
  m = text.match(/involving\s*(\d+)\/(\d+)\s*(?:partially\s+fragmented|fragmented)?\s*cores/i);
  if (m) return formatCores(m[1], m[2]);

  // 3) "X of Y [partially] fragmented cores"
  m = text.match(/(\d+)\s*of\s*(\d+)\s*(?:partially\s+fragmented|fragmented)?\s*cores/i);
  if (m) return formatCores(m[1], m[2]);

  // 4) "X/Y [partially] fragmented cores"
  m = text.match(/(\d+)\/(\d+)\s*(?:partially\s+fragmented|fragmented)?\s*cores/i);
  if (m) return formatCores(m[1], m[2]);

  // If no match is found
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
  const pattern = /tumor\s+measures\s+(\d+)\s*mm\s+in\s+a?n?\s*(\d+)\s*mm\s*core/gi;
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
 * findMaxGradeGroup
 *********************************************************************/
function findMaxGradeGroup(samples) {
  let maxGG = 0;
  samples.forEach(s => {
    if (s.gradeGroup && s.gradeGroup > maxGG) {
      maxGG = s.gradeGroup;
    }
  });
  return maxGG;
}

/*********************************************************************
 * computePositiveCoresFromSamples
 *********************************************************************/
function computePositiveCoresFromSamples(reportSamples) {
  let sumPos = 0;
  let target_count = 0;
  let foundAnyAdeno = false;
  reportSamples.forEach(s => {
    if (!s.diagnosis.toLowerCase().includes("adeno")) return;
    foundAnyAdeno = true;
    if (!s.coresPositive || s.coresPositive === "N/A") return;

    const match = s.coresPositive.match(/^(\d+)\/(\d+)/);
    if (!match) return;
    let x = parseInt(match[1], 10);
    let y = parseInt(match[2], 10);

    function getMaxCoresForLocation(loc) {
      if (loc.includes("target")) return 1;
      if (loc.includes("apex")) return 3;
      if (loc.includes("mid")) return 2;
      if (loc.includes("base")) return 2;
      return 2;
    }
    const locLower = s.location.toLowerCase();
    const maxSite = getMaxCoresForLocation(locLower);

    if (locLower.includes("target")) {
      target_count++;
      if (x > 0) {
        x = 1; y = 1;
      } else {
        x = 0; y = 1;
      }
    } else {
      if (y > maxSite) y = maxSite;
      if (x > y) x = y;
    }
    sumPos += x;
    console.log("SumPost: ", sumPos)
  });
  if (!foundAnyAdeno) {
    return { posCores: 0, totalCores: 14 };
  }
  return { posCores: sumPos, totalCores: 14+target_count };
}

function calcNCCNRiskGroup(psaRange, gg, tStage, posCores, totalCores) {
  const sumG = gradeGroupToGleasonSum(gg);
  const stageNum = parseTStageNumber(tStage);
  const isPSAunder10 = (psaRange === "<10");
  const isPSA10to20 = (psaRange === "10-20");
  const isPSAover20 = (psaRange === ">20");

  if (/^T3b/i.test(tStage) || /^T4/i.test(tStage)) {
    return "Very High";
  }
  if (gg >= 4 || stageNum >= 3 || isPSAover20) {
    return "High";
  }
  if (stageNum <= 2 && gg === 1 && isPSAunder10) {
    if (/^T1c/i.test(tStage)) {
      return "Very Low";
    }
    return "Low";
  }

  let irfCount = 0;
  if (isPSA10to20) irfCount++;
  if (/^T2b/i.test(tStage) || /^T2c/i.test(tStage)) irfCount++;
  if (gg === 2 || gg === 3) irfCount++;

  let ratio = 0;
  if (totalCores > 0) {
    ratio = posCores / totalCores;
  }
  const is50orMore = (ratio >= 0.5); //calculating intermediate unfavorable risk dz

  if (irfCount === 0) {
    return "Low";
  }
  const meetsFavorable = (irfCount === 1 && (gg === 1 || gg === 2) && !is50orMore);
  if (meetsFavorable) {
    return "Intermediate - Favorable";
  }
  return "Intermediate - Unfavorable";
}

function parseTStageNumber(tStage) {
  const m = tStage.match(/^T(\d+)/i);
  if (m) return parseInt(m[1], 10);
  return 1;
}

function sortReportsByDateDesc(reps) {
  reps.sort((a, b) => {
    const dA = Date.parse(a.date);
    const dB = Date.parse(b.date);
    return (isNaN(dB) ? 0 : dB) - (isNaN(dA) ? 0 : dA);
  });
}

/*********************************************************************
 * buildComparisonTable
 *********************************************************************/
function buildComparisonTable(allReports) {
  const thead = document.querySelector("#comparisonTable thead");
  const tbody = document.querySelector("#comparisonTable tbody");
  thead.innerHTML = "";
  tbody.innerHTML = "";

  if (!allReports.length) return;

  const allSampleLabels = new Set();
  allReports.forEach(r => {
    r.samples.forEach(s => allSampleLabels.add(s.sampleLabel));
  });
  const sortedLabels = [...allSampleLabels].sort();

  const row1 = document.createElement("tr");

  const sampleTh = document.createElement("th");
  sampleTh.textContent = "Sample";
  row1.appendChild(sampleTh);

  const locTh = document.createElement("th");
  locTh.textContent = "Location";
  row1.appendChild(locTh);

  allReports.forEach((r, i) => {
    const th = document.createElement("th");
    const radio = document.createElement("input");
    radio.type = "radio";
    radio.name = "nomogramSelect";
    radio.className = "nomogram-radio";
    radio.value = i.toString();
    if (i === 0) radio.defaultChecked = true;

    const label = document.createElement("label");
    label.style.display = "block";
    label.textContent = `${r.date} (NCCN: ${r.nccnRisk})`;

    th.appendChild(radio);
    th.appendChild(label);
    row1.appendChild(th);
  });

  thead.appendChild(row1);

  // build body
  sortedLabels.forEach(label => {
    const tr = document.createElement("tr");

    const sampleTd = document.createElement("td");
    sampleTd.textContent = label;
    tr.appendChild(sampleTd);

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

    allReports.forEach(r => {
      const sampleObj = r.samples.find(s => s.sampleLabel === label);
      
      const cell = document.createElement("td");
      if (!sampleObj) {
        
        cell.textContent = "N/A";
      } else 
      {
  
        let combined = "";
        if (sampleObj.isTarget && sampleObj.leftoverSite) {
          combined += sampleObj.leftoverSite + " - ";
        }
        
        if (sampleObj.diagnosis && sampleObj.diagnosis !== "N/A") {
          combined += sampleObj.diagnosis;
          if (sampleObj.patternDist) {
            combined += `(${sampleObj.patternDist})`;
          }
             
          
          
        }
        if (sampleObj.gradeGroup) {
          combined += (combined ? ", GG=" : "GG=") + sampleObj.gradeGroup;
          cell.classList.add("cancer");
        }
        if (sampleObj.coresPositive && sampleObj.coresPositive !== "N/A") {
          combined += (combined ? ", Cores=" : "Cores=") + sampleObj.coresPositive;
        }
        if (sampleObj.maxCoreSize && sampleObj.maxCoreSize !== "N/A") {
          combined += (combined ? ", Max Core w Cancer=" : "Max Core w Cancer=") 
                    + sampleObj.maxCoreSize;
        }
        if (sampleObj.ancillaryFeatures && sampleObj.ancillaryFeatures !== "None") {
          combined += (combined ? ", " : "") + sampleObj.ancillaryFeatures;
        }
        if (!combined) combined = "N/A";

        const container = document.createElement("span");
        container.textContent = combined;

        // If we have coreLengths => "View Cores" link => on hover => popup
        if (sampleObj.coreLengths && sampleObj.coreLengths.length > 0) {
          container.appendChild(document.createTextNode(" "));

          const hoverLink = document.createElement("span");
          hoverLink.textContent = "[View Cores]";
          hoverLink.style.textDecoration = "underline";
          hoverLink.style.color = "blue";
          hoverLink.style.cursor = "pointer";

          // MOUSEENTER => show popup
          hoverLink.addEventListener("mouseenter", (ev) => {
            showCoresPopup(ev, sampleObj.coreLengths);
          });
          // MOUSELEAVE => hide popup
          hoverLink.addEventListener("mouseleave", () => {
            hideCoresPopup();
          });

          container.appendChild(hoverLink);
        }

        cell.appendChild(container);
      }
      tr.appendChild(cell);
    });

    tbody.appendChild(tr);
  });
  // after building table, if there's at least one report:

}

/*********************************************************************
 * Show/Hide an absolute-positioned popup near the link
 *********************************************************************/
function showCoresPopup(evt, coreArray) {
  const popup = document.getElementById("coresPopup");
  if (!popup) return;

  // Build the content => bar chart
  popup.innerHTML = ""; // clear old

  // We'll keep it minimal
  const pxPerMm = 5;
  const minBarHeight = 30;

  coreArray.forEach((core, i) => {
    const { tumorMm, totalMm } = core;
    // e.g. "Core #1: 2mm/9mm"
    const labelDiv = document.createElement("div");
    labelDiv.textContent = `Core #${i+1}: ${tumorMm}mm/${totalMm}mm`;
    labelDiv.style.fontSize = "12px";
    labelDiv.style.marginBottom = "3px";
    popup.appendChild(labelDiv);

    // bar
    const totalH = Math.max(totalMm*pxPerMm, minBarHeight);
    let tumorH = (tumorMm/totalMm)*totalH;
    if (tumorMm>0 && tumorH<2) tumorH=2;

    const barOuter = document.createElement("div");
    barOuter.style.width = "30px";
    barOuter.style.height = totalH + "px";
    barOuter.style.border = "1px solid #000";
    barOuter.style.backgroundColor = "#fff";
    barOuter.style.position = "relative";
    barOuter.style.marginBottom = "8px";

    const tumorDiv = document.createElement("div");
    tumorDiv.style.position = "absolute";
    tumorDiv.style.bottom = 0;
    tumorDiv.style.width = "100%";
    tumorDiv.style.height = tumorH+"px";
    tumorDiv.style.backgroundColor = "blue";

    barOuter.appendChild(tumorDiv);
    popup.appendChild(barOuter);
  });

  // position popup near the link
  const linkRect = evt.target.getBoundingClientRect();
  // place it to the right of link
  popup.style.left = (window.scrollX + linkRect.right + 10) + "px";
  popup.style.top = (window.scrollY + linkRect.top) + "px";

  popup.style.display = "block";
}

function hideCoresPopup() {
  const popup = document.getElementById("coresPopup");
  if (!popup) return;
  popup.style.display = "none";
}

/*********************************************************************
 * "Clear" Button => reset
 *********************************************************************/
document.getElementById("clearBtn").addEventListener("click", () => {
  document.getElementById("reportText").value = "";
  allReports = [];
  patientDob = null;

  const thead = document.querySelector("#comparisonTable thead");
  const tbody = document.querySelector("#comparisonTable tbody");
  if (thead) thead.innerHTML = "";
  if (tbody) tbody.innerHTML = "";

  document.getElementById("dobSpan").textContent = "N/A";
  document.getElementById("nccnRiskResult").textContent = "N/A";
  document.getElementById("riskDetails").textContent = "(PSA=?, Gleason=?, Stage=?)";

  const nomoDiv = document.getElementById("nomogramSection");
  if (nomoDiv) nomoDiv.style.display = "none";

  document.getElementById("ageInput").value = "";
  document.getElementById("psaInput").value = "";
  document.getElementById("gggSelect").value = "1";
  document.getElementById("stageSelectNom").value = "T1";
  document.getElementById("posCoresInput").value = "";
  document.getElementById("negCoresInput").value = "";
  document.getElementById("hormoneTherapy").value = "No";
  document.getElementById("radiationTherapy").value = "No";

  document.getElementById("warnings").textContent = "";
  document.getElementById("results").innerHTML = "";

  hideCoresPopup();
});