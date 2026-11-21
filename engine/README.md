# Deal Club calculation engine

`dealEngine.js` implements the approved Deal Stress Test Formula Specification (2026-10-18). It is pure JavaScript with no dependencies, no DOM access and no network or storage, so the same code can run in the browser page and in tests.

Rates and percentages are decimals (7% = 0.07). Values are unrounded; round only for display (`formatDscr` handles the DSCR edge case).

Main entry point:

```js
import { analyzeDeal } from './engine/dealEngine.js';

const result = analyzeDeal(inputs, { screens, downside, sources, inPlace });
// result.base, result.downside, result.baseScreens, result.solvers, result.verdict, result.unverified
```

`screens` default to TMC's illustrative values (DSCR 1.30, $175/unit/month after reserves, LTV 75%). They are not recommendations and members can change them.

Run the tests (Node 18+): `npm test`. Every test case in `test/spec.test.js` comes from the spec; a formula change must update the spec and its test cases first.
