import { Link } from "react-router";
import { Address, Fact, type LegalText } from "./LegalPage.tsx";
import { legal } from "./legal.ts";

const mail = <a href={`mailto:${legal.email}`}>{legal.email}</a>;

// Keep in step with privacyEn.tsx: the two say the same, section by section.
export const privacyDe: LegalText = {
  title: "Datenschutzerklärung",
  description:
    "Welche personenbezogenen Daten unhalteproblem.de verarbeitet, wozu, wie lange und welche Rechte Sie haben.",
  body: (
    <>
      <h2>1. Verantwortlicher</h2>
      <p>
        {legal.name}
        <br />
        <Address lines={legal.address} missing="Anschrift folgt" />
        <br />
        E-Mail: {mail}
      </p>
      <p>
        Einen Datenschutzbeauftragten gibt es nicht; er ist nicht
        vorgeschrieben. Fragen zum Datenschutz richten Sie bitte an die
        E-Mail-Adresse oben.
      </p>

      <h2>2. Das Wichtigste in Kürze</h2>
      <ul>
        <li>
          Keine Analyse- oder Tracking-Werkzeuge, keine Werbung, keine
          Social-Media-Plugins.
        </li>
        <li>
          Schriften, Skripte und Bilder kommen von diesem Server; beim bloßen
          Besuch werden keine Daten an Dritte übermittelt.
        </li>
        <li>
          Cookies gibt es nur für die Anmeldung; sie sind technisch notwendig.
        </li>
        <li>
          Daten an Dritte gehen nur, wenn Sie bezahlen (Stripe) oder einen
          Essensplan anfordern (Anthropic), siehe Abschnitte 9 und 10.
        </li>
      </ul>

      <h2>3. Hosting</h2>
      <p>
        Die Seite, ihre Datenbank, die Anmeldung (Keycloak unter
        auth.unhalteproblem.de) und die Datensicherungen laufen auf einem Server
        von Oracle Cloud Infrastructure in Frankfurt am Main (Anbieter: Oracle
        Deutschland B.V. & Co. KG, Riesstraße 25, 80992 München). Oracle
        verarbeitet die Daten als Auftragsverarbeiter nach Art. 28 DSGVO auf
        Grundlage seines Data Processing Agreements. Die Daten liegen in der EU;
        soweit Konzerngesellschaften in den USA im Rahmen von Wartung und
        Support Zugriff erhalten können, ist dies durch die
        EU-Standardvertragsklauseln und die Zertifizierung nach dem EU-US Data
        Privacy Framework abgesichert.
      </p>

      <h2>4. Aufruf der Seite und Server-Logdateien</h2>
      <p>
        Bei jedem Aufruf verarbeitet der Server, was Ihr Browser übermittelt:
        IP-Adresse, Datum und Uhrzeit, aufgerufene Adresse, Statuscode,
        übertragene Datenmenge, Referrer und User-Agent (Browser und
        Betriebssystem). Das ist nötig, um die Seite auszuliefern, und wird in
        Logdateien gespeichert, um Fehler zu finden und Angriffe abzuwehren. Die
        Anwendung selbst protokolliert Methode, Pfad, Statuscode und Dauer jeder
        Anfrage mit Ihrer IP-Adresse (bei IPv6 nur das /64-Präfix).
      </p>
      <p>
        Um Missbrauch (etwa massenhafte Anfragen oder Anmeldeversuche) zu
        begrenzen, zählt die Anwendung Anfragen je IP-Adresse; diese Zähler
        liegen nur im Arbeitsspeicher und verfallen nach kurzer Zeit.
      </p>
      <p>
        Rechtsgrundlage ist Art. 6 Abs. 1 lit. f DSGVO; mein berechtigtes
        Interesse ist ein sicherer und stabiler Betrieb. Die Logdateien werden
        nach {legal.logRetentionDays} Tagen gelöscht.
      </p>
      <p>Die Verbindung ist per TLS (HTTPS) verschlüsselt.</p>

      <h2>5. Cookies und lokaler Speicher</h2>
      <p>Diese Seite setzt nur Cookies, die für die Anmeldung nötig sind:</p>
      <ul>
        <li>
          <code>__Host-login</code>: hält während einer Anmeldung zufällige
          Prüfwerte (gegen untergeschobene Anmeldungen); läuft nach 10 Minuten
          ab oder wird mit der Anmeldung ersetzt.
        </li>
        <li>
          <code>__Host-session</code>: hält Sie angemeldet; läuft nach 8 Stunden
          ab oder endet mit der Abmeldung. Der Server speichert nur einen
          Hashwert davon.
        </li>
      </ul>
      <p>
        Außerdem merkt sich Ihr Browser im lokalen Speicher (
        <code>localStorage</code>, Schlüssel <code>theme</code>), ob Sie das
        helle oder dunkle Design gewählt haben. Dieser Wert verlässt Ihren
        Browser nicht.
      </p>
      <p>
        Beides ist unbedingt erforderlich, um den von Ihnen gewünschten Dienst
        bereitzustellen, und bedarf daher nach § 25 Abs. 2 Nr. 2 TDDDG keiner
        Einwilligung. Rechtsgrundlage für die damit verbundene Verarbeitung ist
        Art. 6 Abs. 1 lit. b und f DSGVO. Anmelde-Cookies setzt die Seite erst,
        wenn Sie sich anmelden; Keycloak setzt dabei auf auth.unhalteproblem.de
        eigene, ebenfalls notwendige Sitzungs-Cookies.
      </p>

      <h2>6. Nutzerkonto</h2>
      <p>
        Für ein Konto verarbeitet Keycloak (auf demselben Server, siehe
        Abschnitt 3) Benutzername, E-Mail-Adresse, optional Ihren Namen und Ihr
        Passwort (nur als Hashwert). Die Seite übernimmt bei der Anmeldung
        Benutzername, Name, E-Mail-Adresse und deren Bestätigungsstatus und
        speichert dazu Ihre Rollen und Ihre Sitzungen. Rechtsgrundlage ist Art.
        6 Abs. 1 lit. b DSGVO (Bereitstellung des Kontos).
      </p>
      <p>
        Ein Protokoll sicherheitsrelevanter Vorgänge (etwa An- und Abmeldungen,
        Änderungen an Rollen und Inhalten) enthält nur Kennungen, keine Namen,
        Adressen oder IP-Adressen, und wird nach einem Jahr gelöscht (Art. 6
        Abs. 1 lit. f DSGVO: Nachvollziehbarkeit und Schutz vor Missbrauch).
      </p>
      <p>
        Sie können Ihr Konto jederzeit auf der{" "}
        <Link to="/account">Kontoseite</Link> löschen. Dabei werden
        Benutzername, Name und E-Mail-Adresse entfernt, Rollen und Sitzungen
        gelöscht und das Konto in Keycloak gelöscht. Es bleibt nur eine Kennung,
        auf die das Protokoll verweist. Von Ihnen veröffentlichte Beiträge
        bleiben ohne Namen stehen; Zahlungsbelege bleiben, soweit das Gesetz es
        verlangt (Abschnitt 9).
      </p>

      <h2>7. Kontaktformular und E-Mail</h2>
      <p>
        Wenn Sie das <Link to="/contact">Kontaktformular</Link> nutzen oder mir
        schreiben, verarbeite ich Ihren Namen, Ihre E-Mail-Adresse und Ihre
        Nachricht, um Ihnen zu antworten (Art. 6 Abs. 1 lit. b DSGVO bei
        Anfragen zu einem Vertrag, sonst lit. f: mein Interesse, Anfragen zu
        beantworten). Nachrichten aus dem Formular werden gespeichert, per
        E-Mail an mich weitergeleitet und nach 90 Tagen automatisch aus der
        Datenbank gelöscht. Für den Versand und das Postfach nutze ich{" "}
        <Fact value={legal.mailProvider} missing="E-Mail-Anbieter folgt" />.
        E-Mails bewahre ich auf, solange es für die Anfrage nötig ist.
      </p>

      <h2>8. Blogs, Projekte und hochgeladene Bilder</h2>
      <p>
        Wer auf dieser Seite Beiträge schreibt, veröffentlicht sie mit seinem
        Namen (oder Benutzernamen) als Autor. Anfragen für ein eigenes Unterblog
        (Titel und Beschreibung) speichere ich, um über sie zu entscheiden.
        Hochgeladene Bilder werden in der Datenbank gespeichert und mit dem
        Beitrag veröffentlicht. Rechtsgrundlage ist Art. 6 Abs. 1 lit. b DSGVO.
        Bitte laden Sie keine Bilder hoch, auf denen andere Personen ohne deren
        Einverständnis zu erkennen sind.
      </p>

      <h2>9. Zahlungen über Stripe</h2>
      <p>
        <em>
          Gilt nur, wenn Sie etwas kaufen, abonnieren oder Trinkgeld geben.
        </em>{" "}
        Bezahlt wird auf den Seiten von Stripe (Stripe Payments Europe, Limited,
        1 Grand Canal Street Lower, Grand Canal Dock, Dublin, D02 H210, Irland).
        Ihre Zahlungsdaten (etwa Karten- oder Kontonummer) geben Sie direkt bei
        Stripe ein; ich erhalte sie nicht. Stripe erhält von mir Ihre
        E-Mail-Adresse und eine Kundenkennung, ich von Stripe, was Sie gekauft
        haben, Betrag, Status und die Zahlungsart.
      </p>
      <p>
        Rechtsgrundlage ist Art. 6 Abs. 1 lit. b DSGVO (Vertragserfüllung).
        Stripe verarbeitet Daten teils als eigener Verantwortlicher, etwa zur
        Betrugsvorbeugung und um gesetzliche Pflichten zu erfüllen, und
        übermittelt Daten auch an Stripe, Inc. in den USA; dies stützt sich auf
        das EU-US Data Privacy Framework und die EU-Standardvertragsklauseln.
        Mehr dazu in der{" "}
        <a
          href="https://stripe.com/de/privacy"
          target="_blank"
          rel="noopener noreferrer"
        >
          Datenschutzerklärung von Stripe
        </a>
        . Belege über Zahlungen bewahre ich so lange auf, wie es das Handels-
        und Steuerrecht verlangt (§ 147 AO, § 257 HGB: bis zu zehn Jahre), auch
        über die Löschung Ihres Kontos hinaus (Art. 6 Abs. 1 lit. c DSGVO).
      </p>

      <h2>10. Essensplaner mit Claude (Anthropic)</h2>
      <p>
        <em>Gilt nur, wenn Sie einen Essensplan anfordern.</em> Die Pläne
        schreibt das KI-Modell Claude von Anthropic (Anthropic, PBC, 548 Market
        Street, PMB 90375, San Francisco, CA 94104, USA). Dafür übermittelt die
        Seite Ihre Angaben zum Plan (Land, Anzahl der Personen, Mahlzeiten,
        Ernährungsweise, Budget, auszuschließende Lebensmittel und Wünsche)
        zusammen mit einer Liste passender Lebensmittel. Name, E-Mail-Adresse
        und Kontokennung werden nicht übermittelt. Bitte schreiben Sie in die
        Wünsche nichts, was Sie persönlich identifiziert; Angaben zur Ernährung
        können Rückschlüsse auf Gesundheit oder Weltanschauung zulassen.
      </p>
      <p>
        Rechtsgrundlage ist Art. 6 Abs. 1 lit. b DSGVO; soweit Ihre Angaben
        Gesundheitsdaten enthalten, Ihre ausdrückliche Einwilligung nach Art. 9
        Abs. 2 lit. a DSGVO, die Sie mit der Anfrage erteilen und jederzeit für
        künftige Anfragen widerrufen können. Anthropic verarbeitet die Daten in
        den USA; die Übermittlung stützt sich auf die
        EU-Standardvertragsklauseln. Anthropic verwendet Anfragen über seine
        Schnittstelle nach eigenen Angaben nicht zum Training seiner Modelle und
        speichert sie nur für begrenzte Zeit. Ihre Pläne speichere ich, bis Sie
        sie oder Ihr Konto löschen.
      </p>

      <h2>11. Datensicherungen</h2>
      <p>
        Die Datenbank wird täglich auf demselben Server gesichert. Sicherungen
        werden nach {legal.backupRetentionDays} Tagen gelöscht; bis dahin können
        darin auch schon gelöschte Daten enthalten sein (Art. 6 Abs. 1 lit. f
        DSGVO: Schutz vor Datenverlust).
      </p>

      <h2>12. Ihre Rechte</h2>
      <p>Sie haben gegenüber mir das Recht auf</p>
      <ul>
        <li>Auskunft über Ihre Daten (Art. 15 DSGVO),</li>
        <li>Berichtigung (Art. 16 DSGVO),</li>
        <li>Löschung (Art. 17 DSGVO),</li>
        <li>Einschränkung der Verarbeitung (Art. 18 DSGVO),</li>
        <li>Datenübertragbarkeit (Art. 20 DSGVO) und</li>
        <li>
          Widerruf einer Einwilligung mit Wirkung für die Zukunft (Art. 7 Abs. 3
          DSGVO).
        </li>
      </ul>
      <p>
        <strong>Widerspruchsrecht:</strong> Verarbeitungen, die auf Art. 6 Abs.
        1 lit. f DSGVO beruhen, können Sie aus Gründen, die sich aus Ihrer
        besonderen Situation ergeben, jederzeit widersprechen (Art. 21 DSGVO).
      </p>
      <p>
        Eine E-Mail an {mail} genügt. Außerdem können Sie sich bei einer
        Datenschutz-Aufsichtsbehörde beschweren (Art. 77 DSGVO), etwa an Ihrem
        Wohnort. Für mich zuständig ist{" "}
        <Fact
          value={legal.supervisoryAuthority}
          missing="Aufsichtsbehörde folgt"
        />
        .
      </p>

      <h2>13. Sonstiges</h2>
      <p>
        Sie sind nicht verpflichtet, mir Daten bereitzustellen; ohne sie können
        Sie aber kein Konto anlegen und keine Nachricht schicken. Eine
        automatisierte Entscheidungsfindung nach Art. 22 DSGVO findet nicht
        statt.
      </p>
      <p>Stand: {legal.updated.de}</p>
    </>
  ),
};
