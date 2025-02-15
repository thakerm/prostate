/*********************************************************************
 * GLOBAL DATA & HELPER FUNCTIONS
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
  let highestRank = 0,
      highestStr = "Low";
  reportArray.forEach(r => {
    const rank = RISK_ORDER[r.nccnRisk] || 0;
    if (rank > highestRank) {
      highestRank = rank;
      highestStr = r.nccnRisk;
    }
  });
  return highestStr;
}

function mapPsaRangeToNumeric(psaVal) {
  if (psaVal === "PSA") {
    // Use manual PSA value if entered; default to 10 if empty/invalid.
    const manual = parseFloat(document.getElementById("psaManualInput").value);
    return (!isNaN(manual) && manual > 0) ? manual : 10;
  } else if (psaVal === "<10") {
    return 5;
  } else if (psaVal === "10-20") {
    return 15;
  } else if (psaVal === ">20") {
    return 25;
  }
  return 5;
}

function capitalizeWords(str) {
  return str
    .split(/\s+/)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
}

/*********************************************************************
 * PSA SELECT & CUSTOM INPUT
 *********************************************************************/
document.getElementById("psaSelect").addEventListener("change", function() {
  const psaInput = document.getElementById("psaManualInput");
  if (this.value === "PSA") {
    psaInput.style.display = "inline-block";
  } else {
    psaInput.style.display = "none";
    psaInput.value = "";
  }
});

/*********************************************************************
 * GRADE GROUP FUNCTIONS
 *********************************************************************/
function extractGradeGroup(text) {
  const m = text.match(/grade\s+group\s+(\d+)/i);
  const gg = m ? parseInt(m[1], 10) : 0;
  return (gg >= 1 && gg <= 5) ? gg : 0;
}

function gradeGroupToGleasonSum(gg) {
  switch (gg) {
    case 1: return 6;
    case 2:
    case 3: return 7;
    case 4: return 8;
    case 5: return 9;
    default: return 6;
  }
}

/*********************************************************************
 * DATE / AGE / REPORT CHUNKING FUNCTIONS
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
  return m ? m[1].trim() : null;
}

function calcAgeFromDob(dobStr) {
  const dobMs = Date.parse(dobStr);
  if (isNaN(dobMs)) return null;
  const dobDate = new Date(dobMs);
  const now = new Date();
  let age = now.getFullYear() - dobDate.getFullYear();
  if (now.getMonth() < dobDate.getMonth() ||
      (now.getMonth() === dobDate.getMonth() && now.getDate() < dobDate.getDate())) {
    age--;
  }
  return age;
}

/*********************************************************************
 * FINAL DIAGNOSIS & SAMPLE PARSING
 *********************************************************************/
function extractFinalDxLines(reportText) {
  const rawLines = reportText.split(/\r?\n/).map(l => l.trim());
  const mergedLines = [];
  // Merge lines ending with "See" that are followed by a "Comment" line.
  for (let i = 0; i < rawLines.length; i++) {
    let line = rawLines[i];
    if (!line) continue;
    if (/\bsee\s*$/i.test(line) && /^comment\b/i.test(rawLines[i + 1] || "")) {
      line += " " + rawLines[++i];
    }
    mergedLines.push(line);
  }
  let inFinal = false;
  const dxLines = [];
  for (const line of mergedLines) {
    if (/^FINAL\s+PATHOLOGIC\s+DIAGNOSIS/i.test(line)) {
      inFinal = true;
      continue;
    }
    if (!inFinal) continue;
    if (/^comment\s*$/i.test(line) ||
        /^Gross\s+Description\s*$/i.test(line) ||
        /^Clinical\s+History\s*$/i.test(line) ||
        /^Specimen\(s\)\s*Received/i.test(line) ||
        /^FHIR\s+Pathology/i.test(line)) {
      break;
    }
    if (/disclaimer|immunohistochemistry|\*\*\s*Report\s*Electronically\s*Signed\s*by|electronically\s*signed\s*by/i.test(line)) {
      continue;
    }
    if (!line) continue;
    dxLines.push(line);
  }
  return dxLines;
}

function parseSamplesFromDx(dxLines) {
  const samples = [];
  let current = null;
  const sampleHeaderRegex = /^[^\S\r\n]*([A-Z])[\.\):]\s*(.*)/;
  dxLines.forEach(line => {
    const match = line.match(sampleHeaderRegex);
    if (match) {
      if (current) samples.push(finalizeSample(current));
      current = {
        sampleLabel: match[1],
        locationLines: match[2] ? [match[2].trim()] : [],
        diagnosisLines: [],
        foundDiagnosis: false
      };
    } else if (current) {
      if (line.startsWith("-")) {
        current.foundDiagnosis = true;
        current.diagnosisLines.push(line.replace(/^-+\s*/, ""));
      } else {
        (current.foundDiagnosis ? current.diagnosisLines : current.locationLines).push(line);
      }
    }
  });
  if (current) samples.push(finalizeSample(current));
  return samples;
}

function parseLocation(text, label) {
  let loc = text.replace(/:\s*$/, "")
                .replace(/^PROSTATE\s*,?\s*/i, "")
                .replace(/\bNEEDLE\s*(CORE\s*)?BIOPSY\b/i, "")
                .replace(/\bNEEDLE\s*BX\b/i, "")
                .replace(/\bMRI\s*(directed|software\s*fusion)\b/i, "")
                .replace(/\bLESION\s*ZONE\b/gi, "")
                .replace(/\bLESION\b/gi, "");
  loc = loc.replace(new RegExp(`\\b${label}\\b\\s*`, "i"), "")
           .replace(/\s*[-,]\s*/g, " ")
           .trim();
  const targetMatch = loc.match(/\btarget\s*#?\s*(\d+)\b/i);
  if (targetMatch) {
    const leftover = capitalizeWords(loc.replace(targetMatch[0], "").trim());
    return {
      mainLocation: `Target ${targetMatch[1]}`,
      leftoverSite: leftover,
      isTarget: true
    };
  }
  return { mainLocation: capitalizeWords(loc), leftoverSite: "", isTarget: false };
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
  if (lower.includes("asap")) return "ASAP";
  if (lower.includes("hgpin") || lower.includes("high grade prostatic intraepithelial neoplasia")) return "HGPIN";
  if (lower.includes("focal atypical small acinar proliferation")) return "Focal ASAP";
  if (lower.includes("focal high grade prostatic intraepithelial neoplasia")) return "Focal HGPIN";
  if (lower.includes("prostatitis")) return "Prostatitis";
  if (lower.includes("inflammation")) return "Inflammation";
  if (lower.includes("benign") || lower.includes("negative")) return "Benign";
  if (lower.includes("bph")) return "BPH";
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
  let pattern4 = lower.match(/pattern\s*4\s*=\s*(<?\d+%)/)?.[1];
  let pattern5 = lower.match(/pattern\s*5\s*=\s*(<?\d+%)/)?.[1];
  let tertMatch = txt.match(/tertiary\s*pattern\s*(\d+)\s+(\<?\d+%)/i);
  let tert = tertMatch ? `Tert${tertMatch[1]}=${tertMatch[2]}` : null;
  const parts = [];
  if (pattern4) parts.push(`Pattern 4=${pattern4}`);
  if (pattern5) parts.push(`Pattern 5=${pattern5}`);
  if (tert) parts.push(`Tertiary ${tert}`);
  return parts.length ? parts.join(", ") : null;
}

/*********************************************************************
 * CORE LENGTH PARSING HELPERS
 *********************************************************************/
function parseCoreLengths(text) {
  const lower = text.toLowerCase();
  const result = [];
  const reStandard = new RegExp(
    "tumor\\s+measures\\s*<?\\s*(\\d+(?:\\.\\d+)?)(?:\\s*mm)?\\s+in\\s+a?n?\\s*(\\d+(?:\\.\\d+)?)(?:\\s*mm)?\\s*(?:core|cores|needle\\s*biops(?:y|ies)|prostate\\s+tissue)",
    "gi"
  );
  let match;
  while ((match = reStandard.exec(lower)) !== null) {
    const tumorVal = parseExactOrLess(match[1]);
    const totalVal = parseExact(match[2]);
    if (tumorVal != null && totalVal != null) {
      result.push({ tumorMm: tumorVal, totalMm: totalVal });
    }
  }
  const reFrag = /tumor\s+measures\s*<?\s*(\d+(?:\.\d+)?)(?:\s*mm)?\s+in\s+(\d+(?:\.\\d+)?)(?:\s*mm)?\s+of\s+fragmented\s+cores/gi;
  while ((match = reFrag.exec(lower)) !== null) {
    const tumorVal = parseExactOrLess(match[1]);
    const totalVal = parseExact(match[2]);
    if (tumorVal != null && totalVal != null) {
      result.push({ tumorMm: tumorVal, totalMm: totalVal });
    }
  }
  return result;
}

function parseExactOrLess(str) {
  const s = str.trim();
  if (s.startsWith("<")) {
    const numPart = s.slice(1).trim();
    return interpretLess(parseFloat(numPart));
  }
  return parseExact(s);
}

function parseExact(s) {
  const val = parseFloat(s);
  return isNaN(val) ? null : val;
}

function interpretLess(x) {
  return isNaN(x) ? null : (x >= 0.2 ? x - 0.1 : 0.1);
}

/*********************************************************************
 * FINALIZE SAMPLE & RELATED FUNCTIONS
 *********************************************************************/
function finalizeSample(s) {
  const rawLoc = s.locationLines.join(" ");
  const parsedLoc = parseLocation(rawLoc, s.sampleLabel);
  let diagText = s.diagnosisLines.join(" ").replace(/\s+/g, " ").trim();
  return {
    sampleLabel: s.sampleLabel,
    location: parsedLoc.mainLocation,
    leftoverSite: parsedLoc.leftoverSite,
    isTarget: parsedLoc.isTarget,
    diagnosis: parseShortDiagnosis(diagText),
    gradeGroup: extractGradeGroup(diagText),
    coresPositive: extractCoresPositive(diagText),
    maxCoreSize: extractMaxCoreSize(diagText),
    ancillaryFeatures: parseAncillaryFeatures(diagText),
    patternDist: parsePatternDistribution(diagText),
    coreLengths: parseCoreLengths(diagText)
  };
}

function extractGleasonScore(text) {
  const m = text.match(/gleason\s*(?:score\s*)?(\d+)\s*\+\s*(\d+)\s*(?:=\s*(\d+))?/i);
  if (!m) return 0;
  const p = parseInt(m[1], 10);
  const s = parseInt(m[2], 10);
  let sum = p + s;
  if (m[3]) {
    const sumParsed = parseInt(m[3], 10);
    if (!isNaN(sumParsed)) sum = sumParsed;
  }
  return sum;
}

function gleasonSumToGradeGroup(sum) {
  if (sum <= 6) return 1;
  if (sum === 7) return 2;
  if (sum === 8) return 4;
  return 5;
}

function extractCoresPositive(text) {
  let m;
  m = text.match(/involving\s*(\d+)\s*of\s*(\d+)\s*(?:partially\s+fragmented|fragmented)?\s*(?:core|cores|prostatic tissue|needle\s*biopsies)/i);
  if (m) return formatCores(m[1], m[2]);
  m = text.match(/involving\s*(\d+)\/(\d+)\s*(?:partially\s+fragmented|fragmented)?\s*(?:core|cores|needle\s*biopsies)/i);
  if (m) return formatCores(m[1], m[2]);
  m = text.match(/(\d+)\s*of\s*(\d+)\s*(?:partially\s+fragmented|fragmented)?\s*(?:core|cores|needle\s*biopsies)/i);
  if (m) return formatCores(m[1], m[2]);
  m = text.match(/(\d+)\/(\d+)\s*(?:partially\s+fragmented|fragmented)?\s*(?:core|cores|needle\s*biopsies)/i);
  if (m) return formatCores(m[1], m[2]);
  m = text.match(/involving\s+all\s+cores\s*\(\s*(\d+)\s*of\s*(\d+)\s*(?:core|cores?)\s*\)/i);
  if (m) return formatCores(m[1], m[2]);
  if (text.toLowerCase().includes("a small focus") && text.toLowerCase().includes("adenocarcinoma"))
    return formatCores("1", "1");
  const fallbackRegex = /INVOLVING FRAGMENTED CORES \(TUMOR MEASURES [\d\.]+ mm IN [\d\.]+ mm OF FRAGMENTED CORES\)/;
  if (fallbackRegex.test(text)) return formatCores("1", "1");
  return "N/A";
}

function formatCores(x, y) {
  const X = parseFloat(x);
  const Y = parseFloat(y);
  if (!isNaN(X) && !isNaN(Y) && Y !== 0) {
    const pct = Math.round((X / Y) * 100);
    return `${X}/${Y}(${pct}%)`;
  }
  return "N/A";
}

function extractMaxCoreSize(text) {
  const lower = text.toLowerCase();
  let maxSize = null;
  function maybeUpdateMax(value) { if (maxSize === null || value > maxSize) maxSize = value; }
  let match;
  const reMeasures = /tumor\s+measures\s+(\d+(?:\.\d+)?)\s*mm\s+in\s+a?n?\s*(\d+(?:\.\d+)?)\s*mm\s*(?:core|cores|needle\s*biops(?:y|ies))?\b/gi;
  while ((match = reMeasures.exec(lower)) !== null) {
    maybeUpdateMax(parseFloat(match[1]));
  }
  const reMeasuresLess = /tumor\s+measures\s*<\s*(\d+(?:\.\d+)?)\s*mm\s+in\s+a?n?\s*(\d+(?:\.\d+)?)\s*mm\s*(?:core|cores|needle\s*biops(?:y|ies))?\b/gi;
  while ((match = reMeasuresLess.exec(lower)) !== null) {
    let sizeVal = parseFloat(match[1]);
    sizeVal = (sizeVal >= 0.2 ? sizeVal - 0.1 : 0.1);
    maybeUpdateMax(sizeVal);
  }
  const reLength = /(\d+(?:\.\d+)?)\s*mm\s+(?:length\s+of\s+involvement)\b/gi;
  while ((match = reLength.exec(lower)) !== null) {
    maybeUpdateMax(parseFloat(match[1]));
  }
  const reLengthLess = /length\s+of\s+involvement\s*<\s*(\d+(?:\.\d+)?)/gi;
  while ((match = reLengthLess.exec(lower)) !== null) {
    let sizeVal = parseFloat(match[1]);
    sizeVal = (sizeVal >= 0.2 ? sizeVal - 0.1 : 0.1);
    maybeUpdateMax(sizeVal);
  }
  const reFrag = /tumor\s+measures\s+(\d+(?:\.\d+)?)\s*mm\s+in\s+(\d+(?:\.\d+)?)\s*mm\s+of\s+fragmented\s+cores?/gi;
  while ((match = reFrag.exec(lower)) !== null) {
    maybeUpdateMax(parseFloat(match[1]));
  }
  const reFragLess = /tumor\s+measures\s*<\s*(\d+(?:\.\d+)?)\s*mm\s+in\s+(\d+(?:\.\d+)?)\s*mm\s+of\s+fragmented\s+cores?/gi;
  while ((match = reFragLess.exec(lower)) !== null) {
    let sizeVal = parseFloat(match[1]);
    sizeVal = (sizeVal >= 0.2 ? sizeVal - 0.1 : 0.1);
    maybeUpdateMax(sizeVal);
  }
  const reNoIn = /tumor\s+measures\s+(\d+(?:\.\d+)?)\s*mm\b/gi;
  while ((match = reNoIn.exec(lower)) !== null) {
    maybeUpdateMax(parseFloat(match[1]));
  }
  const reNoInLess = /tumor\s+measures\s*<\s*(\d+(?:\.\d+)?)\s*mm\b/gi;
  while ((match = reNoInLess.exec(lower)) !== null) {
    let sizeVal = parseFloat(match[1]);
    sizeVal = (sizeVal >= 0.2 ? sizeVal - 0.1 : 0.1);
    maybeUpdateMax(sizeVal);
  }
  return maxSize === null ? "N/A" : `${maxSize}mm`;
}

function findMaxGradeGroup(samples) {
  return samples.reduce((max, s) => s.gradeGroup > max ? s.gradeGroup : max, 0);
}

function computePositiveCoresFromSamples(reportSamples) {
  let sumPos = 0, targetCount = 0, foundAnyAdeno = false;
  reportSamples.forEach(s => {
    if (!s.diagnosis.toLowerCase().includes("adeno")) return;
    foundAnyAdeno = true;
    if (!s.coresPositive || s.coresPositive === "N/A") return;
    const match = s.coresPositive.match(/^(\d+)\/(\d+)/);
    if (!match) return;
    let x = parseInt(match[1], 10),
        y = parseInt(match[2], 10);
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
      targetCount++;
      x = (x > 0 ? 1 : 0);
      y = 1;
    } else {
      if (y > maxSite) y = maxSite;
      if (x > y) x = y;
    }
    sumPos += x;
  });
  return foundAnyAdeno ? { posCores: sumPos, totalCores: 14 + targetCount }
                      : { posCores: 0, totalCores: 14 };
}

function parseTStageNumber(tStage) {
  const m = tStage.match(/^T(\d+)/i);
  return m ? parseInt(m[1], 10) : 1;
}

function calcNCCNRiskGroup(psaRange, gg, tStage, posCores, totalCores) {
  const sumG = gradeGroupToGleasonSum(gg);
  const stageNum = parseTStageNumber(tStage);
  let custom_psa = (typeof psaRange === "number")
                    ? psaRange
                    : (psaRange === "<10" ? 5 : (psaRange === "10-20" ? 15 : (psaRange === ">20" ? 25 : 0)));
  const isT3bOrT4 = /^T3a/i.test(tStage) || /^T3b/i.test(tStage) || /^T4/i.test(tStage);
  const isGG4or5 = (gg >= 4);
  const isPSAover40 = (custom_psa >= 40);
  let countVH = (isT3bOrT4 + isGG4or5 + isPSAover40);
  if (countVH >= 2) return "Very High";
  let isPSAover20 = custom_psa >= 20 || psaRange === ">20";
  if (isT3bOrT4 || isGG4or5 || isPSAover20) return "High";
  const isPSAunder10 = psaRange === "<10";
  const isPSA10to20 = psaRange === "10-20";
  if (stageNum <= 1 && gg === 1 && isPSAunder10 && /^T1c/i.test(tStage)) return "Very Low";
  if (stageNum <= 2 && gg === 1 && isPSAunder10) return "Low";
  let irfCount = 0;
  if (isPSA10to20) irfCount++;
  if (/^T2b/i.test(tStage) || /^T2c/i.test(tStage)) irfCount++;
  if (gg === 2 || gg === 3) irfCount++;
  const ratio = totalCores > 0 ? posCores / totalCores : 0;
  const is50orMore = (ratio >= 0.5);
  if (irfCount === 0) return "Low";
  if (irfCount === 1 && (gg === 1 || gg === 2) && !is50orMore) return "Intermediate - Favorable";
  return "Intermediate - Unfavorable";
}

function sortReportsByDateDesc(reps) {
  reps.sort((a, b) => Date.parse(b.date) - Date.parse(a.date));
}

/*********************************************************************
 * BUILD COMPARISON TABLE & CORE POPUP
 *********************************************************************/
function buildComparisonTable(allReports) {
  const thead = document.querySelector("#comparisonTable thead");
  const tbody = document.querySelector("#comparisonTable tbody");
  thead.innerHTML = "";
  tbody.innerHTML = "";
  if (!allReports.length) return;
  const allSampleLabels = new Set();
  allReports.forEach(r => r.samples.forEach(s => allSampleLabels.add(s.sampleLabel)));
  const sortedLabels = Array.from(allSampleLabels).sort();

  // Build header row with a radio button for each report date.
  const headerRow = document.createElement("tr");
  headerRow.appendChild(Object.assign(document.createElement("th"), { textContent: "Sample" }));
  headerRow.appendChild(Object.assign(document.createElement("th"), { textContent: "Location" }));
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
    th.append(radio, label);
    headerRow.appendChild(th);
  });
  thead.appendChild(headerRow);

  // Build table body.
  sortedLabels.forEach(sampleLabel => {
    const tr = document.createElement("tr");
    tr.appendChild(Object.assign(document.createElement("td"), { textContent: sampleLabel }));
    let foundLoc = "N/A";
    for (let i = 0; i < allReports.length; i++) {
      const s = allReports[i].samples.find(s => s.sampleLabel === sampleLabel);
      if (s) { foundLoc = s.location; break; }
    }
    tr.appendChild(Object.assign(document.createElement("td"), { textContent: foundLoc }));
    allReports.forEach(r => {
      const sampleObj = r.samples.find(s => s.sampleLabel === sampleLabel);
      const td = document.createElement("td");
      if (!sampleObj) {
        td.textContent = "N/A";
      } else {
        let combined = "";
        if (sampleObj.isTarget && sampleObj.leftoverSite) {
          combined += sampleObj.leftoverSite + " - ";
        }
        if (sampleObj.diagnosis && sampleObj.diagnosis !== "N/A") {
          combined += sampleObj.diagnosis;
          if (sampleObj.patternDist) combined += `(${sampleObj.patternDist})`;
        }
        if (sampleObj.gradeGroup) {
          combined += (combined ? ", GG=" : "GG=") + sampleObj.gradeGroup;
        }
        if (sampleObj.coresPositive && sampleObj.coresPositive !== "N/A") {
          combined += (combined ? ", Cores=" : "Cores=") + sampleObj.coresPositive;
        }
        if (sampleObj.maxCoreSize && sampleObj.maxCoreSize !== "N/A") {
          combined += (combined ? ", Max Core w Cancer=" : "Max Core w Cancer=") + sampleObj.maxCoreSize;
        }
        if (sampleObj.ancillaryFeatures && sampleObj.ancillaryFeatures !== "None") {
          combined += (combined ? ", " : "") + sampleObj.ancillaryFeatures;
        }
        if (!combined) combined = "N/A";
        const span = document.createElement("span");
        span.textContent = combined;
        if (sampleObj.coreLengths && sampleObj.coreLengths.length > 0) {
          span.appendChild(document.createTextNode(" "));
          const hoverLink = document.createElement("span");
          hoverLink.textContent = "[View Cores]";
          hoverLink.style.textDecoration = "underline";
          hoverLink.style.color = "blue";
          hoverLink.style.cursor = "pointer";
          hoverLink.addEventListener("mouseenter", ev => showCoresPopup(ev, sampleObj.coreLengths));
          hoverLink.addEventListener("mouseleave", hideCoresPopup);
          span.appendChild(hoverLink);
        }
        td.appendChild(span);
      }
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  });
}

function showCoresPopup(evt, coreArray) {
  const popup = document.getElementById("coresPopup");
  if (!popup) return;
  popup.innerHTML = "";
  const pxPerMm = 5, minBarHeight = 30;
  coreArray.forEach((core, i) => {
    const labelDiv = document.createElement("div");
    labelDiv.textContent = `Core #${i + 1}: ${core.tumorMm}mm/${core.totalMm}mm`;
    labelDiv.style.fontSize = "12px";
    labelDiv.style.marginBottom = "3px";
    popup.appendChild(labelDiv);
    const totalH = Math.max(core.totalMm * pxPerMm, minBarHeight);
    let tumorH = (core.tumorMm / core.totalMm) * totalH;
    if (core.tumorMm > 0 && tumorH < 2) tumorH = 2;
    const barOuter = document.createElement("div");
    barOuter.style.cssText = `width:30px; height:${totalH}px; border:1px solid #000; background:#fff; position:relative; margin-bottom:8px;`;
    const tumorDiv = document.createElement("div");
    tumorDiv.style.cssText = `position:absolute; bottom:0; width:100%; height:${tumorH}px; background:blue;`;
    barOuter.appendChild(tumorDiv);
    popup.appendChild(barOuter);
  });
  const linkRect = evt.target.getBoundingClientRect();
  popup.style.left = (window.scrollX + linkRect.right + 10) + "px";
  popup.style.top = (window.scrollY + linkRect.top) + "px";
  popup.style.display = "block";
}

function hideCoresPopup() {
  const popup = document.getElementById("coresPopup");
  if (popup) popup.style.display = "none";
}

/*********************************************************************
 * EVENT HANDLERS
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
  const psaRange = mapPsaRangeToNumeric(document.getElementById("psaSelect").value);
  const tStage = document.getElementById("stageSelect").value;

  chunks.forEach(chunk => {
    const date = parseCollectedDate(chunk) || "Unknown";
    const dobStr = parseDob(chunk);
    if (dobStr && !patientDob) patientDob = dobStr;
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
    const overallMaxGleason = allReports.reduce((acc, r) => Math.max(acc, r.maxGleasonSum || 0), 0);
    document.getElementById("riskDetails").textContent = `(PSA=${psaRange}, Gleason=${overallMaxGleason}, Stage=${tStage})`;
  } else {
    document.getElementById("dobSpan").textContent = "N/A";
    document.getElementById("nccnRiskResult").textContent = "N/A";
    document.getElementById("riskDetails").textContent = "(PSA=?, Gleason=?, Stage=?)";
  }
});

document.getElementById("calcNomogramBtn").addEventListener("click", () => {
  const nomogramDiv = document.getElementById("nomogramDiv");
  nomogramDiv.style.display = "block";
  const radios = document.querySelectorAll(".nomogram-radio");
  const chosenIndex = parseInt(Array.from(radios).find(r => r.checked)?.value, 10);
  if (chosenIndex < 0 || !allReports[chosenIndex]) {
    alert("Please select which biopsy date to use for the nomogram first.");
    return;
  }
  const psaRangeVal = document.getElementById("psaSelect").value;
  const numericPSA = mapPsaRangeToNumeric(psaRangeVal);
  const tStage = document.getElementById("stageSelect").value;
  const chosenReport = allReports[chosenIndex];
  const gg = chosenReport.maxGradeGroup || 1;
  const posCores = chosenReport.posCores;
  const totalCores = chosenReport.totalCores;
  const negCores = totalCores - posCores;
  let ageForNomogram = 65;
  if (patientDob) {
    const possibleAge = calcAgeFromDob(patientDob);
    if (possibleAge > 0) ageForNomogram = possibleAge;
  }
  let stageForNomogram = "T1";
  if (/^T2a/i.test(tStage)) stageForNomogram = "T2a";
  else if (/^T2b/i.test(tStage)) stageForNomogram = "T2b";
  else if (/^T2c/i.test(tStage)) stageForNomogram = "T2c";
  else if (/^T3/i.test(tStage)) stageForNomogram = "T3";
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

document.getElementById("clearBtn").addEventListener("click", () => {
  document.getElementById("reportText").value = "";
  allReports = [];
  patientDob = null;
  document.querySelector("#comparisonTable thead").innerHTML = "";
  document.querySelector("#comparisonTable tbody").innerHTML = "";
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