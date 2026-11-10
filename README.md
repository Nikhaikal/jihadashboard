# Jiha Dashboard

A Netlify site in `dist/` with Supabase Auth and Postgres. GitHub `main` deploys to Netlify. HP logins use their HP code as username; no signup or password emails are sent.

## Required one-time setup

1. In Supabase SQL Editor, run `supabase/schema.sql` if it has not already been run, then run `supabase/username-and-monthly.sql` once. This preserves HP reports when an inactive login is deleted and adds monthly archives.
2. In Netlify, open **Site configuration → Environment variables** and add `SUPABASE_SECRET_KEY` with the Supabase project's **secret** key (`sb_secret_...`). Restrict it to Functions if Netlify offers that scope. Never put this key in `dist/`, GitHub, or a chat message. Redeploy after saving it.
3. In Supabase **Authentication → Providers → Email**, turn off **Confirm email** and **Allow new users to sign up**. Existing users can still sign in. The Netlify function creates users through the server-side admin API with their email marked confirmed.
4. The existing admin account `nikkhaikal@gmail.com` signs in as `admin` using its Supabase password. If that password is unknown, set it directly in Supabase **Authentication → Users**. This is the initial bootstrap step and does not send email.
5. Create/confirm the Jiha account `nealia.najihah@gmail.com` in Supabase **Authentication → Users**, with a password, then Jiha signs in as `jiha`. The admin may later change Jiha's password from Admin account controls.

Do not add the secret key as a normal website variable or client-side JavaScript. It bypasses Row Level Security and belongs only in Netlify Functions.

## Accounts and access

Admin and Jiha can create HP accounts from the dashboard using an HP code, name, and initial password of at least 12 characters. The HP code is the username. The account is created without email. HP users can edit their own table; managers can edit all tables. Only admin can set any user's password and delete an HP login. The delete control is enabled only when that HP has never signed in or has not signed in for at least 90 days. Deleting the login keeps the HP table and prior report figures; managers can still view and edit them.

New passwords are entered by the admin and shared directly with the user. The site does not show an existing password. An HP who forgets their password asks the admin for a new one.

## Monthly reports

A manager can extend or shorten the visible monthly timeline by setting its start and end dates. Notes are stored by calendar month, so shortening the timeline does not delete them. A manager also sets the month-end date. When a manager first opens the dashboard on or after that date, a database transaction archives the main dashboard and all HP figures, clears target and actual cells for the new period, and advances the next end date by one month. The report history remains viewable. The whole report downloads as UTF-8 CSV, which Google Sheets and Excel can open, and the page has a print view. If nobody opens the dashboard on the end date, closing happens on the next manager visit.

## Existing Firebase data

Firebase accounts and passwords do not transfer. Existing HP data, if any, must be migrated separately before retiring Firebase.
