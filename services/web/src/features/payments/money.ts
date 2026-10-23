import type { PaymentMoney, Price } from "@unhalteproblem.de/api";
import { Option } from "effect";

// Amounts come in the currency's minor unit (cents), as Stripe counts them.
// Intl knows how many minor digits each currency has (EUR 2, JPY 0).

const formats = new Map<string, Intl.NumberFormat>();

const formatOf = (currency: string): Intl.NumberFormat => {
  const key = currency.toUpperCase();
  let format = formats.get(key);
  if (format === undefined) {
    format = new Intl.NumberFormat("en", { style: "currency", currency: key });
    formats.set(key, format);
  }
  return format;
};

/** How many minor units make one unit of the currency (100 for EUR). */
export const minorUnitsPerUnit = (currency: string): number =>
  10 ** (formatOf(currency).resolvedOptions().maximumFractionDigits ?? 2);

/** `€5.00` */
export const formatMoney = (money: PaymentMoney): string =>
  formatOf(money.currency).format(
    money.amount / minorUnitsPerUnit(money.currency),
  );

/** `€5.00`, `€5.00 / month`, `€15.00 every 3 months` */
export const formatPrice = (price: Price): string => {
  const amount = formatMoney(price.amount);
  return Option.match(price.recurring, {
    onNone: () => amount,
    onSome: ({ interval, intervalCount }) =>
      intervalCount === 1
        ? `${amount} / ${interval}`
        : `${amount} every ${intervalCount} ${interval}s`,
  });
};

/**
 * An amount typed by a person (`5`, `5.5`, `5,50`) in minor units, or
 * `undefined` if it is not a positive amount with at most the currency's
 * minor digits.
 */
export const parseAmount = (
  input: string,
  currency: string,
): number | undefined => {
  const digits = Math.round(Math.log10(minorUnitsPerUnit(currency)));
  const pattern =
    digits === 0
      ? /^\d+$/u
      : new RegExp(`^\\d+(?:[.,]\\d{1,${digits}})?$`, "u");
  const text = input.trim();
  if (!pattern.test(text)) return undefined;
  const [whole = "0", fraction = ""] = text.split(/[.,]/u);
  const minor =
    Number(whole) * 10 ** digits + Number(fraction.padEnd(digits, "0") || "0");
  return Number.isSafeInteger(minor) && minor > 0 ? minor : undefined;
};
