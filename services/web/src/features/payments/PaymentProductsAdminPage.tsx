import { useAtomValue } from "@effect/atom-react";
import {
  type AdminProduct,
  type ProductKind,
  PurchasableRole,
} from "@unhalteproblem.de/api";
import { Option } from "effect";
import { ExternalLink, RefreshCw } from "lucide-react";
import { useState } from "react";
import { AsyncView } from "#api/AsyncView.tsx";
import { hasRole, userAtom } from "#api/session.ts";
import { useAction } from "#api/useAction.ts";
import { AdminHeading } from "#features/admin/AdminHeading.tsx";
import { auditKey } from "#features/admin/insightsAtoms.ts";
import { Badge } from "#ui/Badge.tsx";
import { Button } from "#ui/Button.tsx";
import { Card } from "#ui/Card.tsx";
import { EmptyState } from "#ui/EmptyState.tsx";
import { Select } from "#ui/Field.tsx";
import { formatPrice } from "./money.ts";
import { dashboardUrl, roleLabels } from "./labels.ts";
import {
  adminProductsAtom,
  adminProductsKey,
  catalogKey,
  setPaymentProductRoles,
  syncPaymentProducts,
  updatePaymentProduct,
} from "./paymentAtoms.ts";

const productErrors = {
  PaymentProductNotFound: "The product is gone. Sync the catalog.",
  ProductKindConflict:
    "There is one tip product, and it grants no roles: change the other one first.",
  PaymentsUnavailable: "Stripe is not configured.",
  PaymentProviderFailed: "Stripe could not be reached. Try again.",
};

/**
 * The catalog for admins: products and prices are made in the Stripe
 * dashboard and mirrored here; this decides which are offered, which one
 * is the tip product, and (superAdmins) which roles each grants.
 */
export function PaymentProductsAdminPage() {
  const sync = useAction(syncPaymentProducts, {
    success: "Catalog synced from Stripe.",
    errors: productErrors,
  });
  return (
    <>
      <AdminHeading
        title="Products"
        actions={
          <Button
            variant="secondary"
            icon={<RefreshCw size={15} />}
            loading={sync.pending}
            onClick={() =>
              sync.run({
                reactivityKeys: [adminProductsKey, catalogKey, auditKey],
              })
            }
          >
            Sync from Stripe
          </Button>
        }
      >
        Create products and prices in the Stripe dashboard; they appear here
        with every change (or after a sync). Nothing is offered until it is
        enabled.
      </AdminHeading>
      <AsyncView atom={adminProductsAtom}>
        {(products) =>
          products.length === 0 ? (
            <EmptyState title="No products yet. Create one in Stripe, then sync." />
          ) : (
            <div className="space-y-3">
              {products.map((product) => (
                <ProductCard key={product.id} product={product} />
              ))}
            </div>
          )
        }
      </AsyncView>
    </>
  );
}

function ProductCard({ product }: { readonly product: AdminProduct }) {
  const me = useAtomValue(userAtom);
  const update = useAction(updatePaymentProduct, {
    success: "Product updated.",
    errors: productErrors,
  });
  const setRoles = useAction(setPaymentProductRoles, {
    success: "Roles updated.",
    errors: productErrors,
  });
  const [pendingRoles, setPendingRoles] = useState(product.roles);
  const keys = [adminProductsKey, catalogKey, auditKey];

  const save = (change: {
    readonly enabled?: boolean;
    readonly kind?: ProductKind;
  }) =>
    update.run({
      params: { productId: product.id },
      payload: {
        enabled: change.enabled ?? product.enabled,
        kind: change.kind ?? product.kind,
      },
      reactivityKeys: keys,
    });

  const rolesChanged =
    [...pendingRoles].sort().join() !== [...product.roles].sort().join();

  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="flex flex-wrap items-center gap-2 font-medium text-fg">
            {product.name}
            {!product.active && (
              <Badge tone="neutral">archived in Stripe</Badge>
            )}
            {product.kind === "tip" && <Badge tone="info">tip</Badge>}
            {product.enabled ? (
              <Badge tone="accent">offered</Badge>
            ) : (
              <Badge tone="neutral">not offered</Badge>
            )}
          </p>
          {Option.isSome(product.description) && (
            <p className="mt-1 text-sm text-fg-soft">
              {product.description.value}
            </p>
          )}
        </div>
        <a
          href={dashboardUrl(product.livemode, `products/${product.id}`)}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1.5 text-xs text-muted hover:text-fg"
        >
          <ExternalLink size={13} /> Stripe
        </a>
      </div>

      <ul className="mt-3 flex flex-wrap gap-2 text-sm">
        {product.prices.length === 0 && (
          <li className="text-muted">No prices with a fixed amount.</li>
        )}
        {product.prices.map((price) => (
          <li
            key={price.id}
            className={`rounded-md border border-border px-2 py-1 tabular-nums ${price.active ? "text-fg" : "text-muted line-through"}`}
          >
            {formatPrice(price)}
          </li>
        ))}
      </ul>

      <div className="mt-4 flex flex-wrap items-center gap-4 text-sm">
        <label className="inline-flex items-center gap-2 text-fg">
          <input
            type="checkbox"
            checked={product.enabled}
            disabled={update.pending || (!product.active && !product.enabled)}
            onChange={(event) => save({ enabled: event.target.checked })}
          />
          Offer on the site
        </label>
        <label className="inline-flex items-center gap-2 text-fg-soft">
          kind
          <Select
            className="h-8 w-32"
            value={product.kind}
            disabled={update.pending}
            onChange={(event) =>
              save({ kind: event.target.value as ProductKind })
            }
          >
            <option value="standard">standard</option>
            <option value="tip">tip</option>
          </Select>
        </label>
      </div>

      {product.kind === "standard" && (
        <div className="mt-4 border-t border-border/60 pt-4">
          <p className="font-mono text-xs text-muted uppercase">
            grants while paid
          </p>
          {hasRole(me, "superAdmin") ? (
            <div className="mt-2 flex flex-wrap items-center gap-3 text-sm">
              {PurchasableRole.literals.map((role) => (
                <label key={role} className="inline-flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={pendingRoles.includes(role)}
                    onChange={(event) =>
                      setPendingRoles((roles) =>
                        event.target.checked
                          ? [...roles, role]
                          : roles.filter((other) => other !== role),
                      )
                    }
                  />
                  {roleLabels[role] ?? role}
                </label>
              ))}
              <Button
                size="sm"
                variant="secondary"
                disabled={!rolesChanged}
                loading={setRoles.pending}
                onClick={() =>
                  setRoles.run({
                    params: { productId: product.id },
                    payload: { roles: pendingRoles },
                    reactivityKeys: keys,
                  })
                }
              >
                Save roles
              </Button>
            </div>
          ) : (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {product.roles.length === 0 && (
                <span className="text-sm text-muted">nothing</span>
              )}
              {product.roles.map((role) => (
                <Badge key={role} tone="accent">
                  {roleLabels[role] ?? role}
                </Badge>
              ))}
              <span className="text-xs text-muted">
                (superAdmins change these)
              </span>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}
