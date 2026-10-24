import { assert, describe, it } from "@effect/vitest";
import type { PaymentId } from "@unhalteproblem.de/api";
import { DateTime } from "effect";
import {
  type CreditPurchase,
  changedOffers,
  creditsOfPurchase,
  featureRoles,
  offerAt,
  type ProductCreditOffer,
  rolesOfFeatures,
} from "./Credit.ts";

const paymentId = crypto.randomUUID() as PaymentId;

const purchase = (overrides: Partial<CreditPurchase> = {}): CreditPurchase => ({
  paymentId,
  grantsAccess: true,
  createdAt: DateTime.makeUnsafe("2026-03-01T00:00:00Z"),
  offers: [],
  ...overrides,
});

describe("featureRoles", () => {
  it("gives meal plan credits the mealPlanBuyer role", () => {
    assert.strictEqual(featureRoles.mealPlan, "mealPlanBuyer");
  });
});

describe("rolesOfFeatures", () => {
  it("is empty without features", () => {
    assert.deepStrictEqual(rolesOfFeatures([]), []);
  });

  it("maps a feature to its role", () => {
    assert.deepStrictEqual(rolesOfFeatures(["mealPlan"]), ["mealPlanBuyer"]);
  });

  it("leaves out duplicates", () => {
    assert.deepStrictEqual(rolesOfFeatures(["mealPlan", "mealPlan"]), [
      "mealPlanBuyer",
    ]);
  });
});

describe("creditsOfPurchase", () => {
  const since = (iso: string) => DateTime.makeUnsafe(iso);

  it("grants what the product offered when the purchase was made", () => {
    assert.deepStrictEqual(
      creditsOfPurchase(
        purchase({
          offers: [
            {
              feature: "mealPlan",
              quantity: 3,
              since: since("2026-01-01T00:00:00Z"),
            },
          ],
        }),
      ),
      [{ feature: "mealPlan", quantity: 3 }],
    );
  });

  it("grants nothing for a product without offers", () => {
    assert.deepStrictEqual(creditsOfPurchase(purchase()), []);
  });

  it("ignores offers that took effect after the purchase", () => {
    assert.deepStrictEqual(
      creditsOfPurchase(
        purchase({
          offers: [
            {
              feature: "mealPlan",
              quantity: 3,
              since: since("2026-03-01T00:00:01Z"),
            },
          ],
        }),
      ),
      [],
    );
  });

  it("counts an offer that took effect at the very moment of the purchase", () => {
    assert.deepStrictEqual(
      creditsOfPurchase(
        purchase({
          offers: [
            {
              feature: "mealPlan",
              quantity: 2,
              since: since("2026-03-01T00:00:00Z"),
            },
          ],
        }),
      ),
      [{ feature: "mealPlan", quantity: 2 }],
    );
  });

  it("keeps only the offers that already applied", () => {
    assert.deepStrictEqual(
      creditsOfPurchase(
        purchase({
          offers: [
            {
              feature: "mealPlan",
              quantity: 5,
              since: since("2026-02-01T00:00:00Z"),
            },
            {
              feature: "mealPlan",
              quantity: 9,
              since: since("2027-01-01T00:00:00Z"),
            },
          ],
        }),
      ),
      [{ feature: "mealPlan", quantity: 5 }],
    );
  });
});

describe("offerAt", () => {
  const at = (iso: string) => DateTime.makeUnsafe(iso);
  const version = (iso: string, quantity: number): ProductCreditOffer => ({
    feature: "mealPlan",
    quantity,
    since: at(iso),
  });

  it("is empty without versions", () => {
    assert.deepStrictEqual(offerAt([], at("2026-01-01T00:00:00Z")), []);
  });

  it("is empty before the first version", () => {
    assert.deepStrictEqual(
      offerAt([version("2026-02-01T00:00:00Z", 3)], at("2026-01-01T00:00:00Z")),
      [],
    );
  });

  it("takes the version that started exactly then", () => {
    assert.deepStrictEqual(
      offerAt([version("2026-02-01T00:00:00Z", 3)], at("2026-02-01T00:00:00Z")),
      [{ feature: "mealPlan", quantity: 3 }],
    );
  });

  it("takes the newest version not after the time, whatever the order", () => {
    const versions = [
      version("2026-03-01T00:00:00Z", 7),
      version("2026-01-01T00:00:00Z", 3),
      version("2026-02-01T00:00:00Z", 5),
    ];
    assert.deepStrictEqual(offerAt(versions, at("2026-02-15T00:00:00Z")), [
      { feature: "mealPlan", quantity: 5 },
    ]);
    assert.deepStrictEqual(offerAt(versions, at("2026-12-01T00:00:00Z")), [
      { feature: "mealPlan", quantity: 7 },
    ]);
    assert.deepStrictEqual(offerAt(versions, at("2026-01-15T00:00:00Z")), [
      { feature: "mealPlan", quantity: 3 },
    ]);
  });

  it("grants nothing once the newest version has quantity 0", () => {
    const versions = [
      version("2026-01-01T00:00:00Z", 3),
      version("2026-02-01T00:00:00Z", 0),
    ];
    assert.deepStrictEqual(offerAt(versions, at("2026-03-01T00:00:00Z")), []);
    // Before the removal it still grants.
    assert.deepStrictEqual(offerAt(versions, at("2026-01-15T00:00:00Z")), [
      { feature: "mealPlan", quantity: 3 },
    ]);
  });

  it("grants again after a removal is undone", () => {
    const versions = [
      version("2026-01-01T00:00:00Z", 3),
      version("2026-02-01T00:00:00Z", 0),
      version("2026-03-01T00:00:00Z", 2),
    ];
    assert.deepStrictEqual(offerAt(versions, at("2026-04-01T00:00:00Z")), [
      { feature: "mealPlan", quantity: 2 },
    ]);
  });
});

describe("changedOffers", () => {
  const plans = (quantity: number) => ({
    feature: "mealPlan" as const,
    quantity,
  });

  it("needs nothing when nothing changes", () => {
    assert.deepStrictEqual(changedOffers([], []), []);
    assert.deepStrictEqual(changedOffers([plans(3)], [plans(3)]), []);
  });

  it("adds a feature that is new", () => {
    assert.deepStrictEqual(changedOffers([], [plans(3)]), [plans(3)]);
  });

  it("changes a quantity", () => {
    assert.deepStrictEqual(changedOffers([plans(3)], [plans(5)]), [plans(5)]);
  });

  it("removes a feature with quantity 0", () => {
    assert.deepStrictEqual(changedOffers([plans(3)], []), [plans(0)]);
  });
});

describe("creditsOfPurchase with versions", () => {
  const at = (iso: string) => DateTime.makeUnsafe(iso);
  const versions: ReadonlyArray<ProductCreditOffer> = [
    { feature: "mealPlan", quantity: 3, since: at("2026-01-01T00:00:00Z") },
    { feature: "mealPlan", quantity: 0, since: at("2026-02-01T00:00:00Z") },
  ];

  it("gives a purchase started before a removal its credits", () => {
    assert.deepStrictEqual(
      creditsOfPurchase(
        purchase({ createdAt: at("2026-01-20T00:00:00Z"), offers: versions }),
      ),
      [{ feature: "mealPlan", quantity: 3 }],
    );
  });

  it("gives a purchase started after a removal nothing", () => {
    assert.deepStrictEqual(
      creditsOfPurchase(
        purchase({ createdAt: at("2026-02-01T00:00:00Z"), offers: versions }),
      ),
      [],
    );
  });
});
