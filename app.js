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
  "Intermediate - Favorable": 3,
  "Intermediate - Unfavorable": 4,
  "High": 5,
  "Very High": 6
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

/*********************************************************************
 * Extract Grade Group Directly
 *********************************************************************/

/**
 * extractGradeGroup(text)
 *   Looks for: "GRADE GROUP X" where X is 1..5.
 *   Returns an integer 1..5 or 0 if not found.
 */
function extractGradeGroup(text) {
  const re = /grade\s+group\s+(\d+)/i;
  const m = text.match(re);
  if (!m) return 0;
  const gg = parseInt(m[1], 10);
  if (gg >= 1 && gg <= 5) return gg;
  return 0;
}

/**
 * gradeGroupToGleasonSum(gg)
 *   Needed for partial logic or display. 
 *   Example mapping:
 *     GG=1 => sum=6
 *     GG=2 => sum=7 (3+4)
 *     GG=3 => sum=7 (4+3)
 *     GG=4 => sum=8
 *     GG=5 => sum=9 (or 10)
 */
function gradeGroupToGleasonSum(gg) {
  switch (gg) {
    case 1: return 6;  
    case 2: return 7;  
    case 3: return 7;  
    case 4: return 8;  
    case 5: return 9;  
    default: return 6; // fallback
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

    // find highest Grade Group in these samples
    const maxGG = findMaxGradeGroup(samples);
    // convert that to a Gleason sum for partial logic
    const maxGleasonSum = gradeGroupToGleasonSum(maxGG);

    // compute total positive/negative cores for this entire chunk,
    // applying "fragmented" + "target lesion" logic
    const { posCores, totalCores } = computePositiveCoresFromSamples(samples);

    // compute simplified NCCN risk
    const riskGroup = calcNCCNRiskGroup(psaRange, maxGG, tStage, posCores, totalCores);

    allReports.push({
      date,
      samples,
      maxGradeGroup: maxGG,      // numeric 1..5 (or 0 if not found)
      maxGleasonSum,             // numeric 6..10 approx
      posCores,                  // total positive across Adeno samples
      totalCores,
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

  // get the chosen report
  const chosenReport = allReports[chosenIndex];
  const gg = chosenReport.maxGradeGroup || 1;  // fallback if 0
  const gleasonSum = gradeGroupToGleasonSum(gg);

  // use the pre-aggregated cores
  const posCores = chosenReport.posCores;
  const totalCores = chosenReport.totalCores;
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

  // Now send data to the nomogram
  if (typeof setNomogramData === "function") {
    setNomogramData({
      age: ageForNomogram,
      psa: numericPSA,
      ggg: gg,     // 1..5
      stage: stageForNomogram,
      posCores: posCores,
      negCores: negCores,
      hormoneTherapy: "No",
      radiationTherapy: "No"
    });
  } else {
    alert("setNomogramData not found.");
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
  console.log("dxLines: ", dxLines)
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
      // finalize the previous sample if it exists
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
      // If a line starts with "-", it's a diagnosis line
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

/*********************************************************************
 * parseLocation
 *   - Removes boilerplate prefix, handles "Target X" logic, etc.
 *********************************************************************/
function parseLocation(text, label) {
  let loc = text;

  // Clean up common prefixes
  loc = loc.replace(/^PROSTATE\s*NEEDLE\s*BX\s*-\s*/i, "");
  loc = loc.replace(/^PROSTATE,\s*NEEDLE\s*CORE\s*BIOPSY\s*-\s*/i, "");
  loc = loc.replace(/:\s*$/, "");
  if (loc.startsWith(label + " ")) {
    loc = loc.slice(label.length + 1);
  }
  loc = loc.trim();

  // Check if location includes "TARGET X"
  const targetMatch = loc.match(/\btarget\s+(\d+)\b/i);
  if (targetMatch) {
    const targetNum = targetMatch[1];
    // Remove "target 1" from the string
    loc = loc.replace(targetMatch[0], "").trim();

    // If there's anything left, we append
    if (loc) {
      return `Target ${targetNum} - ${loc}`;
    }
    return `Target ${targetNum}`;
  }

  // Otherwise return the raw loc
  return loc.trim();
}

/*********************************************************************
 * parseShortDiagnosis
 *   Priority: Adenocarcinoma → Prostatitis → Inflammation → Benign → ASAP → HGPIN → BPH → else "N/A"
 *********************************************************************/
function parseShortDiagnosis(txt) {
  const lower = txt.toLowerCase();

  // Prioritizing different types of prostate cancer
  if (lower.includes("acinar adenocarcinoma")) return "Acinar AdenoCA";
  if (lower.includes("ductal adenocarcinoma")) return "Ductal AdenoCA";
  if (lower.includes("transitional cell carcinoma")) return "Transitional Cell CA";
  if (lower.includes("squamous cell carcinoma")) return "Squamous Cell CA";
  if (lower.includes("small cell neuroendocrine carcinoma") || lower.includes("small cell carcinoma")) return "Small Cell CA";
  if (lower.includes("large cell neuroendocrine carcinoma") || lower.includes("large cell carcinoma")) return "Large Cell CA";

  // General adenocarcinoma detection
  if (lower.includes("adenocarcinoma")) return "AdenoCA";

  // Other conditions
  if (lower.includes("prostatitis"))   return "Prostatitis";
  if (lower.includes("inflammation"))  return "Inflammation";
  if (lower.includes("benign") || lower.includes("negative")) return "Benign";
  if (lower.includes("asap"))          return "ASAP";
  if (lower.includes("hgpin"))         return "HGPIN";
  if (lower.includes("bph"))           return "BPH";

  return "N/A";
}

/*********************************************************************
 * parseAncillaryFeatures(txt)
 *   Detect special features in the path report:
 *     - Perineural invasion (PNI)
 *     - Lymphovascular invasion (LVI)
 *     - Cribriform pattern
 *     - Intraductal carcinoma
 *********************************************************************/
function parseAncillaryFeatures(txt) {
  const lower = txt.toLowerCase();
  const features = [];

  // Simple checks - can be refined
  if (lower.includes("perineural")) {
    features.push("PNI");
  }
  if (lower.includes("lymphovascular")) {
    features.push("LVI");
  }
  if (lower.includes("cribriform")) {
    features.push("Cribriform");
  }
  if (lower.includes("intraductal")) {
    features.push("Intraductal");
  }

  // Return a comma-separated list or "None"
  return features.length ? features.join(", ") : "None";
}

/*********************************************************************
 * parsePatternDistribution(txt)
 *   Looks for "pattern 4 = X%", "pattern 5 = X%", or 
 *   "tertiary pattern 5 <5%", etc. 
 *********************************************************************/
function parsePatternDistribution(txt) {
  const lower = txt.toLowerCase();

  let pattern4 = null; 
  let pattern5 = null; 
  let tertiaryString = null; 

  let m = lower.match(/pattern\s*4\s*=\s*(<?\d+%)/);
  if (m) pattern4 = m[1];

  m = lower.match(/pattern\s*5\s*=\s*(<?\d+%)/);
  if (m) pattern5 = m[1];

  const tertRe = /tertiary\s*pattern\s*(\d+)\s+(\<?\d+%)/i;
  m = tertRe.exec(txt);
  if (m) {
    const tertNum = m[1];
    const tertPct = m[2];
    tertiaryString = `Tert${tertNum}=${tertPct}`;
  }

  const parts = [];
  if (pattern4) parts.push(`Pattern 4=${pattern4}`);
  if (pattern5) parts.push(`Pattern 5=${pattern5}`);
  if (tertiaryString) parts.push(`Tertiary ${tertiaryString}`);

  if (parts.length === 0) return null;
  return parts.join(", ");
}

/*********************************************************************
 * finalizeSample
 *********************************************************************/
function finalizeSample(s) {
  // Combine all location lines
  const rawLoc = s.locationLines.join(" ");
  const location = parseLocation(rawLoc, s.sampleLabel);

  let diagText = s.diagnosisLines.join(" ");
  diagText = diagText.replace(/\s+/g, " ").trim();

  const dxShort = parseShortDiagnosis(diagText);
  const ggg = extractGradeGroup(diagText);
  const cpos = extractCoresPositive(diagText);
  const size = extractMaxCoreSize(diagText);
  const specialFeatures = parseAncillaryFeatures(diagText);
  const patternDist = parsePatternDistribution(diagText);

  return {
    sampleLabel: s.sampleLabel,
    location,               // e.g. "Left Apex" or "Target 1 - Rt Apex"
    diagnosis: dxShort,     // e.g. "AdenoCA"
    gradeGroup: ggg,        // numeric 1..5 (0 if not found)
    coresPositive: cpos,    // e.g. "2/3(66%)"
    maxCoreSize: size,      // e.g. "9mm"
    ancillaryFeatures: specialFeatures,
    patternDist
  };
}

/**
 * extractCoresPositive => "2/3(66%)" or "N/A"
 */
function extractCoresPositive(text) {
  let m = text.match(/involving\s*(\d+)\s*of\s*(\d+)\s*(?:partially\s+fragmented|fragmented)?\s*cores/i);
  if (m) return formatCores(m[1], m[2]);

  m = text.match(/involving\s*(\d+)\/(\d+)\s*(?:partially\s+fragmented|fragmented)?\s*cores/i);
  if (m) return formatCores(m[1], m[2]);

  m = text.match(/(\d+)\s*of\s*(\d+)\s*(?:partially\s+fragmented|fragmented)?\s*cores/i);
  if (m) return formatCores(m[1], m[2]);

  m = text.match(/(\d+)\/(\d+)\s*(?:partially\s+fragmented|fragmented)?\s*cores/i);
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
 * findMaxGradeGroup
 *********************************************************************/
function findMaxGradeGroup(samples) {
  let maxGG = 0;
  samples.forEach(s => {
    if (s.gradeGroup && s.gradeGroup > maxGG) {
      maxGG = s.gradeGroup;
    }
  });
  return maxGG; // 1..5 or 0 if none found
}

/*********************************************************************
 * computePositiveCoresFromSamples(reportSamples)
 *   1) Identify site: apex (3 cores), mid (2), base (2).
 *   2) If "target" => max=1 core if AdenoCA present
 *   3) If path reports > max => clamp it
 *   4) Sum across all AdenoCA samples => total pos
 *
 *   Returns { posCores, totalCores }, fallback total=14 if none found.
 *********************************************************************/
function computePositiveCoresFromSamples(reportSamples) {
  let sumPos = 0;
  let sumTotal = 14; // default total if at least one sample is AdenoCA
  let foundAnyAdeno = false;

  reportSamples.forEach(s => {
    // We only count cores if diagnosis includes "adeno"
    if (!s.diagnosis.toLowerCase().includes("adeno")) {
      return;
    }

    // We found at least one Adeno sample
    foundAnyAdeno = true;

    // parse "X/Y" from s.coresPositive => e.g. "2/3(66%)"
    if (!s.coresPositive || s.coresPositive === "N/A") {
      return;
    }

    const match = s.coresPositive.match(/^(\d+)\/(\d+)/);
    if (!match) {
      return;
    }

    let x = parseInt(match[1], 10); // reported positive
    let y = parseInt(match[2], 10); // reported total

    // Now clamp "y" to the max possible for that site
    // For target lesions: if any positive, =1/1
    // Otherwise apex=3, mid=2, base=2
    const locLower = s.location.toLowerCase();

    // helper function
    function getMaxCoresForLocation(loc) {
      if (loc.includes("target")) {
        // If there's ANY positivity => treat it as 1 positive out of 1
        // If no positivity => 0/1
        return 1;
      } else if (loc.includes("apex")) {
        return 3;
      } else if (loc.includes("mid")) {
        return 2;
      } else if (loc.includes("base")) {
        return 2;
      }
      // fallback if location is uncertain => 2
      return 2;
    }

    const maxSite = getMaxCoresForLocation(locLower);

    if (locLower.includes("target")) {
      // if x>0 => clamp x=1, y=1
      if (x > 0) {
        x = 1;
        y = 1;
      } else {
        // if x=0 => 0/1
        x = 0;
        y = 1;
      }
    } else {
      // clamp if reported y>maxSite
      if (y > maxSite) {
        y = maxSite;
      }
      // clamp x to new y
      if (x > y) {
        x = y;
      }
    }

    // add x to sumPos
    sumPos += x;
  });

  if (!foundAnyAdeno) {
    // no AdenoCA => fallback => {0,14}
    return { posCores: 0, totalCores: 14 };
  }

  // sumPos is how many positive
  // keep total=14 for the entire set (NCCN standard), 
  // but if you want you can set sum of site maxima. 
  return { posCores: sumPos, totalCores: 14 };
}

/*********************************************************************
 * calcNCCNRiskGroup => includes Intermediate Fav vs. Unfav logic
 *********************************************************************/
function calcNCCNRiskGroup(psaRange, gg, tStage, posCores, totalCores) {
  // Quick booleans
  const sumG = gradeGroupToGleasonSum(gg);
  const stageNum = parseTStageNumber(tStage);
  const isPSAunder10 = (psaRange === "<10");
  const isPSA10to20 = (psaRange === "10-20");
  const isPSAover20 = (psaRange === ">20");

  // Very High if T3b or T4
  if (/^T3b/i.test(tStage) || /^T4/i.test(tStage)) {
    return "Very High";
  }

  // High if (GG>=4) OR (stage>=3) OR (PSA>20) [excluding Very High above]
  if (gg >= 4 || stageNum >= 3 || isPSAover20) {
    return "High";
  }

  // Low if stage <=2 AND GG=1 AND PSA<10
  // Very Low if T1c, GG=1, PSA<10 => override "Low"
  if (stageNum <= 2 && gg === 1 && isPSAunder10) {
    if (/^T1c/i.test(tStage)) {
      return "Very Low";
    }
    return "Low";
  }

  // Otherwise => Intermediate
  let irfCount = 0;
  // IRF1: PSA=10-20
  if (isPSA10to20) irfCount++;
  // IRF2: Stage cT2b-cT2c
  if (/^T2b/i.test(tStage) || /^T2c/i.test(tStage)) {
    irfCount++;
  }
  // IRF3: Grade Group 2 or 3
  if (gg === 2 || gg === 3) {
    irfCount++;
  }

  // Determine if >=50% of cores positive
  let ratio = 0;
  if (totalCores > 0) {
    ratio = posCores / totalCores;
  }
  const is50orMore = (ratio >= 0.5);

  // Favorable vs. Unfavorable logic
  // - 1 IRF, GG=1/2, <50% cores => "Intermediate - Favorable"
  // - else => "Intermediate - Unfavorable"

  if (irfCount === 0) {
    // If no IRFs => fallback to "Low" if not otherwise caught
    return "Low";
  }

  const meetsFavorable =
    irfCount === 1 &&
    (gg === 1 || gg === 2) &&
    !is50orMore;

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
 *
 *   Example final display in each cell:
 *     AdenoCA(Pattern 4=10%), GG=2, Cores=2/3(66%), Maximum Core Length w Cancer=9mm, PNI
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

  allReports.forEach((r, i) => {
    const th = document.createElement("th");

    // Add a radio button
    const radio = document.createElement("input");
    radio.type = "radio";
    radio.name = "nomogramSelect";
    radio.className = "nomogram-radio";
    radio.value = i.toString();
    if (i === 0) {
      // default to the newest if you want
      radio.defaultChecked = true;
    }

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

    // for each report => single text cell with custom summary
    allReports.forEach(r => {
      const sampleObj = r.samples.find(s => s.sampleLabel === label);
      const cell = document.createElement("td");
      if (!sampleObj) {
        cell.textContent = "N/A";
      } else {
        let combined = "";

        // 1) Start with diagnosis, plus patternDist
        if (sampleObj.diagnosis && sampleObj.diagnosis !== "N/A") {
          combined += sampleObj.diagnosis;
          if (sampleObj.patternDist) {
            combined += `(${sampleObj.patternDist})`;
          }
        }

        // 2) Grade Group
        if (sampleObj.gradeGroup) {
          combined += (combined ? ", GG=" : "GG=") + sampleObj.gradeGroup;
        }

        // 3) Cores
        if (sampleObj.coresPositive && sampleObj.coresPositive !== "N/A") {
          combined += (combined ? ", Cores=" : "Cores=") + sampleObj.coresPositive;
        }

        // 4) Maximum Core Length w Cancer
        if (sampleObj.maxCoreSize && sampleObj.maxCoreSize !== "N/A") {
          combined += (combined ? ", Maximum Core Length w Cancer=" : "Maximum Core Length w Cancer=") 
                  + sampleObj.maxCoreSize;
        }

        // 5) Ancillary Features
        if (sampleObj.ancillaryFeatures && sampleObj.ancillaryFeatures !== "None") {
          combined += (combined ? ", " : "") + sampleObj.ancillaryFeatures;
        }

        if (!combined) combined = "N/A";
        cell.textContent = combined;
      }
      tr.appendChild(cell);
    });

    tbody.appendChild(tr);
  });
}

/**************************************************************
 * "Clear" Button => reset text area & UI
 **************************************************************/
document.getElementById("clearBtn").addEventListener("click", () => {
  // 1) Clear the text area
  document.getElementById("reportText").value = "";

  // 2) Reset global variables
  allReports = [];
  patientDob = null;

  // 3) Clear any table or UI data
  const thead = document.querySelector("#comparisonTable thead");
  const tbody = document.querySelector("#comparisonTable tbody");
  if (thead) thead.innerHTML = "";
  if (tbody) tbody.innerHTML = "";

  // 4) Reset DOB & risk
  document.getElementById("dobSpan").textContent = "N/A";
  document.getElementById("nccnRiskResult").textContent = "N/A";
  document.getElementById("riskDetails").textContent = "(PSA=?, Gleason=?, Stage=?)";

  // 5) Optionally hide the nomogram section again
  const nomoDiv = document.getElementById("nomogramSection");
  if (nomoDiv) {
    nomoDiv.style.display = "none";
  }

  // 6) If you want to reset the nomogram fields too
  document.getElementById("ageInput").value = "";
  document.getElementById("psaInput").value = "";
  document.getElementById("gggSelect").value = "1";
  document.getElementById("stageSelectNom").value = "T1";
  document.getElementById("posCoresInput").value = "";
  document.getElementById("negCoresInput").value = "";
  document.getElementById("hormoneTherapy").value = "No";
  document.getElementById("radiationTherapy").value = "No";

  // 7) Clear the results area
  document.getElementById("warnings").textContent = "";
  document.getElementById("results").innerHTML = "";
});