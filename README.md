# Jiha Dashboard

The website is a static Netlify site in `dist/`, with Supabase for sign-in and shared data. GitHub `main` deploys automatically to Netlify. `netlify.toml` sets `dist` as the publish directory; no build command is required.

## Set up Supabase

1. Open the Supabase project `qsqsdhvfvqrckcridoiq`.
2. In **Authentication → Providers → Email**, enable email/password sign-up and **Confirm email**. Email confirmation is required for the manager security rule and HP invitation claims.
3. Open **SQL Editor → New query**. Paste and run the entire contents of [`supabase/schema.sql`](supabase/schema.sql). The SQL creates the tables, access rules, and the free-plan `claim_hp_invite` database function.
4. In **Authentication → URL Configuration**, set the Site URL to `https://jihadashboard.netlify.app` and add `https://jihadashboard.netlify.app/**` as a redirect URL.
5. The website’s public Project URL and publishable key are in `dist/supabase-config.js`. Never put a Supabase secret or service-role key in this folder.

## First sign-in and HP registration

The admin (`nikkhaikal@gmail.com`) and Jiha (`nealia.najihah@gmail.com`) choose **Create my login** with their email and a new password. They confirm their email and sign in. Their verified addresses grant team manager access; the password from Firebase does not transfer.

A manager registers an HP code, name, and email. This creates an invitation in Supabase. The new HP chooses **Create my login**, confirms their email, signs in, and claims the code. That account can then register another HP under it. Each HP can edit their own table and the tables of HPs they directly registered. The admin and Jiha can edit all HP tables and the main dashboard. These permissions are enforced by Supabase Row Level Security.

The team scoreboard sums the HP tables’ Actual Recruitment, NAHP, AHP, Total HP, Keyin, and Net values. Target Collection goes in its Target cell and Actual Collection goes in its Actual cell. SHI Personal is `Actual Collection / Target Collection × 100` for one HP. SHI Group uses the sums across all HPs. Zero or blank targets display a dash.

## Existing Firebase data

This code switches the website to Supabase, but does not automatically transfer data from Firebase. If there are existing HP records or dashboard values, export them before retiring Firebase and import them into the Supabase tables. Existing Firebase passwords cannot be copied; people create new Supabase logins.
