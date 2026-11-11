-- Run in Supabase SQL Editor after username-and-monthly.sql.
-- The browser never accesses these tables. Netlify Functions use the secret key.
create table if not exists public.app_users (
  id uuid primary key default gen_random_uuid(),
  username text not null unique check (username ~ '^[a-z0-9-]{2,24}$'),
  name text not null,
  role text not null check (role in ('admin','manager','hp')),
  password_hash text not null,
  active boolean not null default true,
  failed_attempts integer not null default 0,
  locked_until timestamptz,
  last_sign_in_at timestamptz,
  created_at timestamptz not null default now()
);
create table if not exists public.app_sessions (
  token_hash text primary key,
  user_id uuid not null references public.app_users(id) on delete cascade,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index if not exists app_sessions_user_idx on public.app_sessions(user_id);
create table if not exists public.team_hps (
  code text primary key,
  owner_id uuid unique references public.app_users(id) on delete set null,
  parent_id uuid references public.app_users(id) on delete set null,
  name text not null,
  metrics jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create table if not exists public.team_dashboard (
  id text primary key default 'main' check (id='main'),
  values jsonb not null default '{}'::jsonb
);
insert into public.team_dashboard(id) values ('main') on conflict do nothing;
update public.team_dashboard set values=(select values from public.dashboards where id='main')
  where id='main' and values='{}'::jsonb and exists(select 1 from public.dashboards where id='main');
insert into public.team_hps(code,name,metrics)
  select code,name,metrics from public.hps on conflict (code) do nothing;
alter table public.app_users enable row level security;
alter table public.app_sessions enable row level security;
alter table public.team_hps enable row level security;
alter table public.team_dashboard enable row level security;
revoke all on public.app_users,public.app_sessions,public.team_hps,public.team_dashboard from anon,authenticated;
grant all on public.app_users,public.app_sessions,public.team_hps,public.team_dashboard,public.report_settings,public.monthly_reports to service_role;
grant usage,select on all sequences in schema public to service_role;

create or replace function public.close_team_month() returns boolean
language plpgsql security definer set search_path=public as $$
declare setting public.report_settings%rowtype; next_month date; last_day date; new_end date; did_close boolean := false;
begin
  select * into setting from public.report_settings where id='main' for update;
  while setting.period_end <= (now() at time zone 'Asia/Kuala_Lumpur')::date loop
    did_close := true;
    insert into public.monthly_reports(period_start,period_end,dashboard_values,hp_values)
    select setting.period_start,setting.period_end,
      (select values from public.team_dashboard where id='main'),
      coalesce((select jsonb_agg(jsonb_build_object('code',code,'name',name,'metrics',metrics,'hidden_rows',hidden_rows) order by code) from public.team_hps),'[]'::jsonb);
    update public.team_dashboard set values=(select coalesce(jsonb_object_agg(key,value),'{}'::jsonb) from jsonb_each(values) where key like '%-label' or key like 'month-%') where id='main';
    update public.team_hps set metrics=(select coalesce(jsonb_object_agg(key,value),'{}'::jsonb) from jsonb_each(metrics) where key like '%-label');
    next_month := date_trunc('month',setting.period_end+interval '1 month')::date;
    last_day := (next_month+interval '1 month - 1 day')::date;
    new_end := next_month + least(setting.closing_day,extract(day from last_day)::integer)-1;
    update public.report_settings set period_start=setting.period_end+1,period_end=new_end where id='main';
    setting.period_start := setting.period_end+1;
    setting.period_end := new_end;
  end loop;
  return did_close;
end; $$;
revoke all on function public.close_team_month() from public,anon,authenticated;
grant execute on function public.close_team_month() to service_role;
