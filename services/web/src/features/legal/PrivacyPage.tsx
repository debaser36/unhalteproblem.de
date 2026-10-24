import { LegalPage } from "./LegalPage.tsx";
import { privacyDe } from "./privacyDe.tsx";
import { privacyEn } from "./privacyEn.tsx";

export function PrivacyPage() {
  return (
    <LegalPage path="/datenschutz" text={{ de: privacyDe, en: privacyEn }} />
  );
}
