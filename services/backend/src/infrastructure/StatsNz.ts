import { Context, DateTime, Duration, Effect, Layer, Schema } from "effect";
import { FetchHttpClient, HttpClient, HttpClientRequest } from "effect/http";
import { userAgent } from "./OpenFoodFacts.ts";

/**
 * Stats NZ did not deliver its price data. `reason` is a short code
 * (`download:503`, `noRelease`, `timeout`) for logs and the import's error;
 * never a response body.
 */
export class StatsNzFailed extends Schema.TaggedError<
  StatsNzFailed,
  { readonly brand: unique symbol }
>()("StatsNzFailed", { reason: Schema.String }) {
  override get message() {
    return `Stats NZ download failed (${this.reason})`;
  }
}

/** One item of the "Selected Monthly Weighted Average Prices" table. */
export interface AveragePrice {
  /** The series, e.g. `CPIM.SAP0101`. */
  readonly series: string;
  /** What was priced, with its quantity, e.g. `Bananas, 1kg`. */
  readonly title: string;
  /** The month, as `YYYY-MM`. */
  readonly month: string;
  /** In NZD, for the quantity in the title. */
  readonly price: number;
}

/** The group of the average prices in the release's CSV. */
const averagePricesGroup =
  "Food Price Index Selected Monthly Weighted Average Prices for New Zealand";

/**
 * The fields of one CSV line: separated by commas, quoted with `"` when
 * they contain one, `""` inside quotes for a quote.
 */
export const csvFields = (line: string): ReadonlyArray<string> => {
  const fields: Array<string> = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (quoted) {
      if (char === '"' && line[i + 1] === '"') {
        field += '"';
        i++;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      fields.push(field);
      field = "";
    } else {
      field += char;
    }
  }
  fields.push(field);
  return fields;
};

/**
 * The newest price of every average-price series in a release's CSV
 * (`Series_reference,Period,Data_value,STATUS,UNITS,Subject,Group,
 * Series_title_1,...`). The file holds every month since the 1960s; rows
 * of other groups (the indexes) and without a value are skipped.
 */
export const latestAveragePrices = (
  csv: string,
): ReadonlyArray<AveragePrice> => {
  const latest = new Map<string, AveragePrice>();
  for (const line of csv.split(/\r?\n/u)) {
    if (!line.includes(averagePricesGroup)) continue;
    const [series, period, value, , units, , group, title] = csvFields(line);
    if (
      group !== averagePricesGroup ||
      units !== "Dollars" ||
      series === undefined ||
      title === undefined ||
      title === "" ||
      period === undefined
    ) {
      continue;
    }
    const price = Number(value);
    const month = /^(\d{4})\.(\d{2})$/u.exec(period);
    if (!Number.isFinite(price) || price <= 0 || month === null) continue;
    const entry = { series, title, month: `${month[1]}-${month[2]}`, price };
    const known = latest.get(series);
    if (known === undefined || known.month < entry.month) {
      latest.set(series, entry);
    }
  }
  return [...latest.values()].sort((a, b) => a.series.localeCompare(b.series));
};

const monthNames = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

/**
 * Where Stats NZ publishes the CSV of the "Selected price indexes" release
 * for a month (`year`, `month` 1 to 12). The release comes out in the
 * middle of the following month.
 */
export const releaseUrl = (year: number, month: number): string => {
  const name = `${monthNames[month - 1]}-${year}`;
  return (
    "https://www.stats.govt.nz/assets/Uploads/Selected-price-indexes/" +
    `Selected-price-indexes-${name}/Download-data/` +
    `selected-price-indexes-${name.toLowerCase()}.csv`
  );
};

/** How many months back to look for the newest release. */
const monthsBack = 4;
const timeout = Duration.minutes(2);

const make = Effect.gen(function* () {
  const http = yield* HttpClient.HttpClient;

  // 404 means "not published yet" (or renamed): try the month before.
  const download = (url: string) =>
    Effect.gen(function* () {
      const response = yield* http.execute(
        HttpClientRequest.get(url).pipe(
          HttpClientRequest.setHeader("user-agent", userAgent),
        ),
      );
      if (response.status === 404) return undefined;
      if (response.status !== 200) {
        return yield* new StatsNzFailed({
          reason: `download:${response.status}`,
        });
      }
      return yield* response.text;
    }).pipe(
      Effect.catchTag("HttpClientError", () =>
        Effect.fail(new StatsNzFailed({ reason: "transport" })),
      ),
    );

  return StatsNz.of({
    latestAveragePrices: Effect.gen(function* () {
      const now = yield* DateTime.now;
      const parts = DateTime.toPartsUtc(now);
      for (let back = 1; back <= monthsBack; back++) {
        const index = parts.year * 12 + (parts.month - 1) - back;
        const csv = yield* download(
          releaseUrl(Math.floor(index / 12), (index % 12) + 1),
        );
        if (csv !== undefined) return latestAveragePrices(csv);
      }
      return yield* new StatsNzFailed({ reason: "noRelease" });
    }).pipe(
      Effect.timeoutOrElse({
        duration: timeout,
        orElse: () => Effect.fail(new StatsNzFailed({ reason: "timeout" })),
      }),
      Effect.withSpan("StatsNz.latestAveragePrices"),
    ),
  });
});

/**
 * Stats NZ's "Selected Monthly Weighted Average Prices for New Zealand":
 * about 150 food items, monthly, CC BY 4.0. Indicative prices (an average
 * over supermarkets and other retailers in 12 urban areas), not what one
 * shop charges.
 */
export class StatsNz extends Context.Service<
  StatsNz,
  {
    /** The newest month's average price of every item. */
    readonly latestAveragePrices: Effect.Effect<
      ReadonlyArray<AveragePrice>,
      StatsNzFailed
    >;
  }
>()("@unhalteproblem.de/backend/StatsNz") {
  /** Over `fetch`. */
  static readonly layer = Layer.effect(StatsNz, make).pipe(
    Layer.provide(FetchHttpClient.layer),
  );
}
