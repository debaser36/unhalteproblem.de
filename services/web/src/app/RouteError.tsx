import { RotateCcw } from "lucide-react";
import { isRouteErrorResponse, useRouteError } from "react-router";
import { Button } from "#ui/Button.tsx";
import { Container } from "#ui/Container.tsx";
import { NotFoundPage } from "./NotFoundPage.tsx";
import { NoIndex } from "./Seo.tsx";

/** What a route shows when rendering it throws (a bug or a failed chunk load). */
export function RouteError() {
  const error = useRouteError();
  if (isRouteErrorResponse(error) && error.status === 404) {
    return <NotFoundPage />;
  }
  return (
    <Container width="prose" className="py-24">
      <div className="space-y-6 font-mono">
        <NoIndex title="Error" />
        <p className="text-sm text-danger">
          panic: something went wrong while rendering this page
        </p>
        <p className="text-fg-soft">
          Reloading usually helps, for example after the site was updated.
        </p>
        <Button
          variant="secondary"
          icon={<RotateCcw size={16} />}
          onClick={() => window.location.reload()}
        >
          reload
        </Button>
      </div>
    </Container>
  );
}
