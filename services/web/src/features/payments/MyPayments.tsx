import type { Payment, Subscription } from "@unhalteproblem.de/api";
import { Option } from "effect";
import { CreditCard } from "lucide-react";
import { useState } from "react";
import { useSearchParams } from "react-router";
import { AsyncView } from "#api/AsyncView.tsx";
import { formatDate } from "#lib/format.ts";
import { Alert } from "#ui/Alert.tsx";
import { Badge } from "#ui/Badge.tsx";
import {
  creditLabel,
  paymentTone,
  statusLabel,
  subscriptionTone,
} from "./labels.ts";
import { Button } from "#ui/Button.tsx";
import { Card } from "#ui/Card.tsx";
import { Table, Td, Th } from "#ui/Table.tsx";
import { formatMoney, formatPrice } from "./money.ts";
import { myPaymentsAtom, openBillingPortal } from "./paymentAtoms.ts";
import { useStripeRedirect } from "./useStripeRedirect.ts";

/**
 * The logged-in user's credits, subscriptions and payments, with a button to
 * Stripe's customer portal (cancel, change card, invoices). Also says how
 * a Checkout ended when Stripe sent the browser back with `?checkout=…`.
 */
export function MyPayments() {
  return (
    <div className="space-y-4">
      <CheckoutNotice />
      <AsyncView atom={myPaymentsAtom}>
        {(mine) =>
          mine.subscriptions.length === 0 && mine.payments.length === 0 ? (
            <p className="text-sm text-muted">No payments yet.</p>
          ) : (
            <>
              {mine.credits.length > 0 && (
                <Card className="flex flex-wrap gap-x-6 gap-y-2 p-4 text-sm">
                  {mine.credits.map((balance) => (
                    <p key={balance.feature} className="text-fg">
                      <span className="font-medium">
                        {creditLabel(balance.feature, balance.available)}
                      </span>{" "}
                      left
                      {balance.used > 0 && (
                        <span className="text-muted">
                          {" "}
                          · {balance.used} used
                        </span>
                      )}
                    </p>
                  ))}
                </Card>
              )}
              {mine.subscriptions.length > 0 && (
                <div className="space-y-3">
                  {mine.subscriptions.map((subscription) => (
                    <SubscriptionCard
                      key={subscription.id}
                      subscription={subscription}
                    />
                  ))}
                </div>
              )}
              {mine.payments.length > 0 && (
                <PaymentTable payments={mine.payments} />
              )}
              <ManageBillingButton />
            </>
          )
        }
      </AsyncView>
    </div>
  );
}

function CheckoutNotice() {
  const [search] = useSearchParams();
  switch (search.get("checkout")) {
    case "success":
      return (
        <Alert tone="success" title="Thank you!">
          Your payment went through. Anything it unlocks is yours as soon as
          Stripe confirms it, usually within a few seconds.
        </Alert>
      );
    case "cancelled":
      return (
        <Alert tone="info">
          The checkout was cancelled; nothing was charged.
        </Alert>
      );
    default:
      return null;
  }
}

function SubscriptionCard({
  subscription,
}: {
  readonly subscription: Subscription;
}) {
  const name = Option.match(subscription.product, {
    onNone: () => "Subscription",
    onSome: (product) => product.name,
  });
  const periodEnd = Option.map(subscription.currentPeriodEnd, formatDate);
  return (
    <Card className="flex flex-wrap items-center justify-between gap-3 p-4">
      <div>
        <p className="font-medium text-fg">{name}</p>
        <p className="text-sm text-muted">
          {Option.match(subscription.price, {
            onNone: () => null,
            onSome: formatPrice,
          })}
          {Option.isSome(periodEnd) &&
            (subscription.status === "active" ||
              subscription.status === "trialing") &&
            (subscription.cancelAtPeriodEnd
              ? ` · ends ${periodEnd.value}`
              : ` · renews ${periodEnd.value}`)}
        </p>
      </div>
      <Badge tone={subscriptionTone[subscription.status]}>
        {statusLabel(subscription.status)}
      </Badge>
      {subscription.status === "pastDue" && (
        <p className="w-full text-sm text-danger">
          The last payment failed, so its access is paused. Update your payment
          method to continue.
        </p>
      )}
    </Card>
  );
}

function PaymentTable({
  payments,
}: {
  readonly payments: ReadonlyArray<Payment>;
}) {
  return (
    <Table className="min-w-[32rem]">
      <thead>
        <tr>
          <Th>date</Th>
          <Th>for</Th>
          <Th className="text-right">amount</Th>
          <Th>status</Th>
        </tr>
      </thead>
      <tbody>
        {payments.map((payment) => (
          <tr key={payment.id}>
            <Td className="whitespace-nowrap">
              {formatDate(payment.createdAt)}
            </Td>
            <Td>
              {payment.kind === "tip"
                ? "Tip"
                : Option.match(payment.product, {
                    onNone: () => "—",
                    onSome: (product) => product.name,
                  })}
            </Td>
            <Td className="text-right tabular-nums">
              {formatMoney(payment.amount)}
            </Td>
            <Td>
              <Badge tone={paymentTone[payment.status]}>
                {statusLabel(payment.status)}
              </Badge>
            </Td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}

/** Opens Stripe's customer portal for the logged-in user. */
export function ManageBillingButton() {
  const portal = useStripeRedirect(openBillingPortal);
  const [error, setError] = useState<string>();
  return (
    <div className="space-y-2">
      <Button
        variant="secondary"
        icon={<CreditCard size={15} />}
        loading={portal.pending}
        onClick={async () => {
          setError(undefined);
          setError(await portal.go({}));
        }}
      >
        Manage billing
      </Button>
      <p className="text-xs text-muted">
        Cancel a subscription, change your payment method or download invoices
        on Stripe.
      </p>
      {error !== undefined && <Alert tone="danger">{error}</Alert>}
    </div>
  );
}
