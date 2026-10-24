import { Link } from "react-router";
import { Address, type LegalText, LegalPage } from "./LegalPage.tsx";
import { type Language, legal } from "./legal.ts";

const mail = <a href={`mailto:${legal.email}`}>{legal.email}</a>;

const text: Record<Language, LegalText> = {
  de: {
    title: "Impressum",
    description: "Anbieterkennzeichnung von unhalteproblem.de nach § 5 DDG.",
    body: (
      <>
        <h2>Angaben gemäß § 5 DDG</h2>
        <p>
          {legal.name}
          <br />
          <Address lines={legal.address} missing="Anschrift folgt" />
        </p>

        <h2>Kontakt</h2>
        <p>
          E-Mail: {mail}
          <br />
          Oder über das <Link to="/contact">Kontaktformular</Link>.
        </p>

        {legal.vatId !== undefined && (
          <>
            <h2>Umsatzsteuer</h2>
            <p>
              Umsatzsteuer-Identifikationsnummer gemäß § 27a UStG: {legal.vatId}
            </p>
          </>
        )}

        <h2>Verantwortlich für den Inhalt nach § 18 Abs. 2 MStV</h2>
        <p>
          {legal.name}, Anschrift wie oben.
          <br />
          Beiträge in Unterblogs, die andere Personen schreiben, nennen ihre
          Autorin oder ihren Autor.
        </p>

        <h2>Verbraucherstreitbeilegung</h2>
        <p>
          Ich bin nicht bereit und nicht verpflichtet, an
          Streitbeilegungsverfahren vor einer Verbraucherschlichtungsstelle
          teilzunehmen.
        </p>

        <h2>Haftung für Inhalte und Links</h2>
        <p>
          Ich erstelle die Inhalte dieser Seite mit Sorgfalt, kann für ihre
          Richtigkeit, Vollständigkeit und Aktualität aber keine Gewähr
          übernehmen. Für fremde Informationen, die ich nur speichere oder
          übermittle, bin ich nach den §§ 7 bis 10 DDG erst verantwortlich, wenn
          ich von einer konkreten Rechtsverletzung erfahre; dann entferne ich
          sie umgehend.
        </p>
        <p>
          Diese Seite verlinkt auf Seiten Dritter, auf deren Inhalte ich keinen
          Einfluss habe. Für sie ist der jeweilige Anbieter verantwortlich. Zum
          Zeitpunkt der Verlinkung waren keine Rechtsverstöße erkennbar; erfahre
          ich von einem, entferne ich den Link.
        </p>

        <h2>Urheberrecht</h2>
        <p>
          Die Inhalte dieser Seite unterliegen dem deutschen Urheberrecht.
          Beiträge anderer Autorinnen und Autoren sind als solche
          gekennzeichnet. Quellcode, den ich unter einer offenen Lizenz
          veröffentliche, darf nach deren Bedingungen genutzt werden.
        </p>

        <p>
          Wie diese Seite mit personenbezogenen Daten umgeht, steht in der{" "}
          <Link to="/datenschutz">Datenschutzerklärung</Link>.
        </p>
      </>
    ),
  },
  en: {
    title: "Legal notice",
    description: "Legal notice (Impressum) of unhalteproblem.de under § 5 DDG.",
    body: (
      <>
        <h2>Information under § 5 DDG</h2>
        <p>
          {legal.name}
          <br />
          <Address lines={legal.address} missing="address to follow" />
        </p>

        <h2>Contact</h2>
        <p>
          Email: {mail}
          <br />
          Or use the <Link to="/contact">contact form</Link>.
        </p>

        {legal.vatId !== undefined && (
          <>
            <h2>VAT</h2>
            <p>VAT identification number under § 27a UStG: {legal.vatId}</p>
          </>
        )}

        <h2>Responsible for the content under § 18 (2) MStV</h2>
        <p>
          {legal.name}, address as above.
          <br />
          Posts in subblogs written by other people name their author.
        </p>

        <h2>Consumer dispute resolution</h2>
        <p>
          I am neither willing nor obliged to take part in dispute resolution
          proceedings before a consumer arbitration board.
        </p>

        <h2>Liability for content and links</h2>
        <p>
          I write the content of this site with care but cannot guarantee that
          it is correct, complete and up to date. For information by others that
          I only store or transmit, I am responsible under §§ 7 to 10 DDG only
          once I learn of a specific infringement; I then remove it promptly.
        </p>
        <p>
          This site links to sites of third parties whose content I have no
          influence on; their providers are responsible for them. No
          infringements were apparent when the links were set; if I learn of
          one, I remove the link.
        </p>

        <h2>Copyright</h2>
        <p>
          The content of this site is subject to German copyright law. Posts by
          other authors are marked as such. Source code that I publish under an
          open licence may be used under that licence's terms.
        </p>

        <p>
          How this site handles personal data is described in the{" "}
          <Link to="/datenschutz?lang=en">privacy policy</Link>.
        </p>
      </>
    ),
  },
};

export function ImpressumPage() {
  return <LegalPage path="/impressum" text={text} />;
}
