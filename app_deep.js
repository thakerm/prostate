// app.js
document.getElementById('process-btn').addEventListener('click', processReports);
document.getElementById('run-nomogram-btn').addEventListener('click', runNomogram);

function processReports() {
  const reportText = document.getElementById('report-input').value;
  const reports = reportText.split('Provider:'); // Split multiple reports

  const summaryTable = document.getElementById('summary-table').getElementsByTagName('tbody')[0];
  summaryTable.innerHTML = ''; // Clear previous data

  reports.forEach(report => {
    if (report.trim() === '') return; // Skip empty reports
    const data = extractDataFromReport(report);
    if (data) {
      data.forEach(entry => {
        const row = summaryTable.insertRow();
        Object.values(entry).forEach(value => {
          const cell = row.insertCell();
          cell.textContent = value;
        });
      });
    }
  });
}

function extractDataFromReport(report) {
  const entries = [];
  const sampleRegex = /([A-Z]\)? PROSTATE(?: NEEDLE BX)? - ([A-Z\s]+)):(.*?)(?=\n[A-Z]\)|$)/gs;
  let match;

  while ((match = sampleRegex.exec(report)) !== null) {
    const sample = match[1].trim();
    const location = match[2].trim();
    const details = match[3].trim();

    // Extract diagnosis, cores positive, and max length core
    const diagnosisMatch = details.match(/PROSTATIC ADENOCARCINOMA, GLEASON SCORE (\d+ \+ \d+ = \d+)/);
    const coresMatch = details.match(/INVOLVING (\d+) OF (\d+) CORES/);
    const maxLengthMatch = details.match(/TUMOR MEASURES (\d+) MM/);

    if (diagnosisMatch && coresMatch && maxLengthMatch) {
      const diagnosis = `Gleason ${diagnosisMatch[1]}`;
      const coresPositive = `${coresMatch[1]}/${coresMatch[2]}`;
      const maxLengthCore = maxLengthMatch[1];
      const nccnRiskGroup = calculateNCCNRiskGroup(diagnosis, coresMatch[1], coresMatch[2]);

      entries.push({
        sample: sample,
        location: location,
        pathSummary: diagnosis,
        coresPositive: coresPositive,
        maxLengthCore: `${maxLengthCore} mm`,
        nccnRiskGroup: nccnRiskGroup
      });
    }
  }

  return entries;
}

function calculateNCCNRiskGroup(diagnosis, coresPositive, totalCores) {
  const percentPositive = (coresPositive / totalCores) * 100;
  if (diagnosis.includes('Gleason 3 + 3')) {
    return percentPositive < 50 ? 'Low' : 'Intermediate Fav';
  } else if (diagnosis.includes('Gleason 3 + 4')) {
    return 'Intermediate Fav';
  } else if (diagnosis.includes('Gleason 4 + 3')) {
    return 'Intermediate Unfav';
  } else if (diagnosis.includes('Gleason 4 + 4') || diagnosis.includes('Gleason 5')) {
    return 'High';
  } else {
    return 'Unknown';
  }
}

function runNomogram() {
  const psa = parseFloat(document.getElementById('psa-input').value);
  const clinicalStage = document.getElementById('clinical-stage').value;

  // Example: Calculate nomogram result (replace with actual MSK nomogram logic)
  const nomogramResult = `Nomogram result for PSA ${psa} and stage ${clinicalStage}: TBD`;
  document.getElementById('nomogram-result').textContent = nomogramResult;
}