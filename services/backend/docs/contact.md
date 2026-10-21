# Contact

`POST /contact` (rate limited, see [rate-limiting.md](rate-limiting.md)) runs `ContactCommands.submit` of the
`contact` domain: in one transaction it stores the message in
`contact_messages` and enqueues a `contact.send-mail` outbox message. A
consumer then mails the owner (`CONTACT_MAIL_TO`) with the visitor's address
as `Reply-To`, so answering the mail answers them. If the SMTP server is down
the mail is retried with backoff (see "Outbox" in [domains.md](domains.md)); a mail may rarely arrive
twice, which is why it carries a stable `Message-ID`. Without `SMTP_HOST` the
messages are stored only, and a warning without content is logged for each.

If the mails don't arrive, look at the outbox and the log:
`SELECT id, attempts, last_error, available_at, dead_at FROM outbox WHERE topic = 'contact.send-mail'`.
`last_error` is `MailFailed:` and a code, `<code>[:<SMTP reply>[:<command>]]`
(the same appears in the log line "Outbox message failed", which also carries the
server's explanation of a refusal with anything that looks like an address
replaced by `<address>`; the table never gets that text, since the
server quotes addresses in it):

| Code                               | Usually                                                                                                                                                                                                                                               |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ECONNECTION`, `ETIMEDOUT`, `EDNS` | host or port wrong, firewall (Oracle Cloud blocks outgoing port 25: use 587 or 465), no DNS                                                                                                                                                           |
| `ESOCKET`                          | TLS mismatch: port 465 needs `SMTP_SECURITY=tls`, port 587 `starttls`                                                                                                                                                                                 |
| `EAUTH:535:…`                      | wrong `SMTP_USER` or `SMTP_PASSWORD` (some providers need an app password)                                                                                                                                                                            |
| `EENVELOPE:…:MAIL FROM`            | the provider doesn't allow `SMTP_FROM` as sender (often it must be the login address or a verified domain)                                                                                                                                            |
| `EENVELOPE:…:RCPT TO`              | the provider refuses `CONTACT_MAIL_TO`                                                                                                                                                                                                                |
| `EMESSAGE:550:DATA`                | the provider accepted login, sender and recipient but refuses the message itself: usually the sender domain isn't verified there (SPF/DKIM/DMARC), or the visitor's Reply-To domain has no mail server; the log line carries the server's explanation |

A message is retried with backoff and ends up dead (`dead_at`) after ten
attempts. After fixing the setting and restarting, run the failed ones again:
`UPDATE outbox SET attempts = 0, available_at = now(), last_error = NULL, dead_at = NULL, locked_until = NULL WHERE topic = 'contact.send-mail'`.

The table holds names, addresses and free text. Nothing logs them (not even
the outbox: its payload is the message id), and a job deletes messages older
than `CONTACT_RETENTION` once an hour. Read the stored ones with
`SELECT created_at, name, email, message FROM contact_messages ORDER BY created_at DESC`.
