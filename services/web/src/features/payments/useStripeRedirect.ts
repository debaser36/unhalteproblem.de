import { useAtomSet } from "@effect/atom-react";
import type { RedirectUrl } from "@unhalteproblem.de/api";
import { Exit } from "effect";
import type { AsyncResult, Atom } from "effect/reactivity";
import { useState } from "react";
import { failureMessage } from "#api/errors.ts";

/** What the payment endpoints answer with, per error tag. */
export const paymentErrors: Record<string, string> = {
  PaymentsUnavailable: "Payments are not available right now.",
  PaymentProviderFailed:
    "The payment provider could not be reached. Please try again in a moment.",
  PaymentPriceNotFound: "This is no longer on offer.",
  AlreadyEntitled: "You already have this. Manage it from your account.",
  TipsUnavailable: "Tips are not available right now.",
  TipAmountOutOfRange: "Please choose an amount within the limits.",
  PaymentCustomerNotFound: "There is nothing to manage yet.",
};

/**
 * Starts a Stripe-hosted page (Checkout or the customer portal): `go`
 * sends the request and, once it worked, leaves the site for Stripe. It
 * resolves to the message why not otherwise; `pending` stays true while the
 * browser navigates away.
 */
export const useStripeRedirect = <E, W>(
  mutation: Atom.Writable<AsyncResult.AsyncResult<RedirectUrl, E>, W>,
) => {
  const send: (value: W) => Promise<Exit.Exit<RedirectUrl, E>> = useAtomSet(
    mutation,
    { mode: "promiseExit" },
  );
  const [pending, setPending] = useState(false);

  const go = async (value: W): Promise<string | undefined> => {
    setPending(true);
    const exit = await send(value);
    if (Exit.isSuccess(exit)) {
      window.location.assign(exit.value.url);
      return undefined;
    }
    setPending(false);
    return failureMessage(exit, paymentErrors);
  };

  return { go, pending };
};
