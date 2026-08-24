import { pick, randInt } from "./rng";
import type { AmountHand, AmountSize, CheckItem } from "./types";

const PAYEES = [
  "Harbor & Pine Supply",
  "Northfield Electric",
  "Elm Street Pharmacy",
  "Cedar Ridge Feed",
  "Blue Lamp Hardware",
  "Westbrook Paper Co.",
  "Morrow & Sons HVAC",
  "Iron Bridge Auto",
  "Piedmont Office Mart",
  "Lakeview Veterinary",
  "Ashford Print Shop",
  "Copper Kettle Catering",
  "Summit Field Services",
  "Riverside Lumber",
  "Oak & Thread Tailors",
  "Brightline Telecom",
  "Mapleton Grocery",
  "Holloway Glassworks",
  "Red Barn Produce",
  "Kinley Medical Group",
  "Sparrow Hill Nursery",
  "Tilden Fuel & Oil",
  "Canvas & Co. Studio",
  "Barrow County Water",
  "Quiet Harbor Marina",
  "Phelps Family Dental",
  "Ninth Street Books",
  "Wren & Co. Insurance",
  "Southbound Freight",
  "Amber Field Bakery",
  "Cinderblock Coffee",
  "Valley Forge Welding",
  "Hearthside Furniture",
  "Gulliver Packing Co.",
  "Meadowlark Seeds",
  "Fairmount Dry Cleaners",
  "Two Rivers Plumbing",
  "Kessler Tool Rental",
  "Lantern Press",
  "Crescent City Linen",
] as const;

const MEMOS = [
  "invoice",
  "order",
  "acct",
  "PO",
  "statement",
  "job",
  "ref",
] as const;

export const WHOLE_DOLLAR_RATE = 0.3;
export const MIN_CENTS = 1;
export const MAX_CENTS = 999_999;

const AMOUNT_HANDS: readonly AmountHand[] = [
  "print-mono",
  "print-mono",
  "print-mono",
  "print-serif",
  "print-serif",
  "print-sans",
  "hand-loop",
  "hand-loop",
  "hand-block",
];

const AMOUNT_SIZES: readonly AmountSize[] = ["sm", "md", "md", "lg", "lg", "xl"];

export function generateCheck(rng: () => number, index: number, startNumber?: number): CheckItem {
  const wholeDollar = rng() < WHOLE_DOLLAR_RATE;
  const cents = randomCents(rng, wholeDollar);
  const checkNumber = (startNumber ?? randInt(rng, 1100, 8800)) + index;
  const payee = pick(rng, PAYEES);
  const memoKind = pick(rng, MEMOS);
  const memo = `${memoKind} ${randInt(rng, 1004, 9988)}`;
  const amountHand = pick(rng, AMOUNT_HANDS);
  const amountSize = pick(rng, AMOUNT_SIZES);
  const amountTilt = amountHand.startsWith("hand") ? randInt(rng, -3, 3) : 0;
  return {
    index,
    checkNumber,
    payee,
    memo,
    cents,
    wholeDollar,
    amountHand,
    amountSize,
    amountTilt,
  };
}

function randomCents(rng: () => number, wholeDollar: boolean): number {
  if (wholeDollar) return randomDollars(rng) * 100;
  if (rng() < 0.03) return randInt(rng, MIN_CENTS, 99);
  return randomDollars(rng) * 100 + randInt(rng, 1, 99);
}

function randomDollars(rng: () => number): number {
  const bucket = rng();
  if (bucket < 0.08) return randInt(rng, 1, 99);
  if (bucket < 0.5) return randInt(rng, 100, 999);
  if (bucket < 0.88) return randInt(rng, 1000, 4999);
  return randInt(rng, 5000, 9999);
}

export function formatMoney(cents: number, withDollar = true): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  const dollars = Math.floor(abs / 100);
  const remainder = abs % 100;
  const grouped = dollars.toLocaleString("en-US");
  const body = `${grouped}.${String(remainder).padStart(2, "0")}`;
  return `${sign}${withDollar ? "$" : ""}${body}`;
}

export function formatCheckAmount(cents: number): string {
  return formatMoney(cents, false);
}

export function parseEntry(raw: string): number | null {
  if (!/^\d+(\.\d{0,2})?$/.test(raw)) return null;
  const [dollarPart, frac] = raw.split(".");
  if (!dollarPart) return null;
  const dollars = Number.parseInt(dollarPart, 10);
  if (!Number.isFinite(dollars)) return null;
  if (frac === undefined) return dollars * 100;
  if (frac.length === 0) return dollars * 100;
  if (frac.length === 1) return dollars * 100 + Number.parseInt(frac, 10) * 10;
  return dollars * 100 + Number.parseInt(frac, 10);
}

export function acceptableStrings(check: CheckItem): string[] {
  const dollars = Math.floor(check.cents / 100);
  const remainder = check.cents % 100;
  if (remainder === 0) {
    return [String(dollars), `${dollars}.`, `${dollars}.0`, `${dollars}.00`];
  }
  const padded = `${dollars}.${String(remainder).padStart(2, "0")}`;
  if (remainder % 10 === 0) return [`${dollars}.${remainder / 10}`, padded];
  return [padded];
}

export function isAcceptable(check: CheckItem, raw: string): boolean {
  const parsed = parseEntry(raw);
  return parsed !== null && parsed === check.cents;
}

export function canonicalEntry(check: CheckItem): string {
  return acceptableStrings(check)[0]!;
}
