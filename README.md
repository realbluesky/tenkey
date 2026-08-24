# TENKEY

A 10-key (numeric keypad) exam for accuracy and speed, measured in **KPH** (keys per hour). Two jobs share the desk and keep **separate scores**:

- **Checks** — one check at a time. Fonts, sizes, and handwriting vary. `Tab` slides the stack.
- **Transcription** — a printed list of amounts you can read ahead. `+` or `Enter` adds and moves to the next line.

Live: [realbluesky.github.io/tenkey](https://realbluesky.github.io/tenkey/)

## How it works

1. Pick **Checks** or **Transcription**, then a **stack/list** (10–100, default) or a **timed** run.
2. Type the amount from the current check, or from the printed list.
3. On a **calculator** desk, press `+` to add. On a **spreadsheet** desk, press `Enter` to commit the cell and work down the column. In check processing, `Tab` slides the check aside — either order. Calculator and spreadsheet share scores **within** the same job; transcription never mixes with checks.
4. `Shift+Tab` brings a check back if you slid too soon.
5. The clock starts on the **first numeric key**.

Trailing zeros after the decimal may be omitted (`4` for $4.00, `73.7` for $73.70). Alpha keys and other stray hits appear on the display and must be backspaced or they count against accuracy.

## Scores

| Metric | Meaning |
| --- | --- |
| Gross KPH | Keypad work including corrections (not Tab) |
| Net KPH | Digits, decimal, and +/Enter that remain in submitted amounts. Backspaced keys and an unfinished leftover check do not count. |
| Numeric KPH | Surviving digits and decimal only |
| Accuracy | Submitted checks that ended up right after any backspaces |
| Corrected accuracy | Also treats backspaces as errors |
| Uncorrected errors | Wrong submitted amounts only (unfinished next check is not an error) |

Results include a net-KPH sparkline for the run. Recent history is grouped by day with a median KPH. Results are stored in **localStorage** on this browser.

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
