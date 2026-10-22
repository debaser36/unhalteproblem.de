# Food planner

Food data and prices for Germany (`DE`, EUR) and New Zealand (`NZ`, NZD)
from open sources, and weekly meal plans that Claude writes from the priced
foods. Code: `src/domains/food/`, the sources in `src/infrastructure/`
(`OpenPrices`, `OpenFoodFacts`, `StatsNz`, `Claude`), the API in the
`foodPlanner` group of `@unhalteproblem.de/api` (`/food/*`).

**Every endpoint requires the `foodPlanner` role** (`RequireFoodPlanner` on
the group; 401 without a session, 403 without the role), the writes also
the website's `Origin`. Grant it like any role (see
[authorization.md](authorization.md)). All answers are `no-store`.

## Sources

| Source                                                                       | Licence           | What we take                                                                             |
| ---------------------------------------------------------------------------- | ----------------- | ---------------------------------------------------------------------------------------- |
| [Open Food Facts](https://world.openfoodfacts.org)                           | ODbL 1.0 (+ DbCL) | Products by barcode: name, package, categories, ingredients, allergens, vegetarian/vegan |
| [Open Prices](https://prices.openfoodfacts.org)                              | ODbL 1.0          | Prices recorded in shops (receipts, price tags), from the daily dump                     |
| [Stats NZ](https://www.stats.govt.nz/topics/food-price-index) average prices | CC BY 4.0         | About 150 food items, monthly, NZ only: indicative averages over shops in 12 urban areas |
| Claude                                                                       | generated         | Estimated prices for foods without one; the meal plans                                   |

`GET /food/sources` lists them with their licences; anything that shows the
data must credit them (ODbL and CC BY require attribution, and ODbL wants
a derived database shared under the same licence).

Coverage, checked 2026-10-22: Open Prices had about 8,300 German prices of
the last year (6,300 products, 290 loose-produce prices, mostly Berlin and
Munich) and **none** for New Zealand, where Stats NZ is the only real price
source. Supermarket websites (Woolworths NZ, Pak'nSave, REWE, ...) are not
scraped: none offers an API, their terms forbid copying their content, and
they block bots. A permitted source can be added as one more import.

Requests to the open data services send the User-Agent
`unhalteproblem.de-food-planner/0.1 (+https://unhalteproblem.de)`, one
request at a time (Open Food Facts with a 2 second pause in between).

## Imports

`POST /food/imports {country, source}` queues an import (202) and an outbox
consumer runs it (`food.run-import`, lease 1 hour, 3 attempts); poll
`GET /food/imports/:id` for `status` (`queued`, `running`, `succeeded`,
`failed`), the counts and, on failure, the kind of error
(`OpenPricesFailed:prices:503`, never a response body). One import per
country and source can be active (409 `FoodImportAlreadyRunning`); one still
active after 2 hours is marked failed (`stale`) when the next one starts.
Imports only upsert, so running one again is safe and refreshes the data.

| Source           | Countries | What it does                                                                                                                                                                                                                                                                                                                 |
| ---------------- | --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `openPrices`     | DE, NZ    | Streams the dumps, keeps the country's prices of the last year. Category prices (loose produce, e.g. `en:apples` per kg) become items `en:apples/kg` of 1 kg; barcodes are looked up on Open Food Facts (100 per request, up to 3,000 per import, each batch stored as it arrives, skipped if looked up in the last 30 days) |
| `statsNz`        | NZ        | The newest monthly release (tries the last 4 months): one item per series with the package from its title (`Eggs, dozen` = 12 pieces), price dated the 15th of its month                                                                                                                                                     |
| `priceEstimates` | DE, NZ    | Asks Claude for the regular price of up to 300 items with a package but no price (50 per request), stored as source `estimate`                                                                                                                                                                                               |

`GET /food/items?country=…&q=…` searches stored items (all words in name or
brand; `diet`, `priced`, `limit`, `offset`); with `lookup=true` it first
asks Open Food Facts for the term and stores what it finds (without prices:
run `priceEstimates` to price them). A failed lookup is logged and the search
answers from what is stored.

Whether a food is vegetarian or vegan comes from Open Food Facts' labels
and ingredient analysis for products (contradicting tags: the stricter
answer wins), and from the words of the name for generic foods (meat and
fish words first; anything unclear stays unknown). Unknown counts as "no"
for vegetarian and vegan plans.

## Prices and accuracy

A price is always for one package of its item. Each has an **accuracy**, a
guess in percent at how close it is to what the package costs in the
country today, and **where** it can be bought for that price:

| Source                 | Base | Ageing                       | Where                                 |
| ---------------------- | ---- | ---------------------------- | ------------------------------------- |
| Open Prices (product)  | 85   | after 1 month, −3 per month  | the shop, e.g. `Lidl, Berlin`         |
| Open Prices (category) | 80   | after 1 month, −3 per month  | the shop                              |
| discounted Open Prices | −25  |                              | (a promotion, not the usual price)    |
| Stats NZ               | 75   | after 2 months, −4 per month | average of shops in 12 NZ urban areas |
| Claude estimate        | ≤ 40 | −2 per month                 | a typical supermarket in the country  |

Accuracy never goes below 5. The base is stored (`food_prices.accuracy`);
the age is applied when reading (`Pricing.effectiveAccuracy`). An item's
`bestPrice` is the most accurate one today, then the newest, then the
cheapest. Prices older than 2 years are ignored.

## Meal plans

`POST /food/meal-plans` takes the country, people (1 to 8), the meals of
each day, the diet, and optionally a weekly budget, foods to exclude and
free-text preferences. It answers 202 with a `pending` plan; the outbox
consumer `food.write-meal-plan` (lease 20 minutes, 2 attempts) writes it.
Poll `GET /food/meal-plans/:id` until `status` is `ready` or `failed`.

1. **Candidates**: the country's items with a price and a package, of the
   diet, that are groceries (no takeaway, baby food, chewing gum) and not hit
   by an exclusion (a word of the name or brand, or a category, ingredient
   or allergen tag; English exclusions work for German products through the
   English tags). At most 250 go into the prompt, generic foods first, then
   products taking turns between categories.
2. **Claude** (structured output) composes 7 days of the requested meals
   from them, by reference, with amounts in each food's unit.
3. **Checks**: every day once, exactly the requested meals, known foods,
   believable amounts. The shopping list buys whole packages; its total,
   the share resting on estimates and the cost-weighted accuracy are stored.
   A broken plan or one over budget goes back to Claude with the problems,
   3 tries in all.

Failures are part of the plan (`failure.reason`): `noCandidates` (fewer than
15 foods: import first), `overBudget` (with the cheapest total seen),
`invalidPlan`, `plannerFailed` (Claude not reachable or refused; a pending
plan older than an hour also reads as this). Without `ANTHROPIC_API_KEY`
the request answers 503 `MealPlannerUnavailable`.

The user's preferences go into the prompt as a quoted string after the
rules; whatever they say, the backend still checks every plan.

Plans belong to their user: others get 404. Each user may request 20 plans
per day and have 2 pending at once (429). Account deletion keeps the user
row, so `MealPlanCleanup` deletes the plans of deleted accounts once an
hour.

Cost: one plan is one to three Claude requests with a prompt of roughly
10,000 tokens; at the default `claude-opus-5-5` with `CLAUDE_EFFORT=medium`
that is typically well under a dollar. Requests opt into Anthropic's
server-side fallback (`fallbacks: "default"`), so a declined request is
retried on another model instead of failing.

## Tables

`food_items`, `food_prices`, `food_imports`, `meal_plans` (migration 0019;
its doc comment explains the constraints).

## Decisions and limits

- **`lookup=true` on a GET.** A search with lookup stores what Open Food
  Facts finds, so this GET writes. It stays a GET on purpose: what it writes
  is public product data, the same for whoever asks, and only role holders
  can trigger it. It has no `SameOrigin` check, so a cross-site link could
  make a role holder's browser cache products, which is harmless. Lookups
  share the one-request-at-a-time queue with imports and can wait behind one.
- **Stored plans use the contract's shapes.** `meal_plans.request` and
  `.plan` are decoded with `MealPlanRequest`, `MealPlanDay` and
  `ShoppingListEntry` from `@unhalteproblem.de/api`. Tightening those
  schemas (a lower `maxPeople`, a new required field) breaks reading old
  plans: such a contract change needs a data migration of `meal_plans` too.
- **Product prices are crowd data.** Open Food Facts names are editable by
  anyone; they are quoted in prompts and every plan is checked, but a
  misleading name can still skew an estimate (at most 40% accuracy).
- **No supermarket prices.** See Sources; a new source is one more
  `FoodImportSource`, importer and `FoodDataSource` entry.
