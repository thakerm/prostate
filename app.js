/*********************************************************************
 * 1) GLOBAL DATA
 *********************************************************************/

let allReports = [];
let patientDob = null;
let overridePSA = false;
let overrideDRE = false;
let overrideCore = false;

//NCCN risk order function
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

//mapping PSA ranges to numerics if chosen (this will likely be depreciated soon)
function mapPsaRangeToNumeric(psaVal) {
  console.log("PSA Val: ", psaVal)
  if (psaVal ==="PSA" || psaVal==="Auto") {
    // the user wants a manual PSA
    const manual = parseFloat(document.getElementById("psaManualInput").value);
    if (!isNaN(manual) && manual > 0) {
      return manual;
    }
  } 
  else if (psaVal === "<10") {
    return 5;  // example numeric approximation
  } else if (psaVal === "10-20") {
    return 15;
  } else if (psaVal === ">20") {
    return 25;
  }
  // fallback
  return 5;
}

//Custom PSA event listener 
document.getElementById("psaSelect").addEventListener("change", function() {
  const val = this.value;  // e.g. "<10", "10-20", ">20", or "PSA"
  const psaInput = document.getElementById("psaManualInput");
  
  if (val === "PSA") {
    psaInput.disabled = false;
    overridePSA = true;

  }
  else if(val==="Auto")
  {
    psaInput.disabled = true;
    overridePSA = false;
  }
  else if (val === "<20" || val === "10-20" || val === ">20") {
    overridePSA = true;
    psaInput.disabled=true;
  }
  
});

// Attach event listeners for both the button and the checkbox
//document.getElementById("calcNomogramBtn").addEventListener("click", updateNomogram);
document.getElementById("nogg1").addEventListener("change", updateNomogram);



// "Custom DRE/Stage event listener"
document.getElementById("stageSelect").addEventListener("change", function() {
  const val = this.value;  // e.g. "Auto", "T1c", "T2", etc.

  if (val === "Auto") {
    overrideDRE = false;
  } else {
    overrideDRE = true;
  }
});

document.getElementById("numBx").addEventListener("change", function() {
  const val = this.value;  // e.g. "Auto", "12", "14", etc.
  
  if (val === "Auto") {
    overrideCore = false;
  } else {
    overrideCore = true;
  }
});

/*********************************************************************
 * GRADE GROUP Extraction, if no GG, will check for Gleason Score 
 * updated 2/12/2025
 *********************************************************************/
function extractGradeGroup(text) {
  // 1) Try to find "grade group X"
  const reGradeGroup = /grade\s+group\s+(\d+)/i;
  let m = text.match(reGradeGroup);
  if (m) {
    const gg = parseInt(m[1], 10);
    if (gg >= 1 && gg <= 5) return gg;
  }

  // 2) If no direct "Grade Group," try to find a Gleason pattern
  //    e.g. "Gleason 3 + 4 = 7" or "Gleason score 3+4=7"
  const reGleason = /gleason\s*(?:score\s*)?(\d+)\s*\+\s*(\d+)\s*(?:=\s*(\d+))?/i;
  m = text.match(reGleason);
  if (m) {
    // m[1] => primary
    // m[2] => secondary
    // m[3] => optional sum
    const p = parseInt(m[1], 10);
    const s = parseInt(m[2], 10);
    if (!isNaN(p) && !isNaN(s)) {
      let sum = p + s;
      if (m[3]) {
        const sumParsed = parseInt(m[3], 10);
        if (!isNaN(sumParsed)) {
          sum = sumParsed;
          if (sum===6)
          {
            gg=1;
          }
          else if(p===3 && sum===7)
          {
            gg=2;
          }
          else if(p===4 && sum===7)
          {
            gg=3;
          }
          else if (sum===8)
          {
            gg=4;
          }
          else gg=5;
        }
      }
      // Now map sum => Grade Group
      return gg;
    }
  }

  // 3) If neither was found, return 0
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

function parseExtraData(reportText) {
  // 1) Split the text into lines
  const lines = reportText.split(/\r?\n/).map(line => line.trim());
  const psaInput = document.getElementById("psaManualInput");
  let numTemplates = null;
  let dre = null;


  // We'll store all PSA occurrences here, each with { value: number, dateStr: 'MM/DD/YYYY', dateObj: Date }
  const psaList = [];

  // 2) Define our regex patterns:
  const reTemplates = /Number\s+of\s+Template\s+Cores:\s*(\d+)/i;
  const reDre = /^DRE:\s*(\S+)/i;
  // For the PSA lines, we look for:
  //   "PSA" [some spaces] <float> [some spaces] <MM/DD/YYYY>
  // Example line: "PSA      2.0      01/07/2023"
  const rePSA = /^PSA\s+(\d+(?:\.\d+)?)\s+(\d{1,2}\/\d{1,2}\/\d{4})/i;

  // 3) Loop through each line and see if it matches
  for (const line of lines) {
    // A) Number of Template Cores
    let m = line.match(reTemplates);
    if (m && overrideCore===false) {
      numTemplates = parseInt(m[1], 10);  // e.g., "12"
      document.getElementById("numBx").value = numTemplates;
      continue;
    }
   /*  else{
      document.getElementById("numBx").value = "14";
    } */
// B) DRE
m = line.match(reDre);
if (m) {
  dre = m[1];  // e.g., "T1c"
  if (!overrideDRE) {
    document.getElementById("stageSelect").value = dre;
  }
  continue;
} else {
  // Only override to "T1c" if the user hasn't manually selected a stage.
  const stageSelectElement = document.getElementById("stageSelect");
  if (!overrideDRE && (stageSelectElement.value === "Auto" || stageSelectElement.value.trim() === "")) {
    stageSelectElement.value = "T1c";
  }
}

    // C) PSA lines
    m = line.match(rePSA);
    if (m) {
      const psaVal = parseFloat(m[1]);   // e.g. "2.0"
      const dateStr = m[2];             // e.g. "01/07/2023"
      const dateObj = parseDateIfPossible(dateStr);
      // Store them in an array
      psaList.push({ value: psaVal, dateStr, dateObj });
      continue;
    }
   
  }

  // 4) If we have multiple PSA readings, pick the **latest** by comparing dateObj
  let latestPSA = null;
  let latestPSADate = null;

  if (psaList.length) {
    // Filter out any invalid dateObj’s that came back null
    const validPsas = psaList.filter(p => p.dateObj !== null);
    // If none are valid, we can skip or pick the earliest by default
    if (validPsas.length) {
      validPsas.sort((a, b) => b.dateObj - a.dateObj);
      const newest = validPsas[0];
      latestPSA = newest.value;
      latestPSADate = newest.dateStr;
    } else {
      // fallback if all date parses failed
      // or you can keep track of the first line if needed
      const first = psaList[0];
      latestPSA = first.value;
      latestPSADate = first.dateStr;
    }
  }
 // const psaInput = document.getElementById("psaManualInput");
  // Only auto-update if the user hasn't overridden PSA and the input is still blank or default.
  if (!overridePSA && (psaInput.value.trim() === "" || psaInput.value === "Auto")) {
    if (latestPSA) {
      psaInput.value = latestPSA;
    } else {
      // If no PSA was found, force manual entry
      document.getElementById("psaSelect").value = "PSA";
      psaInput.disabled = false;
/*       // Optionally, show the snackbar to notify the user.
      var x = document.getElementById("snackbar");
      x.className = "show";
      setTimeout(function() {
        x.className = x.className.replace("show", "");
      }, 3000); */
    }
  }
}

// Helper to parse "MM/DD/YYYY" => a Date object
// returns null if parse fails
function parseDateIfPossible(dateStr) {
  // For US-style "MM/DD/YYYY" strings, we can do:
  const time = Date.parse(dateStr);
  return isNaN(time) ? null : new Date(time);
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
  patientDRE = null;
  numberofcores = null;

  const chunks = chunkReports(rawText);
  if (!chunks.length) {
    alert("No valid reports found (looking for 'Provider:' lines).");
    return;
  }

  document.getElementById("nccn-output").style.display="block";
  document.getElementById("comparisonTableWrapper").style.display = "block";
  document.getElementById("calcnomodiv").style.display = "block"

  parseExtraData(rawText);

  psaRange = mapPsaRangeToNumeric(document.getElementById("psaSelect").value)
  //const psaRange = document.getElementById("psaSelect").value;
  console.log("PSA Range: ", psaRange);
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

  document.querySelectorAll(".nomogram-radio").forEach(radio => {
    radio.addEventListener("change", updateNomogram);
  });

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
  updateNomogram();
});

//i am not sure if this is the correct logic?
function adjustCoresForGg1(report) {
  let adjustedPos = 0;
  
  report.samples.forEach(sample => {
    const diag = sample.diagnosis.toLowerCase();
    // Only count the sample if it indicates adenocarcinoma and has a grade group above 1,
    // and there is a valid coresPositive string.
    if (diag.includes("adenoca") && sample.gradeGroup > 1 && sample.coresPositive && sample.coresPositive !== "N/A") {
      // Expecting coresPositive to be formatted like "2/3(67%)" or "2/3"
      const match = sample.coresPositive.match(/^(\d+)\s*\/\s*(\d+)/);
      if (match) {
        const pos = parseInt(match[1], 10);
        adjustedPos += pos;
      }
    }
  });

  return { posCores: adjustedPos, totalCores: adjustedPos };
}
function updateNomogram() {
  // Show the nomogram section
  const nomogramDiv = document.getElementById("nomogramDiv");
  nomogramDiv.style.display = "block";
  
  // Determine which report (biopsy date) is chosen
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
  
  // Get the core counts from the report.
  // If "Remove GG1" is checked, use our adjusted logic; otherwise, use the reported values.
  let posCores, totalCores;
  if (document.getElementById("nogg1").checked) {
    const adjusted = adjustCoresForGg1(chosenReport);
    posCores = adjusted.posCores;
    totalCores = adjusted.totalCores;
  } else {
    posCores = chosenReport.posCores;
    totalCores = chosenReport.totalCores;
  }
  
  // Count how many target samples are in the report.
  // (Our parse/finishing logic already sets sample.isTarget for target samples.)
  let targetCount = 0;
  chosenReport.samples.forEach(sample => {
    if (sample.isTarget) {
      targetCount++;
    }
  });
  
  // If the user has overridden the core count, we use the manual number for non-target cores
  // and then add the target cores (each target counts as 1).
  const numBxElement = document.getElementById("numBx");
  if (overrideCore && numBxElement.value !== "Auto") {
    const manualNonTarget = parseInt(numBxElement.value, 10);
    totalCores = manualNonTarget + targetCount;
  }
  
  // Compute negative cores as total minus positive.
  const negCores = totalCores - posCores;
  
  let ageForNomogram = 65;
  if (patientDob) {
    const possibleAge = calcAgeFromDob(patientDob);
    if (possibleAge && possibleAge > 0) {
      ageForNomogram = possibleAge;
    }
  }
  
  // Normalize stage for nomogram using regex matching
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
}

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
    // 1) Split lines and trim
    const rawLines = reportText.split(/\r?\n/).map(l => l.trim());
    
    // 2) First pass: merge lines ending in "See" with next line if it starts with "Comment"
    //    e.g. "TUMOR... SEE" + "COMMENT." => "TUMOR... SEE COMMENT."
    const mergedLines = [];
    for (let i = 0; i < rawLines.length; i++) {
      let line = rawLines[i];
      if (!line) continue;
  
      // if the line ends with "See" (ignoring case),
      // check next line for "Comment"
      if (/\bsee\s*$/i.test(line)) {
        const nextLine = rawLines[i+1] ? rawLines[i+1].trim() : "";
        if (/^comment\b/i.test(nextLine)) {
          // unify them => "See Comment"
          line = line + " " + nextLine;
          i++; // skip next line
        }
      }
  
      mergedLines.push(line);
    }
  
    // 3) Second pass: parse final dx lines
    let inFinal = false;
    let dxLines = [];
  
    for (let line of mergedLines) {
      // If we see "FINAL PATHOLOGIC DIAGNOSIS", start capturing
      if (/^FINAL\s+PATHOLOGIC\s+DIAGNOSIS/i.test(line)) {
        inFinal = true;
        continue;
      }
      if (!inFinal) continue;
  
      // If the line is EXACTLY "Comment" => break
      if (/^comment\s*$/i.test(line)) break;
  
      // Also break on these headings
      if (/^Gross\s+Description\s*$/i.test(line)) break;
      if (/^Clinical\s+History\s*$/i.test(line)) break;
      if (/^Specimen\(s\)\s*Received/i.test(line)) break;
      if (/^FHIR\s+Pathology/i.test(line)) break;
  
      // skip disclaimers, signoffs
      if (/disclaimer|immunohistochemistry|\*\*\s*Report\s*Electronically\s*Signed\s*by|electronically\s*signed\s*by/i.test(line)) {
        continue;
      }
  
      if (!line) continue;
  
      dxLines.push(line);
    }
  
    return dxLines;
  }

/*********************************************************************
 * parseSamplesFromDx (updated 2/12/2025)
 *********************************************************************/
function parseSamplesFromDx(dxLines) {
  const samples = [];
  let current = null;
  const sampleHeaderRegex = /^[^\S\r\n]*([A-Z])[\.\):]+(?:\s+(.*))?$/; //updated to work with variable header information
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
  if (lower.includes("high grade prostatic intraepithelial neoplasia"))          return "HGPIN";
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

//updated 2/10/2025
  // Parse core lengths
function parseCoreLengths(text) {
  const lower = text.toLowerCase();
  const result = [];

  // A) Pattern #1: "tumor measures X mm in a/an Y mm (core|cores|needle biopsies|prostate tissue)"
  //    - We also optionally allow < in front of the tumor measurement
  //    - The container group includes: core, cores, needle biopsies, prostate tissue
 /*  const reStandard = new RegExp(
    "tumor\\s+measures\\s*<?\\s*(\\d+(?:\\.\\d+)?)(?:\\s*mm)?\\s+" +
    "in\\s+a?n?\\s*(\\d+(?:\\.\\d+)?)(?:\\s*mm)?\\s*" +
    "(?:core|cores|needle\\s*biops(?:y|ies)|prostate\\s+tissue)",
    "gi"
  );
 */
  const reStandard = new RegExp(
    "tumor\\s+measures\\s*<?\\s*(\\d+(?:\\.\\d+)?)(?:\\s*mm)?\\s+" +
    "(?:(?:in\\s+a?n?)|of)\\s*(\\d+(?:\\.\\d+)?)(?:\\s*mm)?\\s*" +
    "(?:core|cores|needle\\s*biops(?:y|ies)|prostate\\s+tissue)",
    "gi"
  );
  let match;
  while ((match = reStandard.exec(lower)) !== null) {
    // match[1] => tumor measurement
    // match[2] => total measurement
    const tumorVal = parseExactOrLess(match[1]);
    
    const totalVal = parseExact(match[2]);
    console.log("Tumor Total: ", totalVal);
    if (tumorVal != null && totalVal != null) {
      result.push({ tumorMm: tumorVal, totalMm: totalVal });
    }
  }

  // B) Pattern #2: "tumor measures X mm in Y mm of fragmented cores"
  //    e.g. "TUMOR MEASURES 3 MM IN 28 MM OF FRAGMENTED CORES"
  //    Also allow optional < for the tumor measurement
  const reFrag = /tumor\s+measures\s*<?\s*(\d+(?:\.\d+)?)(?:\s*mm)?\s+in\s+(\d+(?:\.\d+)?)(?:\s*mm)?\s+of\s+fragmented\s+cores/gi;
  //const reFrag = /tumor\s+measures\s*<?\s*(\d+(?:\.\d+)?)\s*mm\s+(?:in\s+)?(\d+(?:\.\d+)?)\s*mm\s+(?:of\s+)?fragmented\s+cores?/gi;
  while ((match = reFrag.exec(lower)) !== null) {
    const tumorVal = parseExactOrLess(match[1]);
    const totalVal = parseExact(match[2]);
    if (tumorVal != null && totalVal != null) {
      result.push({ tumorMm: tumorVal, totalMm: totalVal });
    }
  }

  return result;
}

/**
 * parseExactOrLess(str):
 *   If str is "3" => parseFloat=3
 *   If str is "<3" => interpretLess(3) => e.g. 2.9 or 0.9 if <1, etc.
 */
function parseExactOrLess(str) {
  const s = str.trim();
  if (s.startsWith("<")) {
    const numPart = s.slice(1).trim(); // remove "<"
    return interpretLess(parseFloat(numPart));
  }
  return parseExact(s);
}

/**
 * parseExact(str): parseFloat or null if invalid
 */
function parseExact(s) {
  const val = parseFloat(s);
  if (isNaN(val)) return null;
  return val;
}

/**
 * interpretLess(x): if x>=0.2 => x-0.1, else 0.1
 * e.g. "<1 mm" => 0.9 mm
 */
function interpretLess(x) {
  if (isNaN(x)) return null;
  if (x >= 0.2) return x - 0.1;
  return 0.1;
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

//updated 2/7/2025
function extractCoresPositive(text) {
  let m;
  console.log(text);
  // 1) "involving X of Y [partially] fragmented (cores|needle biopsies)";
  m = text.match(
    /involving\s*(\d+)\s*of\s*(\d+)\s*(?:partially\s+fragmented|fragmented)?\s*(?:core|cores|prostatic tissue|needle\s*biopsies)/i
  );
  if (m) 
    {
      console.log("we matched 1");
      return formatCores(m[1], m[2]);
    }
  // 2) "involving X/Y [partially] fragmented (cores|needle biopsies)"
  m = text.match(
    /involving\s*(\d+)\/(\d+)\s*(?:partially\s+fragmented|fragmented)?\s*(?:core|cores|needle\s*biopsies)/i
  );
  if (m) 
    {
      console.log("we matched 2");
      return formatCores(m[1], m[2]);
    }
  // 3) "X of Y [partially] fragmented (cores|needle biopsies)"
  m = text.match(
    /(\d+)\s*of\s*(\d+)\s*(?:partially\s+fragmented|fragmented)?\s*(?:core|cores|needle\s*biopsies)/i
  );
  if (m) 
    {
      console.log("we matched 3");
      return formatCores(m[1], m[2]);
    }

  // 4) "X/Y [partially] fragmented (cores|needle biopsies)"
  m = text.match(
    /(\d+)\/(\d+)\s*(?:partially\s+fragmented|fragmented)?\s*(?:core|cores|needle\s*biopsies)/i
  );
  if (m) 
    {
      console.log("we matched 4");
      return formatCores(m[1], m[2]);
    }
  // 5) "involving ALL CORES (X of X cores)"
  //    e.g. "involving ALL CORES (4 of 4 cores, tumor measures ...)"
  //    interpret => X/X
 // const regex = /involving\s+all\s+cores\s*\(\s*(\d+)\s*of\s*(\d+)\s*(?:core|cores?)\s*\)/i;
  m = text.match(/involving\s+all\s+cores\s*\(\s*(\d+)\s*of\s*(\d+)\s*(?:core|cores?)\s*\)/i);
  if (m) {
    console.log("we matched 5");
    return formatCores(m[1], m[2]); // e.g. "4/4(100%)"
  }

  // 6) "a small focus of adenocarcinoma" => interpret as 1/1
  //    e.g. "A SMALL FOCUS OF PROSTATIC ADENOCARCINOMA..."
  const lower = text.toLowerCase();
  if (lower.includes("a small focus") && lower.includes("adenocarcinoma")) {
    console.log("we matched");
    return formatCores("1", "1"); 
  }

  // 7) Fallback => single line => "involving fragmented cores (tumor measures X mm in Y mm of fragmented cores)"
  //    e.g. "INVOLVING FRAGMENTED CORES (TUMOR MEASURES 3 MM IN 28 MM OF FRAGMENTED CORES)"
  //    interpret as "1/1(100%)"
  const fallbackRegex = /INVOLVING FRAGMENTED CORES \(TUMOR MEASURES [\d\.]+ mm IN [\d\.]+ mm OF FRAGMENTED CORES\)/;
  if (fallbackRegex.test(text)) {
    console.log("we matched");
    return formatCores("1", "1");
  }

  // If no match is found
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

//updated 2/7/2025
function extractMaxCoreSize(text) {
  const lower = text.toLowerCase();
  let maxSize = null;

  // helper to update maxSize if bigger
  function maybeUpdateMax(value) {
    if (maxSize === null || value > maxSize) {
      maxSize = value;
    }
  }

  // A) Pattern A: "tumor measures X mm in a/an Y mm core/biops(y/ies)"
  const reMeasures = /tumor\s+measures\s+(\d+(?:\.\d+)?)\s*mm\s+in\s+a?n?\s*(\d+(?:\.\d+)?)\s*mm\s*(?:core|cores|needle\s*biops(?:y|ies))?\b/gi;
  let match;
  while ((match = reMeasures.exec(lower)) !== null) {
    maybeUpdateMax(parseFloat(match[1]));
  }

  // A2) Pattern A (less than): "tumor measures < X mm in a/an Y mm core..."
  const reMeasuresLess = /tumor\s+measures\s*<\s*(\d+(?:\.\d+)?)\s*mm\s+in\s+a?n?\s*(\d+(?:\.\d+)?)\s*mm\s*(?:core|cores|needle\s*biops(?:y|ies))?\b/gi;
  while ((match = reMeasuresLess.exec(lower)) !== null) {
    let sizeVal = parseFloat(match[1]);
    if (sizeVal >= 0.2) sizeVal -= 0.1;
    else sizeVal = 0.1;
    maybeUpdateMax(sizeVal);
  }

  // B) "X mm length of involvement is identified"
  const reLength = /(\d+(?:\.\d+)?)\s*mm\s+(?:length\s+of\s+involvement)\b/gi;
  while ((match = reLength.exec(lower)) !== null) {
    maybeUpdateMax(parseFloat(match[1]));
  }

  // B2) "length of involvement < X mm"
  const reLengthLess = /length\s+of\s+involvement\s*<\s*(\d+(?:\.\d+)?)/gi;
  while ((match = reLengthLess.exec(lower)) !== null) {
    let sizeVal = parseFloat(match[1]);
    if (sizeVal >= 0.2) sizeVal -= 0.1;
    else sizeVal = 0.1;
    maybeUpdateMax(sizeVal);
  }

  // C) "tumor measures X mm in Y mm of fragmented cores"
  const reFrag = /tumor\s+measures\s+(\d+(?:\.\d+)?)\s*mm\s+in\s+(\d+(?:\.\d+)?)\s*mm\s+of\s+fragmented\s+cores?/gi;
  while ((match = reFrag.exec(lower)) !== null) {
    maybeUpdateMax(parseFloat(match[1]));
  }

  // C2) "tumor measures < X mm in Y mm of fragmented cores"
  const reFragLess = /tumor\s+measures\s*<\s*(\d+(?:\.\d+)?)\s*mm\s+in\s+(\d+(?:\.\d+)?)\s*mm\s+of\s+fragmented\s+cores?/gi;
  while ((match = reFragLess.exec(lower)) !== null) {
    let sizeVal = parseFloat(match[1]);
    if (sizeVal >= 0.2) sizeVal -= 0.1;
    else sizeVal = 0.1;
    maybeUpdateMax(sizeVal);
  }

  // D) **NEW** Fallback #1 => "tumor measures X mm" (no "in a core")
  //    e.g. "TUMOR MEASURES 2 MM" alone.
  const reNoIn = /tumor\s+measures\s+(\d+(?:\.\d+)?)\s*mm\b/gi;
  while ((match = reNoIn.exec(lower)) !== null) {
    maybeUpdateMax(parseFloat(match[1]));
  }

  // D2) **NEW** Fallback #2 => "tumor measures < X mm" alone
  //    e.g. "tumor measures < 1mm"
  const reNoInLess = /tumor\s+measures\s*<\s*(\d+(?:\.\d+)?)\s*mm\b/gi;
  while ((match = reNoInLess.exec(lower)) !== null) {
    let sizeVal = parseFloat(match[1]);
    if (sizeVal >= 0.2) {
      sizeVal -= 0.1;
    } else {
      sizeVal = 0.1;
    }
    maybeUpdateMax(sizeVal);
  }

  // If no match => "N/A"
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
    // Only process samples with adenocarcinoma in the diagnosis
    if (!s.diagnosis.toLowerCase().includes("adeno")) return;
    foundAnyAdeno = true;
    // If no valid coresPositive string is present, skip this sample
    if (!s.coresPositive || s.coresPositive === "N/A") return;

    const match = s.coresPositive.match(/^(\d+)\/(\d+)/);
    if (!match) return;
    let x = parseInt(match[1], 10);
    let y = parseInt(match[2], 10);

    // Determine the maximum cores expected based on the sample's location
    function getMaxCoresForLocation(loc) {
      if (loc.includes("target")) return 1;
      if (loc.includes("apex")) return 3;
      if (loc.includes("mid")) return 2;
      if (loc.includes("base")) return 2;
      return 2;
    }
    const locLower = s.location.toLowerCase();
    const maxSite = getMaxCoresForLocation(locLower);

    // For target samples, force the count to 1 core per sample
    if (locLower.includes("target")) {
      target_count++;
      if (x > 0) {
        x = 1; 
        y = 1;
      } else {
        x = 0; 
        y = 1;
      }
    } else {
      // Ensure that the reported total does not exceed the maximum expected for that site
      if (y > maxSite) y = maxSite;
      if (x > y) x = y;
    }
    sumPos += x;
  });

  // If no adenocarcinoma cores are found,
  // default the total cores to 14 for a standard biopsy,
  // or 12 if there are target cores.
  if (!foundAnyAdeno) {
    let defaultTotal = (target_count > 0) ? 12 : 14;
    return { posCores: 0, totalCores: defaultTotal };
  }

  // Otherwise, use the computed sum for positive cores.
  // (This logic can be adjusted as needed if a different total is desired.)
  return { posCores: sumPos, totalCores: 14 + target_count };
}

function calcNCCNRiskGroup(psaRange, gg, tStage, posCores, totalCores) {
  // 1) Convert grade group => approximate Gleason sum (if needed)
  const sumG = gradeGroupToGleasonSum(gg);
  
  // 2) parse T Stage => e.g. 3 if "T3a"
  const stageNum = parseTStageNumber(tStage);

  // The user might enter a numeric PSA as "psaRange" or pick "<10", "10-20", ">20".
  // We'll define custom_psa as a numeric if possible, else interpret the range
  let custom_psa = 0;   // default if not numeric
  if (typeof psaRange === "number") {
    custom_psa = psaRange;  
  } else {
    // fallback if user used the preselect
    if (psaRange === "<10") custom_psa = 5;   // approximate
    else if (psaRange === "10-20") custom_psa = 15;
    else if (psaRange === ">20") custom_psa = 25; // or a bigger guess
  }

  // Booleans for Very High factors:
  // A) T3b or T4
  const isT3bOrT4 = /^T3a/i.test(tStage) || /^T3b/i.test(tStage) || /^T4/i.test(tStage);
  // B) GG >=4 => means GG=4 or 5
  const isGG4or5 = (gg >= 4);
  // C) PSA>=40
  const isPSAover40 = (custom_psa >= 40);

  // count how many are true => if >=2 => Very High
  let countVH = 0;
  if (isT3bOrT4)   countVH++;
  if (isGG4or5)    countVH++;
  if (isPSAover40) countVH++;

  if (countVH >= 2) {
    return "Very High";
  }

  // Now let's define High risk => any one of (T3b/T4, GG>=4, PSA>20) 
  // but not meeting the 2-factor threshold for Very High
  // isPSAover20 => either user typed custom_psa>=20 or user picked >20
  let isPSAover20 = false;
  if (custom_psa >= 20) {
    isPSAover20 = true;
  } else if (psaRange === ">20") {
    isPSAover20 = true;
  }

  if (isT3bOrT4 || isGG4or5 || isPSAover20) {
    return "High";
  }

  // If not Very High or High, fall back to your original logic for Low/Intermediate
  const isPSAunder10 = (psaRange === "<10");
  const isPSA10to20 = (psaRange === "10-20");

  // Very Low if T1c + GG=1 + PSA<10
  if (stageNum <= 1 && gg === 1 && isPSAunder10 && /^T1c/i.test(tStage)) {
    return "Very Low";
  }
  // Low if T1-2a, GG=1, PSA<10
  if (stageNum <= 2 && gg === 1 && isPSAunder10) {
    return "Low";
  }

  // Now handle Intermediate
  let irfCount = 0;
  // IRF1 => PSA=10-20
  if (isPSA10to20) irfCount++;
  // IRF2 => Stage T2b or T2c
  if (/^T2b/i.test(tStage) || /^T2c/i.test(tStage)) irfCount++;
  // IRF3 => Grade Group 2 or 3
  if (gg === 2 || gg === 3) irfCount++;

  // check if >=50% cores positive => helps define unfavorable
  let ratio = 0;
  if (totalCores > 0) {
    ratio = posCores / totalCores;
  }
  const is50orMore = (ratio >= 0.5);

  // If no IRFs => "Low" (fallback?), else we decide favorable vs unfavorable
  if (irfCount === 0) {
    return "Low"; // or "N/A" etc.
  }

  // Favorable if only 1 IRF, GG=1 or 2, <50% cores
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
        
        cell.textContent = " ";
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
  overridePSA = false;
  overrideDRE = false;
  overrideCore = false;
  document.getElementById("psaSelect").value = "Auto";
  document.getElementById("psaManualInput").value  = "";
  document.getElementById("psaManualInput").disabled = true;
  document.getElementById("numBx").value = "Auto";
  document.getElementById("stageSelect").value = "Auto"

  document.getElementById("nccn-output").style.display="none";
  document.getElementById("comparisonTableWrapper").style.display = "none";
  document.getElementById("calcnomodiv").style.display = "none"

  const thead = document.querySelector("#comparisonTable thead");
  const tbody = document.querySelector("#comparisonTable tbody");
  if (thead) thead.innerHTML = "";
  if (tbody) tbody.innerHTML = "";

  document.getElementById("dobSpan").textContent = "N/A";
  document.getElementById("nccnRiskResult").textContent = "N/A";
  document.getElementById("riskDetails").textContent = "(PSA=?, Gleason=?, Stage=?)";

  const nomoDiv = document.getElementById("nomogramDiv");
  if (nomoDiv) nomoDiv.style.display = "none";

  document.getElementById("ageInput").value = "";
  document.getElementById("psaInput").value = "";
  document.getElementById("gggSelect").value = "1";
  document.getElementById("stageSelect_nomogram").value = "T1";
  document.getElementById("posCoresInput").value = "";
  document.getElementById("negCoresInput").value = "";
  document.getElementById("hormoneTherapy").value = "No";
  document.getElementById("radiationTherapy").value = "No";

  document.getElementById("warnings").textContent = "";
  document.getElementById("results").innerHTML = "";

  hideCoresPopup();
});