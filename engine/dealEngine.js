// TMC Deal Club calculation engine.
// Implements the approved "Deal Stress Test Formula Specification" (2026-10-18).
// Pure functions only: no DOM, no network, no storage. Rates and percentages are decimals (7% = 0.07).

export const EPS = 1e-9;

export const DEFAULT_INPUTS = Object.freeze({
  otherIncomeMonthly: 0,
  vacancy: 0.08,
  closingPct: 0.03,
  initialRepairs: 0,
  expenseMode: 'lineItems', // 'lineItems' | 'ratio'
  taxMode: 'amount', // 'amount' | 'rate'
  utilities: 0,
  managementPct: 0.08,
  otherOpex: 0,
  opexRatio: 0.45,
  reservesPerUnit: 300,
  ltv: 0.75,
  rate: 0.07,
  amortYears: 30,
  interestOnly: false,
});

// TMC illustrative screens, not recommendations. Members can change or switch them off (null).
export const DEFAULT_SCREENS = Object.freeze({
  minDscr: 1.30,
  minCfPerUnitMonthly: 175,
  maxLtv: 0.75,
  opexBand: [0.40, 0.50], // warning only
  minCashOnCash: null, // off by default
});

export const DEFAULT_DOWNSIDE = Object.freeze({
  vacancyAddPts: 0.05,
  insuranceMult: 1.25,
  repairsMult: 1.25,
  taxesMultIfNoRate: 1.15,
  rateAddPts: 0.015,
  opexRatio: 0.50, // ratio mode only
});

export const SOURCE_LABELS = ['verified', 'seller', 'projection', 'assumption'];

// ---------- input parsing ----------

// Accepts "1,250", "$1,250", "7%", " 7 ". Returns a number or NaN. A percentage field
// passes percent: true, so "7" or "7%" becomes 0.07.
export function parseNumberInput(raw, { percent = false } = {}) {
  if (typeof raw === 'number') return percent ? raw / 100 : raw;
  if (raw === null || raw === undefined) return NaN;
  const cleaned = String(raw).replace(/[$,%\s]/g, '');
  if (cleaned === '' || !/^-?\d*\.?\d+$/.test(cleaned)) return NaN;
  const n = Number(cleaned);
  return percent ? n / 100 : n;
}

// ---------- validation ----------

const RANGES = {
  units: { min: 2, max: 20, integer: true, message: 'Deal Club covers properties with 2 to 20 units' },
  monthlyRent: { minExclusive: 0 },
  otherIncomeMonthly: { min: 0 },
  vacancy: { min: 0, max: 0.5, message: 'Vacancy must be between 0% and 50%' },
  price: { minExclusive: 0, max: 100_000_000 },
  closingPct: { min: 0, max: 0.10, message: 'Closing costs must be between 0% and 10%' },
  initialRepairs: { min: 0 },
  taxes: { min: 0 },
  taxRate: { min: 0, max: 0.10, message: 'Tax rate must be between 0% and 10%' },
  insurance: { min: 0 },
  utilities: { min: 0 },
  repairs: { min: 0 },
  managementPct: { min: 0, max: 0.20, message: 'Management must be between 0% and 20%' },
  otherOpex: { min: 0 },
  opexRatio: { min: 0.20, max: 0.80, message: 'Expense ratio must be between 20% and 80%' },
  reservesPerUnit: { min: 0 },
  ltv: { min: 0, max: 0.95, message: 'Loan-to-value must be between 0% and 95%' },
  rate: { min: 0, max: 0.20, message: 'Interest rate must be between 0% and 20%' },
  amortYears: { min: 1, max: 40, message: 'Amortization must be between 1 and 40 years' },
};

function requiredFields(inp) {
  const f = ['units', 'monthlyRent', 'otherIncomeMonthly', 'vacancy', 'price', 'closingPct',
    'initialRepairs', 'reservesPerUnit', 'ltv', 'rate', 'amortYears'];
  if (inp.expenseMode === 'ratio') f.push('opexRatio');
  else {
    f.push('insurance', 'utilities', 'repairs', 'managementPct', 'otherOpex');
    f.push(inp.taxMode === 'rate' ? 'taxRate' : 'taxes');
  }
  if (inp.taxRate !== undefined && inp.taxRate !== null && !f.includes('taxRate')) f.push('taxRate');
  return f;
}

function checkField(name, v) {
  const r = RANGES[name];
  if (typeof v !== 'number' || !Number.isFinite(v)) return 'Enter a number';
  if (!r) return null;
  const outOfRange = (r.integer && !Number.isInteger(v))
    || (r.min !== undefined && v < r.min)
    || (r.max !== undefined && v > r.max)
    || (r.minExclusive !== undefined && v <= r.minExclusive);
  if (!outOfRange) return null;
  if (r.message) return r.message;
  if (r.minExclusive !== undefined && v <= r.minExclusive) return 'Must be greater than 0';
  if (r.max !== undefined && v > r.max) return `Must be at most ${r.max.toLocaleString('en-US')}`;
  return 'Must be 0 or more';
}

export function withDefaults(inputs) {
  return { ...DEFAULT_INPUTS, ...inputs };
}

export function validate(rawInputs) {
  const inp = withDefaults(rawInputs);
  const errors = {};
  for (const name of requiredFields(inp)) {
    const msg = checkField(name, inp[name]);
    if (msg) errors[name] = msg;
  }
  if (!['lineItems', 'ratio'].includes(inp.expenseMode)) errors.expenseMode = 'Choose line items or quick ratio';
  if (!['amount', 'rate'].includes(inp.taxMode)) errors.taxMode = 'Choose a tax amount or a tax rate';
  return errors;
}

// Warnings never block results; they appear beside the field and on the results it affects.
export function fieldWarnings(rawInputs, screens = DEFAULT_SCREENS, sources = {}) {
  const inp = withDefaults(rawInputs);
  const w = {};
  const per = v => v / inp.units;
  const rentPerUnit = per(inp.monthlyRent);
  if (rentPerUnit < 300 || rentPerUnit > 10_000) w.monthlyRent = 'Average rent per unit looks unusual; check the rent roll';
  if (inp.otherIncomeMonthly > 0.10 * inp.monthlyRent) w.otherIncomeMonthly = 'Other income is above 10% of rent; verify it';
  if (inp.vacancy < 0.05) w.vacancy = "Below 5%; TMC usually assumes 8 to 10%";
  const pricePerUnit = per(inp.price);
  if (pricePerUnit < 10_000 || pricePerUnit > 1_000_000) w.price = 'Price per unit looks unusual; check the price';
  if (inp.closingPct < 0.01) w.closingPct = 'Closing costs below 1% are rare';
  if (inp.expenseMode === 'ratio') {
    w.expenseMode = 'Quick ratio gives rougher results than line items';
    if (inp.opexRatio < 0.40 || inp.opexRatio > 0.50) w.opexRatio = 'Outside the 40 to 50% stress range';
  } else {
    if (sources.taxes === 'seller') w.taxes = "The seller's tax bill may reset after the sale";
    if (per(inp.insurance) < 300) w.insurance = 'Below $300 per unit; get a quote';
    if (per(inp.repairs) < 500) w.repairs = 'Below $500 per unit; older buildings usually need more';
    if (inp.managementPct === 0) w.managementPct = 'Self-managing still costs time; consider 8%';
  }
  if (inp.reservesPerUnit < 250) w.reservesPerUnit = 'Below $250 per unit per year';
  if (screens.maxLtv !== null && screens.maxLtv !== undefined && inp.ltv > screens.maxLtv + EPS) w.ltv = 'Above your LTV screen';
  if (inp.interestOnly) w.interestOnly = 'Interest-only payments do not pay down the loan';
  return w;
}

// ---------- calculations ----------

export function monthlyPayment(loan, annualRate, years, interestOnly = false) {
  if (loan === 0) return 0;
  const r = annualRate / 12;
  if (interestOnly) return loan * r;
  const n = years * 12;
  if (r === 0) return loan / n;
  return loan * r / (1 - Math.pow(1 + r, -n));
}

function annuityFactor(annualRate, years) {
  const r = annualRate / 12;
  const n = years * 12;
  return r === 0 ? n : (1 - Math.pow(1 + r, -n)) / r;
}

function taxesFor(inp) {
  return inp.taxMode === 'rate' ? inp.taxRate * inp.price : inp.taxes;
}

// Which inputs each output depends on. Used for source-label propagation and for
// "needs input" when a dependency is invalid.
function dependencies(inp) {
  const income = ['monthlyRent', 'vacancy', 'otherIncomeMonthly'];
  const opex = inp.expenseMode === 'ratio'
    ? [...income, 'opexRatio']
    : [...income, inp.taxMode === 'rate' ? 'taxRate' : 'taxes', ...(inp.taxMode === 'rate' ? ['price'] : []),
      'insurance', 'utilities', 'repairs', 'managementPct', 'otherOpex'];
  const loan = ['ltv', 'price'];
  const debt = [...loan, 'rate', 'amortYears', 'interestOnly'];
  const reserves = ['reservesPerUnit', 'units'];
  const noi = [...new Set([...income, ...opex])];
  const cf = [...new Set([...noi, ...debt, ...reserves])];
  return {
    gpr: ['monthlyRent'],
    egi: income,
    opex: [...new Set(opex)],
    noi,
    opexRatio: noi,
    capRate: [...noi, 'price'],
    loan,
    payment: debt,
    annualDebtService: debt,
    dscr: [...new Set([...noi, ...debt])],
    reserves,
    cashFlow: cf,
    cfPerUnitMonthly: cf,
    cashInvested: ['price', 'ltv', 'closingPct', 'initialRepairs'],
    cashOnCash: [...new Set([...cf, 'closingPct', 'initialRepairs'])],
    breakEvenOccupancy: cf,
    maxLoanByDscr: [...new Set([...noi, 'rate', 'amortYears', 'interestOnly'])],
    maxLoan: [...new Set([...noi, 'rate', 'amortYears', 'interestOnly', 'price'])],
  };
}

// Core math on already-valid inputs. Values are unrounded.
export function compute(inp, screens = DEFAULT_SCREENS) {
  const gpr = inp.monthlyRent * 12;
  const vacancyLoss = gpr * inp.vacancy;
  const otherIncome = inp.otherIncomeMonthly * 12;
  const egi = gpr - vacancyLoss + otherIncome;

  let management = null;
  let taxes = null;
  let opex;
  if (inp.expenseMode === 'ratio') {
    opex = inp.opexRatio * egi;
  } else {
    taxes = taxesFor(inp);
    management = inp.managementPct * egi;
    opex = taxes + inp.insurance + inp.utilities + inp.repairs + management + inp.otherOpex;
  }

  const noi = egi - opex;
  const opexRatio = egi !== 0 ? opex / egi : null;
  const capRate = noi / inp.price;

  const loan = inp.ltv * inp.price;
  const payment = monthlyPayment(loan, inp.rate, inp.amortYears, inp.interestOnly);
  const annualDebtService = payment * 12;
  const dscr = annualDebtService > 0 ? noi / annualDebtService : null; // null = no debt

  const reserves = inp.reservesPerUnit * inp.units;
  const cashFlow = noi - annualDebtService - reserves;
  const cfPerUnitMonthly = cashFlow / (inp.units * 12);

  const cashInvested = inp.price - loan + inp.closingPct * inp.price + inp.initialRepairs;
  const cashOnCash = cashInvested > 0 ? cashFlow / cashInvested : null; // null = not meaningful

  const breakEvenOccupancy = (opex + annualDebtService + reserves - otherIncome) / gpr;

  let maxLoanByDscr = null;
  if (screens.minDscr) {
    if (inp.interestOnly) maxLoanByDscr = inp.rate > 0 ? noi / (screens.minDscr * inp.rate) : null;
    else maxLoanByDscr = (noi / (screens.minDscr * 12)) * annuityFactor(inp.rate, inp.amortYears);
    if (maxLoanByDscr !== null) maxLoanByDscr = Math.max(0, maxLoanByDscr);
  }
  const ltvCap = (screens.maxLtv ?? 1) * inp.price;
  const maxLoan = maxLoanByDscr === null ? ltvCap : Math.min(ltvCap, maxLoanByDscr);

  return {
    gpr, vacancyLoss, otherIncome, egi, taxes, management, opex, noi, opexRatio, capRate,
    loan, payment, annualDebtService, dscr, reserves, cashFlow, cfPerUnitMonthly,
    cashInvested, cashOnCash, breakEvenOccupancy, maxLoanByDscr, maxLoan,
    maxLoanLtv: maxLoan / inp.price,
  };
}

// ---------- screens ----------

export function checkScreens(r, inp, screens = DEFAULT_SCREENS) {
  const results = [];
  if (screens.minDscr !== null && screens.minDscr !== undefined) {
    results.push({
      screen: 'minDscr', kind: 'fail', threshold: screens.minDscr, actual: r.dscr,
      pass: r.dscr === null ? true : r.dscr >= screens.minDscr - EPS,
      notApplicable: r.dscr === null,
    });
  }
  if (screens.minCfPerUnitMonthly !== null && screens.minCfPerUnitMonthly !== undefined) {
    results.push({
      screen: 'minCfPerUnitMonthly', kind: 'fail', threshold: screens.minCfPerUnitMonthly,
      actual: r.cfPerUnitMonthly, pass: r.cfPerUnitMonthly >= screens.minCfPerUnitMonthly - EPS,
    });
  }
  if (screens.maxLtv !== null && screens.maxLtv !== undefined) {
    results.push({
      screen: 'maxLtv', kind: 'fail', threshold: screens.maxLtv, actual: inp.ltv,
      pass: inp.ltv <= screens.maxLtv + EPS,
    });
  }
  if (screens.minCashOnCash !== null && screens.minCashOnCash !== undefined) {
    results.push({
      screen: 'minCashOnCash', kind: 'fail', threshold: screens.minCashOnCash, actual: r.cashOnCash,
      pass: r.cashOnCash !== null && r.cashOnCash >= screens.minCashOnCash - EPS,
    });
  }
  if (screens.opexBand && r.opexRatio !== null) {
    const [lo, hi] = screens.opexBand;
    results.push({
      screen: 'opexBand', kind: 'warning', threshold: screens.opexBand, actual: r.opexRatio,
      pass: r.opexRatio >= lo - EPS && r.opexRatio <= hi + EPS,
    });
  }
  return results;
}

export function passesAll(screenResults) {
  return screenResults.every(s => s.kind !== 'fail' || s.pass);
}

// ---------- scenarios ----------

export function applyDownside(inputs, downside = DEFAULT_DOWNSIDE) {
  const inp = withDefaults(inputs);
  const out = { ...inp, vacancy: inp.vacancy + downside.vacancyAddPts, rate: inp.rate + downside.rateAddPts };
  if (inp.expenseMode === 'ratio') {
    out.opexRatio = downside.opexRatio;
  } else {
    out.insurance = inp.insurance * downside.insuranceMult;
    out.repairs = inp.repairs * downside.repairsMult;
    if (typeof inp.taxRate === 'number' && Number.isFinite(inp.taxRate)) out.taxMode = 'rate';
    else out.taxes = taxesFor(inp) * downside.taxesMultIfNoRate;
  }
  return out;
}

// ---------- solvers ----------

function bisect(passesAt, lo, hi, tol) {
  if (!passesAt(lo)) return null;
  if (passesAt(hi)) return hi;
  while (hi - lo > tol) {
    const mid = (lo + hi) / 2;
    if (passesAt(mid)) lo = mid; else hi = mid;
  }
  return lo;
}

// Highest interest rate that still passes every fail-kind screen. null = fails even at 0%.
export function solveMaxRate(inputs, screens = DEFAULT_SCREENS) {
  const inp = withDefaults(inputs);
  return bisect(rate => passesAll(checkScreens(compute({ ...inp, rate }, screens), { ...inp, rate }, screens)),
    0, 0.5, 1e-7);
}

// Highest price that still passes every fail-kind screen, rounded down to the dollar. null = none.
export function solveMaxPrice(inputs, screens = DEFAULT_SCREENS) {
  const inp = withDefaults(inputs);
  const p = bisect(price => passesAll(checkScreens(compute({ ...inp, price }, screens), { ...inp, price }, screens)),
    1, inp.price * 5, 0.01);
  return p === null ? null : Math.floor(p + 1e-6);
}

// ---------- source labels ----------

const LABEL_ORDER = { seller: 0, projection: 1, assumption: 2 };

// Lists the unverified inputs an output rests on: Seller-stated first, then Projection,
// then Assumption. Inputs without a label are tool defaults, so they count as Assumption.
export function unverifiedInputs(outputName, inputs, sources = {}) {
  const deps = dependencies(withDefaults(inputs))[outputName] || [];
  return deps
    .map(field => ({ field, label: sources[field] || 'assumption' }))
    .filter(d => d.label !== 'verified')
    .sort((a, b) => LABEL_ORDER[a.label] - LABEL_ORDER[b.label]);
}

// ---------- display ----------

// DSCR to 2 decimals, except when it fails but would round up to the threshold:
// then 3 decimals so "1.30 FAIL" never appears.
export function formatDscr(value, minDscr = DEFAULT_SCREENS.minDscr) {
  if (value === null) return 'not applicable, no debt';
  const two = value.toFixed(2);
  if (minDscr !== null && value < minDscr - EPS && Number(two) >= minDscr) return value.toFixed(3);
  return two;
}

// ---------- top-level ----------

// Runs the base case, the downside case and the solvers. Returns errors instead of
// numbers for any output whose inputs are invalid.
export function analyzeDeal(rawInputs, { screens = DEFAULT_SCREENS, downside = DEFAULT_DOWNSIDE, sources = {}, inPlace = null } = {}) {
  const inp = withDefaults(rawInputs);
  const errors = validate(inp);
  const deps = dependencies(inp);
  const invalid = new Set(Object.keys(errors));
  const needsInput = Object.keys(deps).filter(k => deps[k].some(f => invalid.has(f)));

  if (invalid.size > 0) {
    // Partial results are computed only when every dependency of an output is valid.
    const safe = { ...inp };
    for (const f of invalid) safe[f] = RANGES[f]?.min ?? 1;
    let partial = {};
    try { partial = compute(safe, screens); } catch { partial = {}; }
    const base = {};
    for (const k of Object.keys(deps)) base[k] = needsInput.includes(k) ? null : partial[k];
    return { ok: false, errors, needsInput, base, downside: null, verdict: null };
  }

  const base = compute(inp, screens);
  const baseScreens = checkScreens(base, inp, screens);
  const downInputs = applyDownside(inp, downside);
  const down = compute(downInputs, screens);
  const downScreens = checkScreens(down, downInputs, screens);

  let inPlaceResult = null;
  if (inPlace && Object.keys(inPlace).length > 0) {
    const ipInputs = { ...inp, ...inPlace };
    const ipErrors = validate(ipInputs);
    if (Object.keys(ipErrors).length === 0) {
      const ip = compute(ipInputs, screens);
      inPlaceResult = { results: ip, screens: checkScreens(ip, ipInputs, screens) };
    }
  }

  const basePass = passesAll(baseScreens);
  const downPass = passesAll(downScreens);
  let status;
  if (!basePass) status = 'fail';
  else if (inPlaceResult && !passesAll(inPlaceResult.screens)) status = 'passes-only-on-projections';
  else if (!downPass) status = 'passes-base-fails-downside';
  else status = 'pass';

  return {
    ok: true,
    errors: {},
    warnings: fieldWarnings(inp, screens, sources),
    needsInput: [],
    base,
    baseScreens,
    downsideInputs: downInputs,
    downside: down,
    downsideScreens: downScreens,
    inPlace: inPlaceResult,
    solvers: {
      breakEvenOccupancy: base.breakEvenOccupancy,
      maxRate: solveMaxRate(inp, screens),
      maxPrice: solveMaxPrice(inp, screens),
    },
    verdict: {
      status,
      negativeNoi: base.noi < 0,
      failures: baseScreens.filter(s => s.kind === 'fail' && !s.pass),
      downsideFailures: downScreens.filter(s => s.kind === 'fail' && !s.pass),
      warnings: baseScreens.filter(s => s.kind === 'warning' && !s.pass),
    },
    unverified: Object.fromEntries(Object.keys(deps).map(k => [k, unverifiedInputs(k, inp, sources)])),
  };
}
