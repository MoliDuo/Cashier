# Cashier

> Turn receipts, invoices, and plain text into a ledger you can verify.

[中文](./README.md)

[![CI/CD](https://github.com/Xiangyu-Labs/Cashier/actions/workflows/ci-cd.yml/badge.svg)](https://github.com/Xiangyu-Labs/Cashier/actions/workflows/ci-cd.yml)
[![License: AGPL v3](https://img.shields.io/badge/License-AGPL_v3-blue.svg)](./LICENSE)

![Cashier stream](./public/readme/stream-desktop.webp)

Cashier began as a bookkeeping tool I built for myself: take a photo of a receipt, or write
something like "lunch, $12", and let AI handle the tedious first pass. I am now opening it up as a
self-hosted project for people who want less data entry without giving up control of their records.

Cashier extracts dates, merchants, amounts, currencies, categories, and line items from images or
text. The result is not a black box: you can review, edit, and retry it, then continue working with
the record in the stream, details, and statistics views.

## What it does

- Records expenses from receipt or invoice images and natural-language notes
- Extracts titles, dates, amounts, currencies, categories, and line items
- Lets you review and edit AI results and retry documents that failed to parse
- Keeps original currencies while reporting totals in the ledger's main currency
- Provides stream, filtered detail, and statistics views
- Creates ledger-scoped API keys for scripts, Shortcuts, and integrations
- Ships a Chinese interface; the AI can write bill content in another language

<picture>
  <source media="(max-width: 600px)" srcset="./public/readme/entry-mobile.webp">
  <img alt="Cashier smart entry form" src="./public/readme/entry-mobile.webp" width="390">
</picture>

## Quick start

Trying it locally needs Node.js 24 and Docker.

```bash
git clone https://github.com/Xiangyu-Labs/Cashier.git
cd Cashier
npm ci
cp .env.local.example .env
```

Fill in the AI key in `.env`. The account, ledger and books are not configured here; the first-run
wizard creates them:

```dotenv
OPENAI_API_KEY=your-api-key
```

Then start PostgreSQL, MinIO, and the app:

```bash
npm run docker:local
npm run db:migrate
npm run dev
```

On the first start, Cashier creates PostgreSQL, the MinIO bucket, and the database schema. It does
not create an account. Open [http://localhost:3000](http://localhost:3000): every page leads to the
`/setup` wizard. The server logs print a one-time setup code, on a line starting with
`First-run setup is pending`. Enter that code, a
sign-in email and your book names (共同支出 is pre-filled as the default) to create the
account; `/setup` returns 404 afterwards. There is no password: sign in with a code sent to that
email (this needs `AUTH_RESEND_KEY`), then add a passkey under 设置.

`AI_MODEL` defaults to `gpt-4o`. When using another OpenAI-compatible service, set both
`OPENAI_BASE_URL` and `AI_MODEL`.

For deploying to Vercel, or for an existing PostgreSQL database, Cloudflare R2, or another
S3-compatible service, see
[Deployment, upgrades, and backups (Chinese)](./docs/deployment.md).

## Before you use it

> **Project status: early public release**

- This is a personal project opened for testing and feedback. It does not yet have a stable release
  or compatibility policy.
- AI can misread a document or choose the wrong category. Review important records after parsing.
- Back up PostgreSQL and object storage before upgrading. The browser startup preview is not a
  backup.
- AI parsing requires network access and a working OpenAI or OpenAI-compatible endpoint.
- Cashier is a bookkeeping tool, not accounting, tax, or financial advice.

## Documentation

- [Deployment, upgrades, and backups (Chinese)](./docs/deployment.md)
- [Configuration reference (Chinese)](./docs/configuration.md)
- [API v1 (Chinese)](./docs/api.md)
- [Contributing](./CONTRIBUTING.md)
- [Runtime architecture](./docs/architecture/runtime-model.md)
- [Architecture and coding patterns](./docs/architecture/coding-patterns.md)

## Local development

Development uses the same stack as the quick start above. Before submitting a change, run:

```bash
npm run check
```

See [CONTRIBUTING.md](./CONTRIBUTING.md) for the full development workflow, including the
standalone demo workspace that needs no `.env`.

## License

Cashier is licensed under the [GNU Affero General Public License v3.0](./LICENSE).
