import {
  Catalog,
  PaymentsUnavailable,
  TipAmountOutOfRange,
} from "@unhalteproblem.de/api";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { decode } from "#testing/fixtures.ts";
import { fakeApi } from "#testing/FakeApi.ts";
import { renderWithApi } from "#testing/render.tsx";
import { TipForm } from "./TipForm.tsx";

const eur = (amount: number) => ({ amount, currency: "eur" });

const catalog = decode(Catalog)({
  products: [],
  tip: {
    productId: "prod_tip",
    name: "Buy me a coffee",
    presets: [{ id: "price_coffee", amount: eur(300), recurring: null }],
    minimum: eur(100),
    maximum: eur(50000),
  },
});

const withCatalog = (
  startCheckout: () => Effect.Effect<
    never,
    TipAmountOutOfRange | PaymentsUnavailable
  >,
) =>
  fakeApi(
    {
      paymentCatalog: { getCatalog: () => Effect.succeed(catalog) },
      payments: { startCheckout },
    },
    { roles: ["normalUser"] },
  );

describe("TipForm", () => {
  it("renders nothing without a tip product", async () => {
    const { screen } = await renderWithApi(
      <TipForm />,
      fakeApi({
        paymentCatalog: {
          getCatalog: () =>
            Effect.succeed(decode(Catalog)({ products: [], tip: null })),
        },
      }),
    );

    await expect
      .element(screen.getByText("Buy me a coffee"))
      .not.toBeInTheDocument();
  });

  it("asks anonymous visitors to log in first", async () => {
    const { screen } = await renderWithApi(
      <TipForm />,
      fakeApi({
        paymentCatalog: { getCatalog: () => Effect.succeed(catalog) },
      }),
    );

    await expect
      .element(screen.getByRole("link", { name: "Log in to leave a tip" }))
      .toBeVisible();
  });

  it("checks a custom amount against the limits before asking Stripe", async () => {
    const api = withCatalog(() => Effect.fail(new PaymentsUnavailable()));
    const { screen } = await renderWithApi(<TipForm />, api);

    await screen.getByLabelText("Another amount (EUR)").fill("0,50");
    await screen.getByRole("button", { name: "Tip" }).click();

    await expect
      .element(screen.getByText(/^Between .* please\.$/))
      .toBeVisible();
    expect(api.callsTo("payments", "startCheckout")).toEqual([]);
  });

  it("sends a custom amount in cents and shows why it failed", async () => {
    const api = withCatalog(() =>
      Effect.fail(
        new TipAmountOutOfRange({ minimum: eur(100), maximum: eur(50000) }),
      ),
    );
    const { screen } = await renderWithApi(<TipForm />, api);

    await screen.getByLabelText("Another amount (EUR)").fill("12,50");
    await screen.getByRole("button", { name: "Tip" }).click();

    await expect
      .element(screen.getByText("Please choose an amount within the limits."))
      .toBeVisible();
    expect(api.callsTo("payments", "startCheckout")).toEqual([
      { payload: { kind: "tip", amount: 1250 } },
    ]);
  });

  it("pays a preset by its price", async () => {
    const api = withCatalog(() => Effect.fail(new PaymentsUnavailable()));
    const { screen } = await renderWithApi(<TipForm />, api);

    await screen.getByRole("button", { name: /3[.,]00/ }).click();

    await expect
      .element(screen.getByText("Payments are not available right now."))
      .toBeVisible();
    expect(api.callsTo("payments", "startCheckout")).toEqual([
      { payload: { kind: "price", priceId: "price_coffee" } },
    ]);
  });
});
