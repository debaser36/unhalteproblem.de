import { Link } from "react-router";
import { Address, Fact, type LegalText } from "./LegalPage.tsx";
import { legal } from "./legal.ts";

const mail = <a href={`mailto:${legal.email}`}>{legal.email}</a>;

// A translation of privacyDe.tsx, which is binding: keep the two in step.
export const privacyEn: LegalText = {
  title: "Privacy policy",
  description:
    "Which personal data unhalteproblem.de processes, why, for how long, and what your rights are.",
  body: (
    <>
      <h2>1. Controller</h2>
      <p>
        {legal.name}
        <br />
        <Address lines={legal.address} missing="address to follow" />
        <br />
        Email: {mail}
      </p>
      <p>
        There is no data protection officer; none is required. Please send
        questions about data protection to the address above.
      </p>

      <h2>2. In short</h2>
      <ul>
        <li>
          No analytics or tracking tools, no advertising, no social media
          plugins.
        </li>
        <li>
          Fonts, scripts and images come from this server; merely visiting the
          site sends no data to third parties.
        </li>
        <li>Cookies are used for logging in only; they are necessary.</li>
        <li>
          Data goes to third parties only when you pay (Stripe) or request a
          meal plan (Anthropic), see sections 9 and 10.
        </li>
      </ul>

      <h2>3. Hosting</h2>
      <p>
        The site, its database, the login (Keycloak at auth.unhalteproblem.de)
        and the backups run on a server of Oracle Cloud Infrastructure in
        Frankfurt am Main, Germany (provider: Oracle Deutschland B.V. & Co. KG,
        Riesstraße 25, 80992 München). Oracle processes the data as a processor
        under Art. 28 GDPR, based on its Data Processing Agreement. The data is
        stored in the EU; where group companies in the USA may get access for
        maintenance and support, this is covered by the EU Standard Contractual
        Clauses and the certification under the EU-US Data Privacy Framework.
      </p>

      <h2>4. Visiting the site and server log files</h2>
      <p>
        On every request the server processes what your browser sends: IP
        address, date and time, the requested address, status code, amount of
        data sent, referrer and user agent (browser and operating system). This
        is needed to deliver the site and is stored in log files to find errors
        and fend off attacks. The application itself logs method, path, status
        code and duration of every request with your IP address (for IPv6 only
        the /64 prefix).
      </p>
      <p>
        To limit abuse (such as floods of requests or login attempts), the
        application counts requests per IP address; these counters live in
        memory only and expire after a short time.
      </p>
      <p>
        The legal basis is Art. 6 (1) (f) GDPR; my legitimate interest is a
        secure and stable service. The log files are deleted after{" "}
        {legal.logRetentionDays} days.
      </p>
      <p>The connection is encrypted with TLS (HTTPS).</p>

      <h2>5. Cookies and local storage</h2>
      <p>This site sets only the cookies that logging in needs:</p>
      <ul>
        <li>
          <code>__Host-login</code>: holds random check values during a login
          (against forged logins); expires after 10 minutes or is replaced when
          the login completes.
        </li>
        <li>
          <code>__Host-session</code>: keeps you logged in; expires after 8
          hours or when you log out. The server stores only a hash of it.
        </li>
      </ul>
      <p>
        Your browser also remembers in its local storage (
        <code>localStorage</code>, key <code>theme</code>) whether you chose the
        light or the dark theme. This value never leaves your browser.
      </p>
      <p>
        Both are strictly necessary to provide the service you asked for and
        therefore need no consent under § 25 (2) no. 2 TDDDG. The legal basis
        for the related processing is Art. 6 (1) (b) and (f) GDPR. The login
        cookies are set only when you log in; Keycloak then sets its own,
        equally necessary session cookies on auth.unhalteproblem.de.
      </p>

      <h2>6. User account</h2>
      <p>
        For an account, Keycloak (on the same server, see section 3) processes
        your username, email address, optionally your name, and your password
        (as a hash only). When you log in, the site takes over username, name,
        email address and whether it is verified, and stores your roles and
        sessions with them. The legal basis is Art. 6 (1) (b) GDPR (providing
        the account).
      </p>
      <p>
        A log of security-relevant events (such as logins and logouts, changes
        to roles and content) holds identifiers only, no names, addresses or IP
        addresses, and is deleted after one year (Art. 6 (1) (f) GDPR:
        accountability and protection against abuse).
      </p>
      <p>
        You can delete your account at any time on the{" "}
        <Link to="/account">account page</Link>. This removes your username,
        name and email address, deletes your roles and sessions, and deletes the
        account in Keycloak. Only an identifier that the log refers to remains.
        Posts you published stay without a name; payment records stay as far as
        the law requires (section 9).
      </p>

      <h2>7. Contact form and email</h2>
      <p>
        When you use the <Link to="/contact">contact form</Link> or write to me,
        I process your name, email address and message to answer you (Art. 6 (1)
        (b) GDPR for enquiries about a contract, otherwise (f): my interest in
        answering enquiries). Messages from the form are stored, forwarded to me
        by email and automatically deleted from the database after 90 days. For
        sending and the mailbox I use{" "}
        <Fact value={legal.mailProvider} missing="email provider to follow" />.
        I keep emails for as long as the enquiry needs.
      </p>

      <h2>8. Blogs, projects and uploaded images</h2>
      <p>
        Whoever writes posts on this site publishes them with their name (or
        username) as the author. Requests for a subblog of one's own (title and
        description) are stored so I can decide on them. Uploaded images are
        stored in the database and published with the post. The legal basis is
        Art. 6 (1) (b) GDPR. Please do not upload images showing other people
        who have not agreed to it.
      </p>

      <h2>9. Payments with Stripe</h2>
      <p>
        <em>Applies only if you buy, subscribe or tip.</em> Payments are made on
        the pages of Stripe (Stripe Payments Europe, Limited, 1 Grand Canal
        Street Lower, Grand Canal Dock, Dublin, D02 H210, Ireland). You enter
        your payment details (such as card or account number) directly at
        Stripe; I never receive them. Stripe gets your email address and a
        customer identifier from me; I get from Stripe what you bought, the
        amount, the status and the payment method.
      </p>
      <p>
        The legal basis is Art. 6 (1) (b) GDPR (performance of a contract).
        Stripe processes some data as a controller of its own, for example to
        prevent fraud and to meet legal obligations, and also transfers data to
        Stripe, Inc. in the USA, based on the EU-US Data Privacy Framework and
        the EU Standard Contractual Clauses. See{" "}
        <a
          href="https://stripe.com/privacy"
          target="_blank"
          rel="noopener noreferrer"
        >
          Stripe&apos;s privacy policy
        </a>
        . I keep payment records for as long as commercial and tax law requires
        (§ 147 AO, § 257 HGB: up to ten years), also after your account is
        deleted (Art. 6 (1) (c) GDPR).
      </p>

      <h2>10. Meal planner with Claude (Anthropic)</h2>
      <p>
        <em>Applies only if you request a meal plan.</em> The plans are written
        by the AI model Claude by Anthropic (Anthropic, PBC, 548 Market Street,
        PMB 90375, San Francisco, CA 94104, USA). For this the site sends what
        you entered for the plan (country, number of people, meals, diet,
        budget, foods to leave out and wishes) together with a list of suitable
        foods. Your name, email address and account identifier are not sent.
        Please do not write anything into the wishes that identifies you; diet
        details can reveal information about health or beliefs.
      </p>
      <p>
        The legal basis is Art. 6 (1) (b) GDPR; where your details contain
        health data, your explicit consent under Art. 9 (2) (a) GDPR, which you
        give with the request and can withdraw at any time for future requests.
        Anthropic processes the data in the USA; the transfer is based on the EU
        Standard Contractual Clauses. According to Anthropic, requests through
        its API are not used to train its models and are stored for a limited
        time only. I keep your plans until you delete them or your account.
      </p>

      <h2>11. Backups</h2>
      <p>
        The database is backed up daily on the same server. Backups are deleted
        after {legal.backupRetentionDays} days; until then they may still
        contain data that has been deleted (Art. 6 (1) (f) GDPR: protection
        against data loss).
      </p>

      <h2>12. Your rights</h2>
      <p>You have the right to</p>
      <ul>
        <li>access your data (Art. 15 GDPR),</li>
        <li>rectification (Art. 16 GDPR),</li>
        <li>erasure (Art. 17 GDPR),</li>
        <li>restriction of processing (Art. 18 GDPR),</li>
        <li>data portability (Art. 20 GDPR) and</li>
        <li>
          withdraw a consent with effect for the future (Art. 7 (3) GDPR).
        </li>
      </ul>
      <p>
        <strong>Right to object:</strong> you can object at any time, on grounds
        relating to your particular situation, to processing based on Art. 6 (1)
        (f) GDPR (Art. 21 GDPR).
      </p>
      <p>
        An email to {mail} is enough. You can also lodge a complaint with a data
        protection supervisory authority (Art. 77 GDPR), for example where you
        live. The authority responsible for me is{" "}
        <Fact
          value={legal.supervisoryAuthority}
          missing="supervisory authority to follow"
        />
        .
      </p>

      <h2>13. Other</h2>
      <p>
        You are not obliged to provide data to me; without it, however, you
        cannot create an account or send a message. There is no automated
        decision-making under Art. 22 GDPR.
      </p>
      <p>Last updated: {legal.updated.en}</p>
    </>
  ),
};
