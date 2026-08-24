# TENKEY

A 10-key (numeric keypad) exam for **check totals**: accuracy and speed, measured in **KPH** (keys per hour).

Live: [realbluesky.github.io/tenkey](https://realbluesky.github.io/tenkey/)

## How it works

1. Pick a duration. The stack of checks is endless for that window.
2. Type the amount from the top check.
3. Press `+` to add it toward the running total.
4. Press `Space` or `Left Ctrl` to slide the check aside (desk simulation).
5. The clock starts on the **first numeric key**.

Whole-dollar amounts (~30% of the stack) may skip `.00` with no penalty. Other amounts require pennies. Alpha keys and other stray hits appear on the display and must be backspaced or they count against accuracy.

## Scores

| Metric | Meaning |
| --- | --- |
| Gross KPH | All counted keystrokes, scaled to an hour |
| Net KPH | Gross minus miskeys, extra keys, and backspaces |
| Numeric KPH | Digits and decimal only (closer to classic number-only 10-key tests) |
| Uncorrected accuracy | Remaining mistakes vs expected characters |
| Corrected accuracy | Also treats backspaces as errors |
| Amount accuracy | Correct checks / submitted checks |

Results are stored in **localStorage** on this browser. Name yourself and download a PDF of a session or of exam personal bests.

Practice mode marks each add right or wrong. Exam mode hides that until the end; exam sessions are the official bests.

## Develop

```bash
npm install
npm test
npm run dev
```

GitHub Pages deploys from `main` via GitHub Actions.
