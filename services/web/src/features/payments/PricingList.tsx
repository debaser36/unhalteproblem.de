import { useAtomValue } from "@effect/atom-react";
import type { CatalogProduct, Price } from "@unhalteproblem.de/api";
import { Option } from "effect";
import { CreditCard, LogIn, Repeat } from "lucide-react";
import { useState } from "react";
import { AsyncView } from "#api/AsyncView.tsx";
import { currentPath, loginUrl, userAtom } from "#api/session.ts";
import { Alert } from "#ui/Alert.tsx";
import { Badge } from "#ui/Badge.tsx";
import { Button } from "#ui/Button.tsx";
import { Card } from "#ui/Card.tsx";
import { EmptyState } from "#ui/EmptyState.tsx";
import { creditLabel, roleLabels } from "./labels.ts";
import { formatPrice } from "./money.ts";
import { catalogAtom, startCheckout } from "./paymentAtoms.ts";
import { useStripeRedirect } from "./useStripeRedirect.ts";

/**
 * The products on offer with their prices; each price starts a Stripe
 * Checkout. Visitors see the prices too, with a login button instead.
 */
export function PricingList() {
  return (
    <AsyncView atom={catalogAtom}>
      {(catalog) =>
        catalog.products.length === 0 ? (
          <EmptyState title="Nothing on offer right now." />
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            {catalog.products.map((product) => (
              <ProductCard key={product.id} product={product} />
            ))}
          </div>
        )
      }
    </AsyncView>
  );
}

function ProductCard({ product }: { readonly product: CatalogProduct }) {
  const [error, setError] = useState<string>();
  return (
    <Card className="flex flex-col p-5">
      <h3 className="font-display text-lg font-semibold text-fg">
        {product.name}
      </h3>
      {Option.isSome(product.description) && (
        <p className="mt-2 text-sm text-fg-soft">{product.description.value}</p>
      )}
      {(product.roles.length > 0 || product.credits.length > 0) && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {product.roles.map((role) => (
            <Badge key={role} tone="accent">
              {roleLabels[role] ?? role}
            </Badge>
          ))}
          {product.credits.map(({ feature, quantity }) => (
            <Badge key={feature} tone="info">
              {creditLabel(feature, quantity)}
            </Badge>
          ))}
        </div>
      )}
      <div className="mt-auto space-y-2 pt-5">
        {product.prices.map((price) => (
          <BuyButton key={price.id} price={price} onError={setError} />
        ))}
        {error !== undefined && (
          <Alert tone="danger" className="mt-2">
            {error}
          </Alert>
        )}
      </div>
    </Card>
  );
}

function BuyButton({
  price,
  onError,
}: {
  readonly price: Price;
  readonly onError: (message: string | undefined) => void;
}) {
  const user = useAtomValue(userAtom);
  const checkout = useStripeRedirect(startCheckout);
  const recurring = Option.isSome(price.recurring);

  if (user === null) {
    return (
      <a
        href={loginUrl(currentPath())}
        className="flex items-center justify-between rounded-lg border border-border-strong bg-surface-2 px-3 py-2 text-sm text-fg hover:border-accent/60"
      >
        <span className="tabular-nums">{formatPrice(price)}</span>
        <span className="inline-flex items-center gap-1.5 text-muted">
          <LogIn size={14} /> Log in to buy
        </span>
      </a>
    );
  }

  return (
    <Button
      className="w-full justify-between"
      variant="secondary"
      loading={checkout.pending}
      icon={recurring ? <Repeat size={15} /> : <CreditCard size={15} />}
      onClick={async () => {
        onError(undefined);
        onError(
          await checkout.go({ payload: { kind: "price", priceId: price.id } }),
        );
      }}
    >
      <span className="tabular-nums">{formatPrice(price)}</span>
      <span>{recurring ? "Subscribe" : "Buy"}</span>
    </Button>
  );
}
