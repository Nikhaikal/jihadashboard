-- Run after schema.sql in the Supabase SQL Editor.
-- Keep HP results when an inactive login is deleted.
alter table public.hps alter column uid drop not null;
alter table public.hps drop constraint if exists hps_uid_fkey;
alter table public.hps add constraint hps_uid_fkey foreign key (uid) references auth.users(id) on delete set null;
alter table public.hps drop constraint if exists hps_parent_uid_fkey;
alter table public.hps add constraint hps_parent_uid_fkey foreign key (parent_uid) references auth.users(id) on delete set null;
alter table public.profiles drop constraint if exists profiles_parent_uid_fkey;
alter table public.profiles add constraint profiles_parent_uid_fkey foreign key (parent_uid) references auth.users(id) on delete set null;
alter table public.hp_invites drop constraint if exists hp_invites_parent_uid_fkey;
alter table public.hp_invites add constraint hp_invites_parent_uid_fkey foreign key (parent_uid) references auth.users(id) on delete set null;

create table if not exists public.report_settings (
  id text primary key default 'main' check (id='main'),
  period_end date not null default ((now() at time zone 'Asia/Kuala_Lumpur')::date + interval '1 month')::date,
  period_start date not null default (now() at time zone 'Asia/Kuala_Lumpur')::date,
  closing_day integer not null default extract(day from (now() at time zone 'Asia/Kuala_Lumpur'))::integer check (closing_day between 1 and 31),
  timeline_start date not null default make_date(extract(year from (now() at time zone 'Asia/Kuala_Lumpur'))::integer,12,1),
  timeline_end date not null default make_date(extract(year from (now() at time zone 'Asia/Kuala_Lumpur'))::integer+1,5,31),
  constraint timeline_order check (timeline_end >= timeline_start and timeline_end <= timeline_start + interval '2 years'),
  constraint report_period_order check (period_end >= period_start)
);
insert into public.report_settings(id) values ('main') on conflict do nothing;
create table if not exists public.monthly_reports (
  id bigint generated always as identity primary key,
  period_start date not null,
  period_end date not null unique,
  dashboard_values jsonb not null,
  hp_values jsonb not null,
  closed_at timestamptz not null default now()
);
alter table public.report_settings enable row level security;
alter table public.monthly_reports enable row level security;
drop policy if exists "Members read report settings" on public.report_settings;
create policy "Members read report settings" on public.report_settings for select to authenticated using (public.is_manager() or public.is_member());
drop policy if exists "Managers edit report settings" on public.report_settings;
create policy "Managers edit report settings" on public.report_settings for update to authenticated using (public.is_manager()) with check (public.is_manager());
drop policy if exists "Members read monthly reports" on public.monthly_reports;
create policy "Members read monthly reports" on public.monthly_reports for select to authenticated using (public.is_manager() or public.is_member());
grant select on public.report_settings,public.monthly_reports to authenticated;
grant update(period_end,closing_day,timeline_start,timeline_end) on public.report_settings to authenticated;

create or replace function public.close_due_month() returns boolean
language plpgsql security definer set search_path=public as $$
declare setting public.report_settings%rowtype; next_month date; last_day date; new_end date; did_close boolean := false;
begin
  if not public.is_manager() then raise exception 'Only managers can close a month'; end if;
  select * into setting from public.report_settings where id='main' for update;
  if setting.period_end > (now() at time zone 'Asia/Kuala_Lumpur')::date then return false; end if;
  while setting.period_end <= (now() at time zone 'Asia/Kuala_Lumpur')::date loop
  did_close := true;
  insert into public.monthly_reports(period_start,period_end,dashboard_values,hp_values)
  select setting.period_start,setting.period_end,
    (select values from public.dashboards where id='main'),
    coalesce((select jsonb_agg(jsonb_build_object('code',code,'name',name,'metrics',metrics) order by code) from public.hps),'[]'::jsonb);
  update public.dashboards set values=(select coalesce(jsonb_object_agg(key,value),'{}'::jsonb) from jsonb_each(values) where key like '%-label' or key like 'month-%') where id='main';
  update public.hps set metrics=(select coalesce(jsonb_object_agg(key,value),'{}'::jsonb) from jsonb_each(metrics) where key like '%-label');
  next_month := date_trunc('month',setting.period_end+interval '1 month')::date;
  last_day := (next_month+interval '1 month - 1 day')::date;
  new_end := next_month + least(setting.closing_day,extract(day from last_day)::integer)-1;
  update public.report_settings set period_start=setting.period_end+1,
    period_end=new_end where id='main';
  setting.period_start := setting.period_end+1;
  setting.period_end := new_end;
  end loop;
  return did_close;
end; $$;
revoke all on function public.close_due_month() from public,anon;
grant execute on function public.close_due_month() to authenticated;
