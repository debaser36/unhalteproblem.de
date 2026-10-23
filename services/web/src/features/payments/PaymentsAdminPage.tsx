import type {
  AdminPayment,
  PaymentCursor,
  PaymentInsights,
  PaymentMoney,
  PaymentStatus,
  SubscriptionCursor,
} from "@unhalteproblem.de/api";
import { PaymentStatus as PaymentStatuses } from "@unhalteproblem.de/api";
import { Option } from "effect";
import { ExternalLink, Undo2 } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";
import { AsyncView } from "#api/AsyncView.tsx";
import { useAction } from "#api/useAction.ts";
import { AdminHeading } from "#features/admin/AdminHeading.tsx";
import { auditKey } from "#features/admin/insightsAtoms.ts";
import { formatDateTime } from "#lib/format.ts";
import { Badge } from "#ui/Badge.tsx";
import { Button } from "#ui/Button.tsx";
import { Dialog } from "#ui/Dialog.tsx";
import { EmptyState } from "#ui/EmptyState.tsx";
import { Field, Input, Select } from "#ui/Field.tsx";
import { StatTile } from "#ui/StatTile.tsx";
import { Table, Td, Th } from "#ui/Table.tsx";
import {
  dashboardUrl,
  paymentTone,
  statusLabel,
  subscriptionTone,
} from "./labels.ts";
import { formatMoney, formatPrice, parseAmount } from "./money.ts";
import {
  adminPaymentsAtom,
  adminPaymentsKey,
  adminSubscriptionsAtom,
  paymentInsightsAtom,
  refundPayment,
} from "./paymentAtoms.ts";

const sums = (amounts: ReadonlyArray<PaymentMoney>) =>
  amounts.length === 0 ? "—" : amounts.map(formatMoney).join(" · ");

/**
 * Payments for admins: the revenue figures, every payment (refundable
 * from here) and every subscription, newest first.
 */
export function PaymentsAdminPage() {
  return (
    <>
      <AdminHeading title="Payments">
        Payments and subscriptions through Stripe, newest first. Stripe is the
        source of truth; this mirrors it after every webhook.
      </AdminHeading>
      <div className="space-y-8">
        <AsyncView atom={paymentInsightsAtom}>
          {(insights) => <Insights insights={insights} />}
        </AsyncView>
        <Payments />
        <Subscriptions />
      </div>
    </>
  );
}

function Insights({ insights }: { readonly insights: PaymentInsights }) {
  return (
    <div className="space-y-3">
      {!insights.livemode && (
        <Badge tone="warning">test mode: no real money</Badge>
      )}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          label="last 30 days"
          value={sums(insights.revenueLast30Days)}
        />
        <StatTile
          label="all time"
          value={sums(insights.revenueTotal)}
          note={`refunded ${sums(insights.refundedTotal)}`}
        />
        <StatTile
          label="monthly recurring"
          value={sums(insights.monthlyRecurringRevenue)}
        />
        <StatTile
          label="active subscriptions"
          value={insights.activeSubscriptions}
        />
      </div>
    </div>
  );
}

function Payments() {
  const [status, setStatus] = useState<PaymentStatus>();
  const [cursors, setCursors] = useState<
    ReadonlyArray<PaymentCursor | undefined>
  >([undefined]);
  const [refunding, setRefunding] = useState<AdminPayment>();

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h2 className="text-lg font-semibold text-fg">Payments</h2>
        <Field label="status" className="w-48">
          {(control) => (
            <Select
              {...control}
              value={status ?? ""}
              onChange={(event) => {
                const value = event.target.value;
                setStatus(value === "" ? undefined : (value as PaymentStatus));
                setCursors([undefined]);
              }}
            >
              <option value="">all</option>
              {PaymentStatuses.literals.map((literal) => (
                <option key={literal} value={literal}>
                  {statusLabel(literal)}
                </option>
              ))}
            </Select>
          )}
        </Field>
      </div>
      {cursors.map((cursor, index) => (
        <AsyncView
          key={`${status ?? "all"}-${index}`}
          atom={adminPaymentsAtom({ cursor, userId: undefined, status })}
        >
          {(page) => (
            <>
              {index === 0 && page.payments.length === 0 ? (
                <EmptyState title="No payments." />
              ) : (
                <Table>
                  <thead>
                    <tr>
                      <Th>date</Th>
                      <Th>buyer</Th>
                      <Th>for</Th>
                      <Th className="text-right">amount</Th>
                      <Th>status</Th>
                      <Th />
                    </tr>
                  </thead>
                  <tbody>
                    {page.payments.map((payment) => (
                      <PaymentRow
                        key={payment.id}
                        payment={payment}
                        onRefund={() => setRefunding(payment)}
                      />
                    ))}
                  </tbody>
                </Table>
              )}
              {index === cursors.length - 1 && page.nextCursor !== null && (
                <div className="flex justify-center">
                  <Button
                    variant="secondary"
                    onClick={() =>
                      setCursors((all) => [
                        ...all,
                        page.nextCursor ?? undefined,
                      ])
                    }
                  >
                    Load more
                  </Button>
                </div>
              )}
            </>
          )}
        </AsyncView>
      ))}
      {refunding !== undefined && (
        <RefundDialog
          payment={refunding}
          onClose={() => setRefunding(undefined)}
        />
      )}
    </section>
  );
}

function BuyerLink({ userId }: { readonly userId: Option.Option<string> }) {
  return Option.match(userId, {
    onNone: () => <span className="text-muted">—</span>,
    onSome: (id) => (
      <Link
        to={`/admin/users/${id}`}
        className="font-mono text-xs text-accent-2 hover:underline"
      >
        {id.slice(0, 8)}
      </Link>
    ),
  });
}

function PaymentRow({
  payment,
  onRefund,
}: {
  readonly payment: AdminPayment;
  readonly onRefund: () => void;
}) {
  const refundable =
    (payment.status === "paid" || payment.status === "partiallyRefunded") &&
    payment.amountRefunded < payment.amount.amount &&
    Option.isSome(payment.stripePaymentIntentId);
  return (
    <tr>
      <Td className="whitespace-nowrap">{formatDateTime(payment.createdAt)}</Td>
      <Td>
        <BuyerLink userId={payment.userId} />
      </Td>
      <Td>
        {payment.kind === "tip" ? "Tip" : null}
        {payment.kind !== "tip" &&
          Option.match(payment.product, {
            onNone: () => "—",
            onSome: (product) => product.name,
          })}
        {payment.kind === "subscription" && (
          <span className="text-muted"> (renewal)</span>
        )}
      </Td>
      <Td className="text-right tabular-nums">
        {formatMoney(payment.amount)}
        {payment.amountRefunded > 0 && (
          <span className="block text-xs text-muted">
            −
            {formatMoney({
              amount: payment.amountRefunded,
              currency: payment.amount.currency,
            })}
          </span>
        )}
      </Td>
      <Td>
        <Badge tone={paymentTone[payment.status]}>
          {statusLabel(payment.status)}
        </Badge>
      </Td>
      <Td className="whitespace-nowrap text-right">
        {Option.match(payment.stripePaymentIntentId, {
          onNone: () => null,
          onSome: (intent) => (
            <a
              href={dashboardUrl(payment.livemode, `payments/${intent}`)}
              target="_blank"
              rel="noreferrer"
              className="mr-2 inline-flex items-center text-muted hover:text-fg"
              aria-label="Open in Stripe"
            >
              <ExternalLink size={14} />
            </a>
          ),
        })}
        {refundable && (
          <Button
            size="sm"
            variant="ghost"
            icon={<Undo2 size={14} />}
            onClick={onRefund}
          >
            Refund
          </Button>
        )}
      </Td>
    </tr>
  );
}

function RefundDialog({
  payment,
  onClose,
}: {
  readonly payment: AdminPayment;
  readonly onClose: () => void;
}) {
  const refund = useAction(refundPayment, {
    success: "Refund issued.",
    errors: {
      RefundNotAllowed: "This payment can't be refunded (by that much).",
      PaymentNotFound: "The payment is gone.",
      PaymentProviderFailed: "Stripe could not be reached. Try again.",
    },
  });
  const currency = payment.amount.currency;
  const remaining = payment.amount.amount - payment.amountRefunded;
  const [amount, setAmount] = useState("");
  const [invalid, setInvalid] = useState<string>();

  const confirm = async () => {
    const parsed =
      amount.trim() === "" ? undefined : parseAmount(amount, currency);
    if (amount.trim() !== "" && (parsed === undefined || parsed > remaining)) {
      setInvalid(`At most ${formatMoney({ amount: remaining, currency })}.`);
      return;
    }
    const failure = await refund.run({
      params: { paymentId: payment.id },
      payload: parsed === undefined ? {} : { amount: parsed },
      reactivityKeys: [adminPaymentsKey, auditKey],
    });
    if (failure === undefined) onClose();
  };

  return (
    <Dialog
      open
      onClose={onClose}
      title="Refund this payment?"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="danger" loading={refund.pending} onClick={confirm}>
            Refund
          </Button>
        </>
      }
    >
      <p>
        Stripe returns the money to the buyer. A full refund of a purchase also
        takes away what it unlocked.
      </p>
      <Field
        label={`Amount (${currency.toUpperCase()})`}
        hint={`Empty for all that is left: ${formatMoney({ amount: remaining, currency })}.`}
        error={invalid}
        className="mt-4"
      >
        {(control) => (
          <Input
            {...control}
            inputMode="decimal"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
          />
        )}
      </Field>
    </Dialog>
  );
}

function Subscriptions() {
  const [cursors, setCursors] = useState<
    ReadonlyArray<SubscriptionCursor | undefined>
  >([undefined]);
  return (
    <section className="space-y-3">
      <h2 className="text-lg font-semibold text-fg">Subscriptions</h2>
      {cursors.map((cursor, index) => (
        <AsyncView
          key={index}
          atom={adminSubscriptionsAtom({
            cursor,
            userId: undefined,
            status: undefined,
          })}
        >
          {(page) => (
            <>
              {index === 0 && page.subscriptions.length === 0 ? (
                <EmptyState title="No subscriptions." />
              ) : (
                <Table>
                  <thead>
                    <tr>
                      <Th>since</Th>
                      <Th>subscriber</Th>
                      <Th>product</Th>
                      <Th>price</Th>
                      <Th>status</Th>
                      <Th>period end</Th>
                      <Th />
                    </tr>
                  </thead>
                  <tbody>
                    {page.subscriptions.map((subscription) => (
                      <tr key={subscription.id}>
                        <Td className="whitespace-nowrap">
                          {formatDateTime(subscription.createdAt)}
                        </Td>
                        <Td>
                          <BuyerLink userId={subscription.userId} />
                        </Td>
                        <Td>
                          {Option.match(subscription.product, {
                            onNone: () => "—",
                            onSome: (product) => product.name,
                          })}
                        </Td>
                        <Td className="tabular-nums">
                          {Option.match(subscription.price, {
                            onNone: () => "—",
                            onSome: formatPrice,
                          })}
                        </Td>
                        <Td>
                          <Badge tone={subscriptionTone[subscription.status]}>
                            {statusLabel(subscription.status)}
                          </Badge>
                          {subscription.cancelAtPeriodEnd && (
                            <span className="ml-2 text-xs text-muted">
                              cancels
                            </span>
                          )}
                        </Td>
                        <Td className="whitespace-nowrap">
                          {Option.match(subscription.currentPeriodEnd, {
                            onNone: () => "—",
                            onSome: formatDateTime,
                          })}
                        </Td>
                        <Td className="text-right">
                          <a
                            href={dashboardUrl(
                              subscription.livemode,
                              `subscriptions/${subscription.id}`,
                            )}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center text-muted hover:text-fg"
                            aria-label="Open in Stripe"
                          >
                            <ExternalLink size={14} />
                          </a>
                        </Td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              )}
              {index === cursors.length - 1 && page.nextCursor !== null && (
                <div className="flex justify-center">
                  <Button
                    variant="secondary"
                    onClick={() =>
                      setCursors((all) => [
                        ...all,
                        page.nextCursor ?? undefined,
                      ])
                    }
                  >
                    Load more
                  </Button>
                </div>
              )}
            </>
          )}
        </AsyncView>
      ))}
    </section>
  );
}
