# Jiha Dashboard

A Netlify site with website-managed usernames and passwords. Supabase is the database only. The browser never connects directly to Supabase; Netlify Functions validate sessions and enforce permissions.

## Database setup

The original `supabase/schema.sql` and `supabase/username-and-monthly.sql` were run on the project during the earlier version. Run `supabase/custom-auth.sql` once in Supabase SQL Editor for the new login system. Later feature migrations are `supabase/hp-row-controls.sql` and `supabase/weekly-goals-reminders.sql`; run each once before deploying its code. The old Supabase Auth tables and accounts remain unused; they can be removed later after the new site is working.

## Netlify environment variables

Set `SUPABASE_SECRET_KEY` to the project's `sb_secret_...` key. Set `ADMIN_BOOTSTRAP_CODE` to a long random code (at least 24 characters). Both belong in Netlify's server-side environment variables, never in `dist/`, GitHub, or chat. Redeploy after setting them.

The first visit to the new site shows **Set up admin**. The admin enters that bootstrap code and chooses a password of at least 12 characters. The setup action works only while no app users exist. The admin then signs in as `admin` and creates Jiha as a **Manager** (username `jiha`) inside the dashboard. No Supabase Auth account or email is needed. Admin, Jiha and HPs can create HP logins. HP codes are usernames. Creating the `jiha` manager also creates her personal HP table (`JIHA`), and its Actual figures count in the team scoreboard. HPs can edit their own table and the accounts they register.

Passwords are hashed with a unique salt using Node's `scrypt` and stored in `public.app_users`. Sessions use random, hashed tokens in `public.app_sessions` and HttpOnly, Secure, SameSite cookies. Five failed password attempts lock an account for 15 minutes. The Netlify function reads and writes Supabase using its secret key; the browser cannot read the password hashes or secret key.

Admin can set a new password for any user, which revokes that user's sessions. Admin can delete HP logins that never signed in or have not signed in for 90 days. The HP table and report figures remain. Jiha can create HP accounts and edit all tables, but cannot change other users' passwords or delete accounts. HP users can create child HP accounts and edit their own table and those child HP tables.

## Reports

Managers can set the month-end date and extend or shorten the visible monthly timeline. On the first manager visit on or after the end date, a database transaction archives the dashboard and all HP figures, clears target and actual cells, and advances the next end date by one month. Historical figures remain available. Admin and Jiha can show or hide Recruitment, NAHP, AHP, Total HP, T/O, and WS Player separately for each HP; hidden rows keep their values and are excluded from visible totals and exports until shown again. Run `supabase/hp-row-controls.sql` once before deploying this feature. The whole report can be downloaded as UTF-8 CSV for Google Sheets or Excel, and printed.

## Deployment

`main` deploys automatically to Netlify. Keep the custom-auth branch in a draft pull request until `custom-auth.sql` has run and `ADMIN_BOOTSTRAP_CODE` is configured. Merge, deploy, and set the admin password on the website. Never send the bootstrap code or password in chat.

## Weekly goals and Jiha reminders

Each reporting month has four weeks. Admin and Jiha can set all four week-end dates together; the fourth end date also sets the month-end date. The site shows live countdowns to each week end and month end in Kuala Lumpur time. Admin and Jiha can add up to 20 goals per week with a title and optional target. Every signed-in HP can see the goals.

Admin and Jiha can create, edit, and archive reminders for Jiha. Each reminder has a checklist, start date, optional end date, and a repeat schedule (once or every N days, weeks, or months). A due reminder can be checked off each day. Daily completion records are stored in the database and the most recent seven days are shown beside each reminder. Archiving hides a reminder but keeps its history.
