# Domains

Business logic lives in domains under `src/domains/<domain>/`, built on a
small kernel in `src/cqrs/`. The domains are `users`, `moderation`,
`audit`, `contact`, `blogs`, `projects` and `media`.

| Kernel (`#cqrs/*`) | Purpose                                                                                                                                                                                                                |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Transaction`      | Runs an effect in a database transaction; nested runs become savepoints. Collects the domain events recorded inside and publishes them only after the outermost commit                                                 |
| `DomainEvent`      | `record(...)` adds events to the current transaction (a defect outside one); `DomainEvents` delivers committed events in-process; `subscriber(...)` builds a background consumer                                       |
| `Command`          | `Command.boundary(transaction)`: the last argument of `Effect.fn` for a method that changes state. Runs it in a `Transaction` and turns `SqlError`/`SchemaError` into defects                                          |
| `Query`            | `Query.boundary`: the same for reads, without a transaction                                                                                                                                                            |
| `Outbox`           | Durable side effects: `enqueue(topic, payload)` inside a command writes a row in the same transaction; `Outbox.consumer(topic, handle)` is a background worker that handles committed rows at least once, with retries |

Events are delivered at most once: they live in memory, so the ones not yet
handled when the process stops are lost, and so are events beyond the queue
capacity (4096) of a subscriber that falls behind (logged as a warning).
Whatever has to happen together with a change belongs into the command
itself, not a subscriber.

Inside a command: open transactions only through `Transaction` (running it
inside a bare `sql.withTransaction`, or recording events inside one, is a
defect), never catch a
`SqlError` and carry on (Postgres would silently roll back the COMMIT; use a
nested `transaction.run` as a savepoint instead), and run statements one
after another, not concurrently.

A domain folder holds:

- the aggregate (`User.ts`): its `Model.Class`, ids, events and errors, and
  the rules as pure functions from the current state to the new state plus
  the events (`register`, `logIn`);
- a repository (`UserRepository.ts`), used only inside the domain;
- `UserCommands` and `UserQueries`, the services the rest of the backend
  uses; every method goes through `Command.boundary` or `Query.boundary`;
- event subscribers (`UserEventLog.ts`) and a layer that wires it all up
  (`Users.ts`).

To add a domain, create `src/domains/<domain>/` the same way, add its tables
in a new migration, and add its layer to `DomainsLive` in
`src/domains/Domains.ts`.

## Outbox

For a side effect that must not be lost (sending a mail, telling another
system), events are the wrong tool: they are in memory and at most once.
Instead the command calls `Outbox.enqueue(topic, payload)`, which writes a row
to `outbox` in the same transaction as the state change (it dies outside a
`Transaction.run`, and rolls back with it). A background worker,
`Outbox.consumer(topic, handle)` in the domain's layer, claims committed rows
(`FOR UPDATE SKIP LOCKED`, reserved with a lease), runs `handle` outside any
transaction and deletes the row when it succeeds.

- Delivery is **at least once**: a worker that dies after the side effect and
  before the delete, or a lease that ran out, causes a second run. Handlers
  must be idempotent.
- Each message is reserved (5 minutes) just before its handler runs, and a
  worker that lost the reservation can no longer complete or fail it. A
  message whose workers keep dying is abandoned once its attempts are used up.
- A failed attempt is logged with its cause and retried with backoff
  (30 seconds, doubling, at most an hour). A payload that no longer decodes
  is given up on at once. After 10 attempts the row gets
  `dead_at` and stays for inspection; `last_error` holds only the kind of
  failure, never its text, since errors tend to quote personal data.
- Payloads are described by a schema (`Outbox.topic(name, schema)`), so a
  payload that no longer decodes after a deploy fails like any other attempt.
- Look at what is stuck with
  `SELECT id, topic, attempts, last_error, dead_at FROM outbox ORDER BY id`.

## Users

Every successful login runs `UserCommands.syncFromLogin`. On the first login
it creates a row in `users` with our own UUID and the Keycloak `sub`
(`UserRegistered`); later logins copy Keycloak's current profile
(`preferred_username`, `name`, `email`, `email_verified`) and the login time
(`UserProfileChanged` if the profile differs). Concurrent first logins of the
same user end up with one row. The first login also grants
`normalUser` (`user_roles`), in the same transaction. Sessions still
reference users by `sub`.

## Moderation

`domains/moderation` owns who holds which role and who is restricted
(`ModerationCommands`: `grantRole`, `revokeRole`, `restrict`,
`liftRestriction`, and `grantInitialRoles` for registration;
`ModerationQueries`: `accessOf`, `standingOf`, `historyOf`). The domains
depend on each other in one direction per layer, so there is no cycle:
moderation acts on users through `UserDirectory` (find and lock a user,
nothing else of the users domain), and `UserCommands.syncFromLogin` calls
`ModerationCommands.grantInitialRoles` inside its own transaction (a
savepoint), so a user never exists without their first role. `UserQueries`
composes the admin overview from `ModerationQueries`. `DomainsLive` wires
it: users' directory, then moderation, then the rest of users.
