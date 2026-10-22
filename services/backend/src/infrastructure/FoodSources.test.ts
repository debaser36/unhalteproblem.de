import { assert, describe, it } from "@effect/vitest";
import { productOf, quantityOfText, searchWords } from "./OpenFoodFacts.ts";
import { locationOf, priceOf } from "./OpenPrices.ts";
import { csvFields, latestAveragePrices, releaseUrl } from "./StatsNz.ts";

// What the food planner reads from its sources, on lines and records shaped
// like the real ones.

describe("Stats NZ", () => {
  const group =
    "Food Price Index Selected Monthly Weighted Average Prices for New Zealand";
  const csv = [
    '"Series_reference","Period","Data_value","STATUS","UNITS","Subject","Group","Series_title_1","Series_title_2","Series_title_3"',
    '"CPIM.SE901","2026.09",1234.5,"FINAL","Index","Consumers Price Index - CPI","Food Price Index Level 1 Groups for New Zealand Monthly","Food",NA,NA',
    `"CPIM.SAP0101","2026.08",3.99,"FINAL","Dollars","Consumers Price Index - CPI","${group}","Bananas, 1kg",NA,NA`,
    `"CPIM.SAP0101","2026.09",4.06,"FINAL","Dollars","Consumers Price Index - CPI","${group}","Bananas, 1kg",NA,NA`,
    `"CPIM.SAP0100","2026.09",4.45,"FINAL","Dollars","Consumers Price Index - CPI","${group}","Oranges, 1kg",NA,NA`,
    `"CPIM.SAP0102","2026.09",,"FINAL","Dollars","Consumers Price Index - CPI","${group}","Apples, 1kg",NA,NA`,
  ].join("\r\n");

  it("splits quoted CSV fields", () => {
    assert.deepStrictEqual(csvFields('"a, b",1,"say ""hi""",NA'), [
      "a, b",
      "1",
      'say "hi"',
      "NA",
    ]);
  });

  it("keeps the newest month of every average price, nothing else", () => {
    assert.deepStrictEqual(latestAveragePrices(csv), [
      {
        series: "CPIM.SAP0100",
        title: "Oranges, 1kg",
        month: "2026-09",
        price: 4.45,
      },
      {
        series: "CPIM.SAP0101",
        title: "Bananas, 1kg",
        month: "2026-09",
        price: 4.06,
      },
    ]);
  });

  it("knows where a month's release is", () => {
    assert.strictEqual(
      releaseUrl(2026, 9),
      "https://www.stats.govt.nz/assets/Uploads/Selected-price-indexes/" +
        "Selected-price-indexes-September-2026/Download-data/" +
        "selected-price-indexes-september-2026.csv",
    );
  });
});

describe("Open Prices", () => {
  const location = {
    id: 2343,
    osm_name: "Alnatura Super Natur Markt",
    osm_brand: "Alnatura",
    osm_address_city: "Neusäß",
    osm_address_country_code: "DE",
  };
  const locations = new Map([[2343, locationOf(location, "DE")!]]);
  const filter = { currency: "EUR", since: "2025-10-22", locations };
  const category = {
    id: 43283,
    type: "CATEGORY",
    product_code: null,
    category_tag: "en:broccoli",
    price: "3.900",
    price_is_discounted: false,
    price_per: "KILOGRAM",
    currency: "EUR",
    location_id: 2343,
    date: "2026-03-28",
    duplicate_of: null,
  };
  const product = {
    ...category,
    id: 42629,
    type: "PRODUCT",
    product_code: "4047247192637",
    category_tag: null,
    price: "1.250",
    price_is_discounted: true,
    price_per: null,
  };

  it("reads locations of the country, with the brand as name", () => {
    assert.deepStrictEqual(locationOf(location, "DE"), {
      id: 2343,
      name: "Alnatura",
      city: "Neusäß",
    });
    assert.isUndefined(locationOf(location, "NZ"));
    assert.isUndefined(locationOf("nonsense", "DE"));
  });

  it("reads category and product prices", () => {
    assert.deepStrictEqual(priceOf(category, filter), {
      id: 43283,
      code: null,
      category: "en:broccoli",
      price: 3.9,
      discounted: false,
      per: "kilogram",
      currency: "EUR",
      date: "2026-03-28",
      location: { id: 2343, name: "Alnatura", city: "Neusäß" },
    });
    const read = priceOf(product, filter);
    assert.strictEqual(read?.code, "4047247192637");
    assert.strictEqual(read?.price, 1.25);
    assert.isTrue(read?.discounted);
    assert.isNull(read?.per);
  });

  it("skips other currencies, shops, old prices and duplicates", () => {
    assert.isUndefined(priceOf({ ...category, currency: "NZD" }, filter));
    assert.isUndefined(priceOf({ ...category, location_id: 1 }, filter));
    assert.isUndefined(priceOf({ ...category, date: "2024-10-28" }, filter));
    assert.isUndefined(priceOf({ ...category, duplicate_of: 7 }, filter));
  });

  it("skips implausible prices and records without a product or category", () => {
    assert.isUndefined(priceOf({ ...category, price: "0" }, filter));
    assert.isUndefined(priceOf({ ...category, price: "1500" }, filter));
    assert.isUndefined(priceOf({ ...category, price: "abc" }, filter));
    assert.isUndefined(
      priceOf({ ...product, product_code: "not a code" }, filter),
    );
    assert.isUndefined(
      priceOf({ ...category, category_tag: "broccoli" }, filter),
    );
  });
});

describe("Open Food Facts", () => {
  const record = {
    code: "4047247192637",
    product_name: "  Walnusskerne   naturbelassen ",
    brands: "Trader Joe's, Aldi",
    product_quantity: "0.5",
    product_quantity_unit: "kg",
    categories_tags: ["en:nuts", "en:walnuts"],
    labels_tags: [],
    ingredients_analysis_tags: ["en:vegan", "en:vegetarian"],
    ingredients_tags: ["en:walnut"],
    allergens_tags: ["en:nuts", 7, ""],
  };

  it("reads a product leniently", () => {
    assert.deepStrictEqual(productOf(record), {
      code: "4047247192637",
      name: "Walnusskerne naturbelassen",
      brand: "Trader Joe's",
      quantity: { amount: 500, unit: "g" },
      categories: ["en:nuts", "en:walnuts"],
      labels: [],
      ingredientsAnalysis: ["en:vegan", "en:vegetarian"],
      ingredients: ["en:walnut"],
      allergens: ["en:nuts"],
    });
  });

  it("converts litres and leaves unknown units out", () => {
    assert.deepStrictEqual(
      productOf({
        ...record,
        product_quantity: 1.5,
        product_quantity_unit: "L",
      })?.quantity,
      { amount: 1500, unit: "ml" },
    );
    assert.isNull(
      productOf({ ...record, product_quantity_unit: "oz" })?.quantity,
    );
    assert.isNull(productOf({ ...record, product_quantity: 0 })?.quantity);
  });

  it("reads the package from the free-text quantity", () => {
    assert.deepStrictEqual(
      productOf({ ...record, product_quantity: undefined, quantity: "500g" })
        ?.quantity,
      { amount: 500, unit: "g" },
    );
    assert.deepStrictEqual(quantityOfText("1,5 l"), {
      amount: 1500,
      unit: "ml",
    });
    assert.deepStrictEqual(quantityOfText("6 x 125 g"), {
      amount: 750,
      unit: "g",
    });
    assert.deepStrictEqual(quantityOfText("10 Stück"), {
      amount: 10,
      unit: "piece",
    });
    assert.isNull(quantityOfText("ca. 2 Portionen"));
    assert.isNull(quantityOfText(42));
  });

  it("drops records without a barcode or name", () => {
    assert.isUndefined(productOf({ ...record, code: "abc" }));
    assert.isUndefined(productOf({ ...record, product_name: "  " }));
    assert.isUndefined(productOf(null));
  });

  it("keeps only words of a search term", () => {
    assert.strictEqual(searchWords("Haferflocken"), "Haferflocken");
    assert.strictEqual(searchWords('code:(1 OR 2) AND "x"'), "code 1 2 x");
    assert.strictEqual(searchWords("crème fraîche*"), "crème fraîche");
    assert.strictEqual(searchWords("::"), "");
  });
});
