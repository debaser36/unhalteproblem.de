import { useAtomValue } from "@effect/atom-react";
import type { CheckoutRequest, TipOffer } from "@unhalteproblem.de/api";
import { Option } from "effect";
import { Heart, LogIn } from "lucide-react";
import { type FormEvent, useState } from "react";
import { AsyncView } from "#api/AsyncView.tsx";
import { currentPath, loginUrl, userAtom } from "#api/session.ts";
import { Alert } from "#ui/Alert.tsx";
import { Button } from "#ui/Button.tsx";
import { Card } from "#ui/Card.tsx";
import { Field, Input } from "#ui/Field.tsx";
import { formatMoney, parseAmount } from "./money.ts";
import { catalogAtom, startCheckout } from "./paymentAtoms.ts";
import { useStripeRedirect } from "./useStripeRedirect.ts";

/**
 * Tips: the preset amounts of the tip product and a custom amount, each
 * paid once through Stripe Checkout. Renders nothing while no tip product
 * is offered.
 */
export function TipForm() {
  return (
    <AsyncView atom={catalogAtom} loading={null}>
      {(catalog) =>
        Option.match(catalog.tip, {
          onNone: () => null,
          onSome: (tip) => <Tip tip={tip} />,
        })
      }
    </AsyncView>
  );
}

function Tip({ tip }: { readonly tip: TipOffer }) {
  const user = useAtomValue(userAtom);
  const checkout = useStripeRedirect(startCheckout);
  const [custom, setCustom] = useState("");
  const [invalid, setInvalid] = useState<string>();
  const [error, setError] = useState<string>();
  const currency = tip.minimum.currency;

  const pay = async (payload: CheckoutRequest) => {
    setError(undefined);
    // The client types each variant of the payload on its own.
    setError(
      await (payload.kind === "tip"
        ? checkout.go({ payload })
        : checkout.go({ payload })),
    );
  };

  const submitCustom = async (event: FormEvent) => {
    event.preventDefault();
    const amount = parseAmount(custom, currency);
    if (
      amount === undefined ||
      amount < tip.minimum.amount ||
      amount > tip.maximum.amount
    ) {
      setInvalid(
        `Between ${formatMoney(tip.minimum)} and ${formatMoney(tip.maximum)}, please.`,
      );
      return;
    }
    setInvalid(undefined);
    await pay({ kind: "tip", amount });
  };

  return (
    <Card className="p-5">
      <h3 className="flex items-center gap-2 font-display text-lg font-semibold text-fg">
        <Heart size={18} className="text-accent" /> {tip.name}
      </h3>
      <p className="mt-2 text-sm text-fg-soft">
        A one-off tip, if you like what you read here. It unlocks nothing, but
        it is much appreciated.
      </p>
      {user === null ? (
        <a
          href={loginUrl(currentPath())}
          className="mt-4 inline-flex items-center gap-2 text-sm text-accent-2 hover:underline"
        >
          <LogIn size={14} /> Log in to leave a tip
        </a>
      ) : (
        <>
          {tip.presets.length > 0 && (
            <div className="mt-4 flex flex-wrap gap-2">
              {tip.presets.map((preset) => (
                <Button
                  key={preset.id}
                  variant="secondary"
                  disabled={checkout.pending}
                  onClick={() => pay({ kind: "price", priceId: preset.id })}
                >
                  <span className="tabular-nums">
                    {formatMoney(preset.amount)}
                  </span>
                </Button>
              ))}
            </div>
          )}
          <form
            className="mt-4 flex flex-wrap items-end gap-2"
            onSubmit={submitCustom}
            noValidate
          >
            <Field
              label={`Another amount (${currency.toUpperCase()})`}
              hint={`${formatMoney(tip.minimum)} to ${formatMoney(tip.maximum)}`}
              error={invalid}
              className="w-44"
            >
              {(control) => (
                <Input
                  {...control}
                  inputMode="decimal"
                  value={custom}
                  onChange={(event) => setCustom(event.target.value)}
                />
              )}
            </Field>
            <Button
              type="submit"
              loading={checkout.pending}
              icon={<Heart size={15} />}
            >
              Tip
            </Button>
          </form>
        </>
      )}
      {error !== undefined && (
        <Alert tone="danger" className="mt-4">
          {error}
        </Alert>
      )}
    </Card>
  );
}
