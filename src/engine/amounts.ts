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
  const bucket = rng();
  let dollars: number;
  if (bucket < 0.5) dollars = randInt(rng, 1, 99);
  else if (bucket < 0.8) dollars = randInt(rng, 100, 999);
  else if (bucket < 0.95) dollars = randInt(rng, 1000, 4999);
  else dollars = randInt(rng, 5000, 19999);

  if (wholeDollar) return dollars * 100;
  return dollars * 100 + randInt(rng, 1, 99);
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
  if (check.wholeDollar) {
    return [
      String(dollars),
      `${dollars}.`,
      `${dollars}.0`,
      `${dollars}.00`,
    ];
  }
  return [`${dollars}.${String(remainder).padStart(2, "0")}`];
}

export function isAcceptable(check: CheckItem, raw: string): boolean {
  const parsed = parseEntry(raw);
  if (parsed === null || parsed !== check.cents) return false;
  if (check.wholeDollar) return true;
  const parts = raw.split(".");
  return parts.length === 2 && parts[1]!.length === 2;
}

export function canonicalEntry(check: CheckItem): string {
  return acceptableStrings(check)[0]!;
}
