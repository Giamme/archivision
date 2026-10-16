# Corner Shop

The online shop of a small homeware brand: a Next.js storefront with a staff back office, TypeScript services for
the catalog, orders, payments and sign-in, and two AWS Lambda services in Python that ship parcels and send emails.
They talk over a NATS event bus.

## What is where

| Folder | Block | What it does |
|---|---|---|
| `apps/web` | Web shop | Next.js 15 (App Router): catalog pages, the cart (in a cookie), checkout with the Stripe payment sheet, account pages |
| `apps/web/src/app/admin` | Back office | Staff only, behind Google Workspace sign-in: stock editor, orders, refunds, discount codes |
| `packages/auth` | Auth gate | Sessions for both; email sign-in links for customers, Google Workspace SSO for staff; `GET /session` |
| `packages/catalog` | Catalog service | Products, categories and stock; holds and releases stock; publishes `stock.changed` |
| `packages/orders` | Order service | Receive → Price (price list, discount codes) → Reserve → Confirm (on `payment.succeeded`) → Keep; publishes `order.confirmed`. `src/worker.ts` is its process |
| `packages/payments` | Payment service | Stripe payment intents, the webhook at `POST /stripe/webhook`, refunds into its own `refunds` table |
| `packages/events` | Event bus | The NATS connection and the typed subjects below |
| `packages/db` | Database | Prisma schema, migrations and the client; the one package that owns tables |
| `services/fulfilment` | Fulfilment worker | Lambda: buys a Sendcloud label on `order.confirmed`, keeps it in S3, tracks the parcel in DynamoDB, publishes `parcel.shipped` |
| `services/notifier` | Notifier | Lambda: sends the `order-confirmed` and `parcel-on-its-way` emails through Postmark, once each |

## The event bus

| Port | Subject | Published by | Heard by |
|---|---|---|---|
| 1 | `stock.changed` | Catalog service | Web shop (cache refresh, through the bus's HTTP bridge to `/api/revalidate`) |
| 2 | `payment.succeeded`, `payment.failed` | Payment service | Order service |
| 3 | `order.confirmed` | Order service | Fulfilment worker, Notifier |
| 4 | `parcel.shipped` | Fulfilment worker | Notifier |

The Lambda services cannot hold a NATS connection: they read their subjects from SQS queues the bridge fills, and
publish into an outbox queue it relays.

**Refunds** go from the back office to the Payment service and Stripe; `payment.failed` is not used for them, and the
Payment service keeps them in its own `refunds` table. Whether the Order service should hear about refunds is still
open.

## Running it locally

You need Node 20+, Docker and the Stripe CLI.

```bash
docker compose up -d postgres nats # Postgres 16 on 5432, NATS on 4222
npm install
npm run db:migrate && npm run db:seed
npm run dev                        # the shop on http://localhost:3000
npm run worker                     # the Order service, in a second terminal
stripe listen --forward-to localhost:3000/api/stripe/webhook
```

Environment: `DATABASE_URL`, `NATS_URL`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`,
`NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`, `POSTMARK_SERVER_TOKEN`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`,
`STAFF_GOOGLE_DOMAIN` and `REVALIDATE_SECRET`. Use Stripe's test mode keys. Sign-in links are printed to the
terminal while `POSTMARK_SERVER_TOKEN` is empty. For the back office, the seed adds `staff@example.com`; change it to
an address of your `STAFF_GOOGLE_DOMAIN`.

## Tests

```bash
npm test             # Vitest: pricing, stock, the Stripe webhook, refunds
npm run test:e2e     # Playwright against a seeded database: checkout, account, back office stock
cd services/fulfilment && pip install -r requirements.txt boto3 "moto[s3,dynamodb,sqs]" pytest && pytest
cd services/notifier && pip install -r requirements.txt boto3 "moto[dynamodb]" pytest && pytest
```

The Python tests run against moto, so they need no AWS account.

## Deploying

- The web app and the Order service's worker deploy as two containers from one image (`next start` and
  `npm run worker`).
- Migrations run from `packages/db` (`npm run deploy --workspace @corner/db`) before the new image starts.
- The Lambda services deploy with the Serverless Framework: `npx serverless deploy` in each service folder. Their
  secrets come from SSM Parameter Store under `/corner-shop/`.

## Conventions

- Money is an integer number of cents with its currency next to it. Never floats.
- Every write a member of staff makes is audited (`AuditLog`), with their staff id.
- Event payloads are defined once, in `packages/events/src/subjects.ts`; the Python services read the same JSON.
- Handlers of bus events must be safe to run twice: NATS and SQS both redeliver.
