
/********************************************************************
 * 1) LOGISTIC MODELS
 ********************************************************************/
const COEFF_OCD = {
  intercept: 4.04759847,
  age:       -0.02874416,
  psa:       -0.25142694,
  psaSpline1:  0.00170562,
  psaSpline2: -0.0047362,
  ggg2: -0.66507525,
  ggg3: -1.24440478,
  ggg4: -1.24556939,
  ggg5: -2.29909232,
  stageT2a: -0.24874093,
  stageT2b: -0.77330003,
  stageT2c: -0.57018419,
  stageT3:  -1.47216113,
  posCores: -0.08590313,
  negCores:  0.06308424
};

const COEFF_ECE = {
  intercept:  -4.12316412,
  age:         0.03002483,
  psa:         0.24631397,
  psaSpline1: -0.00173719,
  psaSpline2:  0.00483196,
  ggg2:  0.63224646,
  ggg3:  1.12707867,
  ggg4:  1.16261692,
  ggg5:  2.14168233,
  stageT2a: 0.23208997,
  stageT2b: 0.78324104,
  stageT2c: 0.61674852,
  stageT3:  1.4802089,
  posCores: 0.08822019,
  negCores: -0.06245231
};

const COEFF_LN = {
  intercept:  -5.55716924,
  age:         0.01383913,
  psa:         0.19989322,
  psaSpline1: -0.00137288,
  psaSpline2:  0.00379338,
  ggg2:  0.96607022,
  ggg3:  1.98186216,
  ggg4:  2.13543564,
  ggg5:  2.74999239,
  stageT2a: 0.20425873,
  stageT2b: 0.56977406,
  stageT2c: 0.5132864,
  stageT3:  0.92021757,
  posCores: 0.06832617,
  negCores: -0.08827788
};

const COEFF_SVI = {
  intercept:  -6.34416925,
  age:         0.02294635,
  psa:         0.27708214,
  psaSpline1: -0.0022032,
  psaSpline2:  0.00615729,
  ggg2:  1.01060597,
  ggg3:  1.85561279,
  ggg4:  1.99375384,
  ggg5:  2.95409228,
  stageT2a: 0.13413385,
  stageT2b: 0.40933437,
  stageT2c: 0.76647585,
  stageT3:  0.80547871,
  posCores: 0.07534199,
  negCores: -0.12050282
};

/********************************************************************
 * 2) SURVIVAL MODELS
 ********************************************************************/
const COEFF_BCR_CORES = {
  intercept:  6.59468768,
  age:       -0.00527992,
  psa:       -0.4707596,
  psaSpline1:  0.00407629,
  psaSpline2: -0.01141213,
  ggg2: -1.0072232,
  ggg3: -2.02462439,
  ggg4: -2.49980646,
  ggg5: -2.80520499,
  stageT2a: -0.3285729,
  stageT2b: -0.65148102,
  stageT2c: -0.61816331,
  stageT3:  -0.93665289,
  posCores: -0.05378144,
  negCores:  0.03456631,
  gamma:     1.06458144
};

const COEFF_PCD_CORES = {
  intercept: 2.49813214,
  bcrCoef:   2.24491531,
  gamma:     0.40929215
};

/********************************************************************
 * 3) RESTRICTED CUBIC SPLINE for PSA
 ********************************************************************/
const PSA_KNOTS = { k1: 0.2, k2: 4.8, k3: 7.33, k4: 307 };

function rcsTerm(x, knot) {
  return Math.max(x - knot, 0) ** 3;
}
function psaSpline(PSA) {
  const {k1, k2, k3, k4} = PSA_KNOTS;
  const sp1 = 
    rcsTerm(PSA, k1) 
    - rcsTerm(PSA, k3)*(k4-k1)/(k4-k3)
    + rcsTerm(PSA, k4)*(k3-k1)/(k4-k3);
  const sp2 = 
    rcsTerm(PSA, k2) 
    - rcsTerm(PSA, k3)*(k4-k2)/(k4-k3)
    + rcsTerm(PSA, k4)*(k3-k2)/(k4-k3);
  return { sp1, sp2 };
}

/********************************************************************
 * 4) LOGISTIC MODEL HELPER
 ********************************************************************/
function logisticProbability(xb) {
  const eXb = Math.exp(xb);
  return eXb / (1 + eXb);
}

function calcLogisticModel(coeff, inputs) {
  const { sp1, sp2 } = psaSpline(inputs.psa);

  let xb = coeff.intercept;
  xb += (coeff.age       ?? 0) * inputs.age;
  xb += (coeff.psa       ?? 0) * inputs.psa;
  xb += (coeff.psaSpline1 ?? 0) * sp1;
  xb += (coeff.psaSpline2 ?? 0) * sp2;

  if (inputs.ggg === 2) xb += (coeff.ggg2 ?? 0);
  if (inputs.ggg === 3) xb += (coeff.ggg3 ?? 0);
  if (inputs.ggg === 4) xb += (coeff.ggg4 ?? 0);
  if (inputs.ggg === 5) xb += (coeff.ggg5 ?? 0);

  if (inputs.stage === 'T2a') xb += (coeff.stageT2a ?? 0);
  if (inputs.stage === 'T2b') xb += (coeff.stageT2b ?? 0);
  if (inputs.stage === 'T2c') xb += (coeff.stageT2c ?? 0);
  if (inputs.stage === 'T3')  xb += (coeff.stageT3  ?? 0);

  xb += (coeff.posCores ?? 0) * inputs.posCores;
  xb += (coeff.negCores ?? 0) * inputs.negCores;

  return logisticProbability(xb);
}

/********************************************************************
 * 5) SURVIVAL MODEL HELPER
 ********************************************************************/
function calcSurvivalProbability(coeff, inputs, timeYears) {
  const { sp1, sp2 } = psaSpline(inputs.psa);

  let xb = coeff.intercept;
  xb += (coeff.age ?? 0) * inputs.age;
  xb += (coeff.psa ?? 0) * inputs.psa;
  xb += (coeff.psaSpline1 ?? 0) * sp1;
  xb += (coeff.psaSpline2 ?? 0) * sp2;

  if (inputs.ggg === 2) xb += (coeff.ggg2 ?? 0);
  if (inputs.ggg === 3) xb += (coeff.ggg3 ?? 0);
  if (inputs.ggg === 4) xb += (coeff.ggg4 ?? 0);
  if (inputs.ggg === 5) xb += (coeff.ggg5 ?? 0);

  if (inputs.stage === 'T2a') xb += (coeff.stageT2a ?? 0);
  if (inputs.stage === 'T2b') xb += (coeff.stageT2b ?? 0);
  if (inputs.stage === 'T2c') xb += (coeff.stageT2c ?? 0);
  if (inputs.stage === 'T3')  xb += (coeff.stageT3  ?? 0);

  xb += (coeff.posCores ?? 0) * inputs.posCores;
  xb += (coeff.negCores ?? 0) * inputs.negCores;

  const gamma = coeff.gamma;
  const eNegXb = Math.exp(-xb);
  const denominator = 1 + Math.pow(eNegXb * timeYears, 1 / gamma);
  return 1 / denominator;
}

function calcPCDeathProbability(coeffPCD, bcrFree5, timeYears) {
  const xb = coeffPCD.intercept + coeffPCD.bcrCoef * bcrFree5;
  const gamma = coeffPCD.gamma;
  const eNegXb = Math.exp(-xb);
  const denominator = 1 + Math.pow(eNegXb * timeYears, 1 / gamma);
  return 1 / denominator; 
}

/********************************************************************
 * MAIN: “Calculate All”
 ********************************************************************/
document.getElementById('calculateBtn').addEventListener('click', () => {
  runCalculation();
});

function runCalculation() {
  const warnings = document.getElementById('warnings');
  warnings.textContent = '';

  const hormone = document.getElementById('hormoneTherapy').value;
  const radiation = document.getElementById('radiationTherapy').value;
  if (hormone === 'Yes' || radiation === 'Yes') {
    warnings.textContent = 
      'Model disclaimers: Not valid if patient is on hormone or radiation therapy.';
  }

  const ageVal = parseFloat(document.getElementById('ageInput').value) || 65;
  const psaVal = parseFloat(document.getElementById('psaInput').value) || 5;
  const gggVal = parseInt(document.getElementById('gggSelect').value, 10);
  const stageVal = document.getElementById('stageSelect_nomogram').value;
  const posCoresVal = parseInt(document.getElementById('posCoresInput').value, 10) || 0;
  const negCoresVal = parseInt(document.getElementById('negCoresInput').value, 10) || 0;

  const inputData = {
    age: ageVal,
    psa: psaVal,
    ggg: gggVal,
    stage: stageVal,
    posCores: posCoresVal,
    negCores: negCoresVal
  };

  // logistic endpoints
  const probOCD = calcLogisticModel(COEFF_OCD, inputData);
  const probECE = calcLogisticModel(COEFF_ECE, inputData);
  const probLN  = calcLogisticModel(COEFF_LN,  inputData);
  const probSVI = calcLogisticModel(COEFF_SVI, inputData);

  // survival endpoints
  const probBCR5  = calcSurvivalProbability(COEFF_BCR_CORES, inputData, 5);
  const probBCR10 = calcSurvivalProbability(COEFF_BCR_CORES, inputData, 10);

  // 15-year PC-specific survival
  const pcDeathFree15 = calcPCDeathProbability(COEFF_PCD_CORES, probBCR5, 15);

  const resultsDiv = document.getElementById('results');
  resultsDiv.innerHTML = `
    <p><strong>PC-Specific Survival @ 15 years:</strong> ${(pcDeathFree15*100).toFixed(1)}%</p>
     <p><strong>Progression-Free Survival @ 10 years:</strong> ${(probBCR10*100).toFixed(1)}%</p>
     <p><strong>Progression-Free Survival @ 5 years:</strong> ${(probBCR5*100).toFixed(1)}%</p>
    <p><strong>Organ Confined Disease Prob:</strong> ${(probOCD*100).toFixed(1)}%</p>
    <p><strong>Extracapsular Extension Prob:</strong> ${(probECE*100).toFixed(1)}%</p>
    <p><strong>Lymph Node Involvement Prob:</strong> ${(probLN*100).toFixed(1)}%</p>
    <p><strong>Seminal Vesicle Invasion Prob:</strong> ${(probSVI*100).toFixed(1)}%</p>

  `;
}


function setNomogramData(obj) {
  // Populate fields directly in the main document:
  document.getElementById('ageInput').value = obj.age || 65;
  document.getElementById('psaInput').value = obj.psa || 5;
  document.getElementById('gggSelect').value = obj.ggg || 1;
  document.getElementById('stageSelect_nomogram').value = obj.stage || 'T1';
  document.getElementById('posCoresInput').value = obj.posCores || 0;
  document.getElementById('negCoresInput').value = obj.negCores || 0;
  document.getElementById('hormoneTherapy').value = obj.hormoneTherapy || 'No';

  // Then run your calculation:
  runCalculation();
}
