# Poker Chip Tracker

A small live poker chip tracker built with React, Vite, Tailwind CSS, and Supabase.

## Local Development

```sh
npm ci
npm run dev
```

Create `.env.local` with:

```sh
VITE_SUPABASE_URL=your-supabase-url
VITE_SUPABASE_ANON_KEY=your-supabase-anon-key
```

## Supabase Setup

Apply the database setup before deploying the frontend:

```sql
supabase/sql/001_schema.sql
```

This creates or updates:

- `rooms`
- `players`
- `room_players`
- `transactions`
- constraints for unique room membership, positive transfers, and non-negative chip balances
- RLS policies that prevent direct chip balance updates and direct transaction inserts
- the `transfer_chips` RPC used by the frontend

Chip transfers must go through `transfer_chips` so balance updates and transaction history stay consistent.

This app currently uses a localStorage player id instead of Supabase Auth. That means RLS can block unsafe table writes, but it cannot prove a browser really owns a given player id. Add Supabase Auth before using this for anything that needs real identity or anti-cheat guarantees.

## CI/CD

The GitHub Actions workflow in `.github/workflows/deploy.yml` applies the Supabase schema before deploying the frontend to GitHub Pages.

Add these repository secrets in GitHub:

```sh
SUPABASE_DB_URL=postgresql://postgres.your-project-ref:your-password@aws-0-your-region.pooler.supabase.com:6543/postgres?sslmode=require
VITE_SUPABASE_URL=https://your-project-ref.supabase.co
VITE_SUPABASE_ANON_KEY=your-supabase-publishable-key
```

Use the Supavisor pooler connection string for `SUPABASE_DB_URL`, not the direct `db.<project-ref>.supabase.co` connection string. GitHub Actions does not support IPv6-only direct database connections. In Supabase, open the project, click **Connect**, choose the pooler connection string, and use transaction mode on port `6543`.

Do not use the secret API key in the frontend env vars.

## Checks

```sh
npm run lint
npm run build
```
