# TENKEY

A 10-key (numeric keypad) exam for **check totals**: accuracy and speed, measured in **KPH** (keys per hour).

Live: [realbluesky.github.io/tenkey](https://realbluesky.github.io/tenkey/)

## How it works

1. Pick a duration. The stack of checks is endless for that window.
2. Type the amount from the top check.
3. Press `+` to add it toward the running total, and `Tab` to slide the check aside — either order.
4. `Shift+Tab` brings a check back if you slid too soon.
5. The clock starts on the **first numeric key**.

Trailing zeros after the decimal may be omitted (`4` for $4.00, `73.7` for $73.70). Alpha keys and other stray hits appear on the display and must be backspaced or they count against accuracy.

## Scores

| Metric | Meaning |
| --- | --- |
| Gross KPH | All counted keystrokes, scaled to an hour |
| Net KPH | Gross minus miskeys, extra keys, and backspaces |
| Numeric KPH | Digits and decimal only (closer to classic number-only 10-key tests) |
| Accuracy | Submitted checks that ended up right after any backspaces |
| Corrected accuracy | Also treats backspaces as errors |
| Uncorrected errors | Wrong submitted amounts only (unfinished next check is not an error) |

Results are stored in **localStorage** on this browser. Name yourself and download a PDF of a session or of exam personal bests.

Practice mode marks each add right or wrong. Exam mode hides that until the end; exam sessions are the official bests.

## Develop

```bash
npm install
npm test
npm run dev
```

The live site is built `dist/` on the `gh-pages` branch (`https://realbluesky.github.io/tenkey/`). Rebuild and push that branch after UI changes:

```bash
npm run build
# copy dist/ onto gh-pages and push
```
