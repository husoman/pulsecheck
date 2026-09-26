# PulseCheck

A tiny uptime monitor for solo devs and side projects. Add a URL, it gets checked once a day, and you get emailed the moment it stops responding.

**[Live demo](https://pulsecheck-silk-sigma.vercel.app/)**

## What it does

- Sign up, add up to 3 URLs on the free plan
- A daily scheduled job pings each one and records whether it's up
- If a site that was working goes down, you get an email
- Upgrade to Pro (via Stripe) to lift the monitor limit

## Why this exists

Built as a learning project to practice real backend fundamentals — authentication, a database with row-level security, a scheduled job, a transactional email API, and a payment flow — while staying small enough to actually finish.

## Stack

- **Supabase** — Postgres database + user authentication
- **Vercel Serverless Functions** — the API (`/api`)
- **Vercel Cron** — the daily check (see `vercel.json`)
- **Resend** — downtime alert emails
- **Stripe** — the paid plan
- Plain HTML/CSS/JS frontend — no framework, no build step

## Setup

1. **Supabase**: create a project at supabase.com, then paste the contents of `schema.sql` into the SQL Editor and run it. Grab your Project URL, anon key, and service_role key from Settings → API.
2. **Resend**: create an account at resend.com, verify a sending domain (or use their test domain while developing), and grab an API key.
3. **Stripe**: create a product with a recurring monthly price, grab your secret key and the price ID. Set up a webhook pointing at `/api/stripe-webhook` listening for `checkout.session.completed`, and grab its signing secret.
4. Copy `.env.example` to `.env` and fill in all the values.
5. In `public/index.html`, fill in `SUPABASE_URL` and `SUPABASE_ANON_KEY` near the top of the `<script>` tag (the frontend talks to Supabase directly for auth, so these are safe to expose — they're public keys by design).
6. In the Vercel dashboard, add all the same environment variables from `.env` under Project Settings → Environment Variables.

## Running locally

```
npm install
vercel dev
```

(Requires the Vercel CLI: `npm i -g vercel`)

## Deploying

Push to GitHub, import the repo into Vercel. The cron job in `vercel.json` activates automatically on production deploys.

## Known limitations (v1, on purpose)

- Free tier is checked once a day — a Vercel Hobby-plan constraint, not a product choice. An external scheduler (e.g. cron-job.org) hitting `/api/cron-check` more often would be the natural next step for a faster Pro-tier check.
- No check history/uptime percentage graphs yet — just current status.
- No password reset flow yet — Supabase supports this, just not wired into the UI.
