import { useAtomSet } from "@effect/atom-react";
import { ContactMessageLimits } from "@unhalteproblem.de/api";
import { staticPages } from "@unhalteproblem.de/seo";
import { Exit } from "effect";
import { Mail, Send } from "lucide-react";
import { type FormEvent, useState } from "react";
import { ApiClient } from "#api/ApiClient.ts";
import { failureMessage } from "#api/errors.ts";
import { Seo } from "#app/Seo.tsx";
import { Alert } from "#ui/Alert.tsx";
import { Button } from "#ui/Button.tsx";
import { Card } from "#ui/Card.tsx";
import { Container } from "#ui/Container.tsx";
import { Field, Input, Textarea } from "#ui/Field.tsx";
import { PageHeader } from "#ui/PageHeader.tsx";

const submitContact = ApiClient.mutation("contact", "submit");

export function ContactPage() {
  const submit = useAtomSet(submitContact, { mode: "promiseExit" });
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  const [sent, setSent] = useState(false);

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setPending(true);
    setError(undefined);
    // The contract accepts trimmed values only.
    const exit = await submit({
      payload: {
        name: name.trim(),
        email: email.trim(),
        message: message.trim(),
      },
    });
    setPending(false);
    if (Exit.isSuccess(exit)) {
      setSent(true);
      setMessage("");
    } else {
      setError(
        failureMessage(exit, {
          RateLimited:
            "You have sent several messages already. Please try again in an hour.",
        }),
      );
    }
  };

  return (
    <Container width="prose">
      <Seo {...staticPages.contact} />
      <PageHeader path="~/contact" title="Get in touch">
        Questions, ideas, a project you want to talk about, or a bug you found
        on this site: write me a message and I will get back to you by mail.
      </PageHeader>

      <Card className="animate-fade-up p-5 sm:p-8">
        {sent ? (
          <div className="space-y-4 py-6 text-center">
            <Mail className="mx-auto text-accent" size={32} />
            <p className="font-display text-xl text-fg">Message sent.</p>
            <p className="text-fg-soft">
              Thanks! I will reply to <span className="text-fg">{email}</span>.
            </p>
            <Button variant="ghost" onClick={() => setSent(false)}>
              Write another one
            </Button>
          </div>
        ) : (
          <form onSubmit={onSubmit} className="space-y-5">
            <div className="grid gap-5 sm:grid-cols-2">
              <Field label="Name">
                {(control) => (
                  <Input
                    {...control}
                    required
                    autoComplete="name"
                    maxLength={ContactMessageLimits.nameMaxLength}
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                  />
                )}
              </Field>
              <Field label="Email" hint="Only used to answer you.">
                {(control) => (
                  <Input
                    {...control}
                    required
                    type="email"
                    autoComplete="email"
                    maxLength={ContactMessageLimits.emailMaxLength}
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                )}
              </Field>
            </div>
            <Field
              label="Message"
              hint={`${message.length} / ${ContactMessageLimits.messageMaxLength}`}
            >
              {(control) => (
                <Textarea
                  {...control}
                  required
                  rows={7}
                  maxLength={ContactMessageLimits.messageMaxLength}
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                />
              )}
            </Field>
            {error !== undefined && <Alert tone="danger">{error}</Alert>}
            <div className="flex flex-col-reverse gap-4 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-xs text-muted">
                Your message is stored for a limited time and mailed to me. It
                is not shared with anyone.
              </p>
              <Button
                type="submit"
                variant="primary"
                loading={pending}
                icon={<Send size={15} />}
              >
                Send
              </Button>
            </div>
          </form>
        )}
      </Card>
    </Container>
  );
}
