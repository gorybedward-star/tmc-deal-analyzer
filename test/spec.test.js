// Test cases from the approved "Deal Stress Test Formula Specification" (2026-10-18).
// Money must match to within $0.01 and ratios to within 0.0001.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  analyzeDeal, applyDownside, compute, checkScreens, withDefaults, solveMaxRate, solveMaxPrice,
  validate, parseNumberInput, formatDscr, unverifiedInputs, fieldWarnings, monthlyPayment,
} from '../engine/dealEngine.js';

const money = (actual, expected, label) =>
  assert.ok(Math.abs(actual - expected) <= 0.01, `${label}: expected ${expected}, got ${actual}`);
const ratio = (actual, expected, label) =>
  assert.ok(Math.abs(actual - expected) <= 0.0001, `${label}: expected ${expected}, got ${actual}`);

function run(inputs) {
  const inp = withDefaults(inputs);
  const r = compute(inp);
  const s = Object.fromEntries(checkScreens(r, inp).map(x => [x.screen, x]));
  return { r, s };
}

const TC1 = {
  units: 8, monthlyRent: 10_000, vacancy: 0.08, expenseMode: 'ratio', opexRatio: 0.45,
  price: 800_000, ltv: 0.75, rate: 0.07, amortYears: 30, reservesPerUnit: 300, closingPct: 0.03,
};
const TC2 = { ...TC1, vacancy: 0.13, opexRatio: 0.50, rate: 0.085 };
const TC3 = {
  units: 4, monthlyRent: 5_600, otherIncomeMonthly: 100, vacancy: 0.08, expenseMode: 'lineItems',
  taxes: 8_400, insurance: 3_600, utilities: 2_400, repairs: 4_000, managementPct: 0.08, otherOpex: 1_200,
  price: 560_000, ltv: 0.75, rate: 0.0675, amortYears: 30, reservesPerUnit: 300, closingPct: 0.03,
  initialRepairs: 10_000,
};
const TC4 = { ...TC3, vacancy: 0.13, insurance: 4_500, repairs: 5_000, taxMode: 'rate', taxRate: 0.018, rate: 0.0825 };
const TC5 = {
  units: 10, monthlyRent: 6_000, vacancy: 0.10, expenseMode: 'lineItems', taxes: 25_800, insurance: 0,
  utilities: 0, repairs: 0, managementPct: 0, otherOpex: 0, price: 1_000_000, ltv: 0.5, rate: 0.06,
  amortYears: 30, interestOnly: true, reservesPerUnit: 0, closingPct: 0,
};
const TC6 = { ...TC1, rate: 0 };
const TC7 = { ...TC1, ltv: 0 };
const TC8 = {
  units: 3, monthlyRent: 3_000, vacancy: 0.10, expenseMode: 'ratio', opexRatio: 0.60, price: 400_000,
  ltv: 0.75, rate: 0.07, amortYears: 30, reservesPerUnit: 300, closingPct: 0.03,
};
const TC9 = { ...TC1, ltv: 0.80 };

test('TC1 worked example, ratio mode', () => {
  const { r, s } = run(TC1);
  money(r.gpr, 120_000, 'GPR'); money(r.egi, 110_400, 'EGI'); money(r.opex, 49_680, 'opex');
  money(r.noi, 60_720, 'NOI'); ratio(r.opexRatio, 0.45, 'opex ratio'); ratio(r.capRate, 0.0759, 'cap');
  money(r.loan, 600_000, 'loan'); money(r.payment, 3_991.81, 'payment'); money(r.annualDebtService, 47_901.78, 'ADS');
  ratio(r.dscr, 1.2676, 'DSCR'); money(r.reserves, 2_400, 'reserves'); money(r.cashFlow, 10_418.22, 'CF');
  money(r.cfPerUnitMonthly, 108.52, 'CF/unit'); money(r.cashInvested, 224_000, 'cash');
  ratio(r.cashOnCash, 0.0465, 'CoC'); ratio(r.breakEvenOccupancy, 0.8332, 'BEO');
  money(r.maxLoanByDscr, 585_043.30, 'max loan DSCR');
  assert.equal(s.minDscr.pass, false); assert.equal(s.minCfPerUnitMonthly.pass, false); assert.equal(s.maxLtv.pass, true);
});

test('TC2 TC1 downside', () => {
  const { r, s } = run(TC2);
  money(r.egi, 104_400, 'EGI'); money(r.opex, 52_200, 'opex'); money(r.noi, 52_200, 'NOI');
  ratio(r.capRate, 0.0653, 'cap'); money(r.payment, 4_613.48, 'payment'); money(r.annualDebtService, 55_361.77, 'ADS');
  ratio(r.dscr, 0.9429, 'DSCR'); money(r.cashFlow, -5_561.77, 'CF'); money(r.cfPerUnitMonthly, -57.94, 'CF/unit');
  ratio(r.cashOnCash, -0.0248, 'CoC'); ratio(r.breakEvenOccupancy, 0.9163, 'BEO');
  money(r.maxLoanByDscr, 435_179.50, 'max loan DSCR');
  assert.equal(s.minDscr.pass, false); assert.equal(s.minCfPerUnitMonthly.pass, false); assert.equal(s.maxLtv.pass, true);
});

test('TC2 is what the default downside produces from TC1', () => {
  const d = applyDownside(TC1);
  ratio(d.vacancy, 0.13, 'vacancy'); ratio(d.opexRatio, 0.50, 'opex ratio'); ratio(d.rate, 0.085, 'rate');
  money(compute(d).noi, 52_200, 'NOI');
});

test('TC3 line items, other income, repairs', () => {
  const { r, s } = run(TC3);
  money(r.gpr, 67_200, 'GPR'); money(r.egi, 63_024, 'EGI'); money(r.management, 5_041.92, 'mgmt');
  money(r.opex, 24_641.92, 'opex'); money(r.noi, 38_382.08, 'NOI'); ratio(r.opexRatio, 0.3910, 'opex ratio');
  ratio(r.capRate, 0.0685, 'cap'); money(r.loan, 420_000, 'loan'); money(r.payment, 2_724.11, 'payment');
  money(r.annualDebtService, 32_689.34, 'ADS'); ratio(r.dscr, 1.1741, 'DSCR'); money(r.reserves, 1_200, 'reserves');
  money(r.cashFlow, 4_492.74, 'CF'); money(r.cfPerUnitMonthly, 93.60, 'CF/unit'); money(r.cashInvested, 166_800, 'cash');
  ratio(r.cashOnCash, 0.0269, 'CoC'); ratio(r.breakEvenOccupancy, 0.8531, 'BEO');
  money(r.maxLoanByDscr, 379_339.65, 'max loan DSCR');
  assert.equal(s.minDscr.pass, false); assert.equal(s.minCfPerUnitMonthly.pass, false);
  assert.equal(s.maxLtv.pass, true); assert.equal(s.opexBand.pass, false);
});

test('TC4 TC3 downside with tax reassessment', () => {
  const { r, s } = run(TC4);
  money(r.egi, 59_664, 'EGI'); money(r.taxes, 10_080, 'taxes'); money(r.management, 4_773.12, 'mgmt');
  money(r.opex, 27_953.12, 'opex'); money(r.noi, 31_710.88, 'NOI'); ratio(r.opexRatio, 0.4685, 'opex ratio');
  ratio(r.capRate, 0.0566, 'cap'); money(r.payment, 3_155.32, 'payment'); money(r.annualDebtService, 37_863.84, 'ADS');
  ratio(r.dscr, 0.8375, 'DSCR'); money(r.cashFlow, -7_352.96, 'CF'); money(r.cfPerUnitMonthly, -153.19, 'CF/unit');
  ratio(r.cashOnCash, -0.0441, 'CoC'); ratio(r.breakEvenOccupancy, 0.9794, 'BEO');
  money(r.maxLoanByDscr, 270_576.21, 'max loan DSCR');
  assert.equal(s.minDscr.pass, false); assert.equal(s.minCfPerUnitMonthly.pass, false); assert.equal(s.maxLtv.pass, true);
});

test('TC4 is what the default downside produces from TC3 with a 1.8% tax rate', () => {
  const d = applyDownside({ ...TC3, taxRate: 0.018 });
  const r = compute(d);
  money(r.taxes, 10_080, 'taxes'); money(r.noi, 31_710.88, 'NOI'); money(r.annualDebtService, 37_863.84, 'ADS');
});

test('without a tax rate the downside raises taxes 15%', () => {
  money(compute(applyDownside(TC3)).taxes, 9_660, 'taxes');
});

test('TC5 DSCR exactly at the screen passes, interest-only', () => {
  const { r, s } = run(TC5);
  money(r.gpr, 72_000, 'GPR'); money(r.egi, 64_800, 'EGI'); money(r.management, 0, 'mgmt');
  money(r.opex, 25_800, 'opex'); money(r.noi, 39_000, 'NOI'); ratio(r.opexRatio, 0.3981, 'opex ratio');
  ratio(r.capRate, 0.0390, 'cap'); money(r.loan, 500_000, 'loan'); money(r.payment, 2_500, 'payment');
  money(r.annualDebtService, 30_000, 'ADS'); ratio(r.dscr, 1.3, 'DSCR'); money(r.cashFlow, 9_000, 'CF');
  money(r.cfPerUnitMonthly, 75, 'CF/unit'); money(r.cashInvested, 500_000, 'cash'); ratio(r.cashOnCash, 0.0180, 'CoC');
  ratio(r.breakEvenOccupancy, 0.7750, 'BEO'); money(r.maxLoanByDscr, 500_000, 'max loan DSCR');
  assert.equal(s.minDscr.pass, true); assert.equal(s.minCfPerUnitMonthly.pass, false);
  assert.equal(s.maxLtv.pass, true); assert.equal(s.opexBand.pass, false);
});

test('TC6 zero interest rate', () => {
  const { r, s } = run(TC6);
  money(r.noi, 60_720, 'NOI'); money(r.loan, 600_000, 'loan'); money(r.payment, 1_666.67, 'payment');
  money(r.annualDebtService, 20_000, 'ADS'); ratio(r.dscr, 3.0360, 'DSCR'); money(r.cashFlow, 38_320, 'CF');
  money(r.cfPerUnitMonthly, 399.17, 'CF/unit'); money(r.cashInvested, 224_000, 'cash'); ratio(r.cashOnCash, 0.1711, 'CoC');
  ratio(r.breakEvenOccupancy, 0.6007, 'BEO'); money(r.maxLoan, 600_000, 'max loan');
  assert.equal(s.minDscr.pass, true); assert.equal(s.minCfPerUnitMonthly.pass, true); assert.equal(s.maxLtv.pass, true);
});

test('TC7 all cash: DSCR not applicable and its screen is skipped', () => {
  const { r, s } = run(TC7);
  money(r.loan, 0, 'loan'); money(r.payment, 0, 'payment'); money(r.annualDebtService, 0, 'ADS');
  assert.equal(r.dscr, null); assert.equal(s.minDscr.notApplicable, true); assert.equal(s.minDscr.pass, true);
  money(r.cashFlow, 58_320, 'CF'); money(r.cfPerUnitMonthly, 607.50, 'CF/unit'); money(r.cashInvested, 824_000, 'cash');
  ratio(r.cashOnCash, 0.0708, 'CoC'); ratio(r.breakEvenOccupancy, 0.4340, 'BEO'); money(r.maxLoan, 585_043.30, 'max loan');
  assert.equal(s.minCfPerUnitMonthly.pass, true); assert.equal(s.maxLtv.pass, true);
  assert.equal(formatDscr(r.dscr), 'not applicable, no debt');
});

test('TC8 money-losing deal', () => {
  const { r, s } = run(TC8);
  money(r.gpr, 36_000, 'GPR'); money(r.egi, 32_400, 'EGI'); money(r.opex, 19_440, 'opex'); money(r.noi, 12_960, 'NOI');
  ratio(r.opexRatio, 0.60, 'opex ratio'); ratio(r.capRate, 0.0324, 'cap'); money(r.loan, 300_000, 'loan');
  money(r.payment, 1_995.91, 'payment'); money(r.annualDebtService, 23_950.89, 'ADS'); ratio(r.dscr, 0.5411, 'DSCR');
  money(r.reserves, 900, 'reserves'); money(r.cashFlow, -11_890.89, 'CF'); money(r.cfPerUnitMonthly, -330.30, 'CF/unit');
  money(r.cashInvested, 112_000, 'cash'); ratio(r.cashOnCash, -0.1062, 'CoC'); ratio(r.breakEvenOccupancy, 1.2303, 'BEO');
  money(r.maxLoan, 124_870.90, 'max loan');
  assert.equal(s.minDscr.pass, false); assert.equal(s.minCfPerUnitMonthly.pass, false);
  assert.equal(s.maxLtv.pass, true); assert.equal(s.opexBand.pass, false);
});

test('TC9 LTV over the screen', () => {
  const { r, s } = run(TC9);
  money(r.loan, 640_000, 'loan'); money(r.payment, 4_257.94, 'payment'); money(r.annualDebtService, 51_095.23, 'ADS');
  ratio(r.dscr, 1.1884, 'DSCR'); money(r.cashFlow, 7_224.77, 'CF'); money(r.cfPerUnitMonthly, 75.26, 'CF/unit');
  money(r.cashInvested, 184_000, 'cash'); ratio(r.cashOnCash, 0.0393, 'CoC'); ratio(r.breakEvenOccupancy, 0.8598, 'BEO');
  money(r.maxLoan, 585_043.30, 'max loan');
  assert.equal(s.minDscr.pass, false); assert.equal(s.minCfPerUnitMonthly.pass, false); assert.equal(s.maxLtv.pass, false);
});

test('solvers match the spec and the closed form', () => {
  ratio(solveMaxRate(TC1), 0.056410, 'TC1 max rate');
  assert.equal(solveMaxPrice(TC1), 693_418);
  ratio(solveMaxRate(TC3), 0.055523, 'TC3 max rate');
  assert.equal(solveMaxPrice(TC3), 493_064);
  // Closed form for fixed taxes: the cash-flow screen binds.
  const k = monthlyPayment(1, 0.07, 30) * 12;
  const closedForm = (60_720 - 2_400 - 175 * 12 * 8) / (k * 0.75);
  assert.ok(Math.abs(solveMaxPrice(TC1) - Math.floor(closedForm)) <= 1);
  // TC8 fails at every rate, but a much lower price passes (cross-checked: $96,196.84).
  assert.equal(solveMaxRate(TC8), null);
  assert.equal(solveMaxPrice(TC8), 96_196);
  // Negative NOI: no price or rate can pass.
  const underwater = { ...TC3, taxes: 60_000 };
  assert.equal(solveMaxRate(underwater), null);
  assert.equal(solveMaxPrice(underwater), null);
});

test('amortizing loans pay down to $0', () => {
  for (const [loan, rate] of [[600_000, 0.07], [420_000, 0.0675], [600_000, 0.085]]) {
    const p = monthlyPayment(loan, rate, 30);
    let b = loan;
    for (let i = 0; i < 360; i++) b = b * (1 + rate / 12) - p;
    assert.ok(Math.abs(b) < 0.001, `balance ${b}`);
  }
});

test('V1 units 25 is an error with no results', () => {
  const a = analyzeDeal({ ...TC1, units: 25 });
  assert.equal(a.ok, false);
  assert.equal(a.errors.units, 'Deal Club covers properties with 2 to 20 units');
  assert.equal(a.base.cfPerUnitMonthly, null);
  assert.equal(a.base.reserves, null);
});

test('V2 units 3.5 is the same error', () => {
  assert.equal(validate({ ...TC1, units: 3.5 }).units, 'Deal Club covers properties with 2 to 20 units');
});

test('V3 vacancy 60% names the range and blocks dependent results', () => {
  const a = analyzeDeal({ ...TC1, vacancy: 0.6 });
  assert.equal(a.errors.vacancy, 'Vacancy must be between 0% and 50%');
  assert.ok(a.needsInput.includes('noi'));
  assert.equal(a.base.noi, null);
  money(a.base.loan, 600_000, 'loan still shown');
  money(a.base.annualDebtService, 47_901.78, 'ADS still shown');
});

test('V4 empty rent asks for a number', () => {
  const a = analyzeDeal({ ...TC1, monthlyRent: parseNumberInput('') });
  assert.equal(a.errors.monthlyRent, 'Enter a number');
  assert.equal(a.base.egi, null);
});

test('typed $, commas and % are accepted', () => {
  assert.equal(parseNumberInput('$1,250'), 1250);
  ratio(parseNumberInput('7', { percent: true }), 0.07, '7 means 7%');
  ratio(parseNumberInput('7%', { percent: true }), 0.07, '7% means 7%');
  assert.ok(Number.isNaN(parseNumberInput('abc')));
});

test('price above $100,000,000 is an error', () => {
  assert.ok(validate({ ...TC1, price: 100_000_001 }).price);
});

test('DSCR display never shows a failing value as the threshold', () => {
  assert.equal(formatDscr(1.296), '1.296');
  assert.equal(formatDscr(1.2676), '1.27');
  assert.equal(formatDscr(1.3), '1.30');
});

test('verdicts: fail, passes base but fails downside, projections only', () => {
  assert.equal(analyzeDeal(TC1).verdict.status, 'fail');
  assert.equal(analyzeDeal(TC6).verdict.status, 'pass');
  const strong = { ...TC1, price: 650_000 };
  assert.equal(analyzeDeal(strong).verdict.status, 'passes-base-fails-downside');
  const projected = analyzeDeal({ ...strong, monthlyRent: 10_000 }, { inPlace: { monthlyRent: 9_000 } });
  assert.equal(projected.verdict.status, 'passes-only-on-projections');
  assert.equal(analyzeDeal(TC8).verdict.negativeNoi, false);
  const underwater = analyzeDeal({ ...TC3, taxes: 60_000 });
  assert.equal(underwater.verdict.negativeNoi, true);
  assert.equal(underwater.verdict.status, 'fail');
});

test('source labels list unverified inputs, seller-stated first', () => {
  const u = unverifiedInputs('noi', TC3, {
    monthlyRent: 'verified', vacancy: 'assumption', taxes: 'seller', insurance: 'verified',
    otherIncomeMonthly: 'projection', utilities: 'verified', repairs: 'verified', managementPct: 'verified', otherOpex: 'verified',
  });
  assert.deepEqual(u.map(x => x.field), ['taxes', 'otherIncomeMonthly', 'vacancy']);
  assert.equal(unverifiedInputs('gpr', TC3, { monthlyRent: 'verified' }).length, 0);
});

test('field warnings', () => {
  const w = fieldWarnings({ ...TC3, managementPct: 0 }, undefined, { taxes: 'seller' });
  assert.ok(w.taxes); assert.ok(w.managementPct); assert.ok(!w.vacancy);
  assert.ok(fieldWarnings(TC9).ltv);
  assert.ok(fieldWarnings(TC1).expenseMode);
});
