import { Home } from "lucide-react";
import { ButtonLink } from "#ui/Button.tsx";
import { Container } from "#ui/Container.tsx";

/**
 * 404, with a nod to the site's name: whether this page exists was, for
 * once, decidable.
 */
export function NotFoundPage({ what = "page" }: { readonly what?: string }) {
  return (
    <Container width="prose" className="py-24">
      <div className="animate-fade-up space-y-6 font-mono">
        <p className="text-sm text-muted">
          <span className="text-accent">$</span> cat ./{what}
        </p>
        <p className="text-6xl font-semibold text-fg">404</p>
        <p className="text-fg-soft">
          No such {what}. At least this time we could decide that it halts.
        </p>
        <ButtonLink to="/" variant="secondary" icon={<Home size={16} />}>
          cd ~
        </ButtonLink>
      </div>
    </Container>
  );
}
