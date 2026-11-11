-- Weekly plans use the current reporting period's start date.
create table if not exists public.weekly_plans (
  period_start date not null,
  week_no integer not null check (week_no between 1 and 4),
  end_date date not null,
  goals jsonb not null default '[]'::jsonb check (jsonb_typeof(goals)='array'),
  primary key (period_start,week_no)
);
create table if not exists public.jiha_reminders (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  checklist jsonb not null default '[]'::jsonb check (jsonb_typeof(checklist)='array'),
  repeat_type text not null default 'daily' check (repeat_type in ('none','daily','weekly','monthly')),
  repeat_interval integer not null default 1 check (repeat_interval between 1 and 31),
  starts_on date not null default (now() at time zone 'Asia/Kuala_Lumpur')::date,
  ends_on date,
  active boolean not null default true,
  created_by uuid references public.app_users(id) on delete set null,
  created_at timestamptz not null default now(),
  check (ends_on is null or ends_on >= starts_on)
);
create table if not exists public.jiha_reminder_days (
  reminder_id uuid not null references public.jiha_reminders(id) on delete cascade,
  day date not null,
  checked jsonb not null default '[]'::jsonb check (jsonb_typeof(checked)='array'),
  items_snapshot jsonb not null default '[]'::jsonb check (jsonb_typeof(items_snapshot)='array'),
  updated_at timestamptz not null default now(),
  primary key (reminder_id,day)
);
create index if not exists jiha_reminder_days_day_idx on public.jiha_reminder_days(day);
alter table public.weekly_plans enable row level security;
alter table public.jiha_reminders enable row level security;
alter table public.jiha_reminder_days enable row level security;
revoke all on public.weekly_plans,public.jiha_reminders,public.jiha_reminder_days from anon,authenticated;
grant all on public.weekly_plans,public.jiha_reminders,public.jiha_reminder_days to service_role;
