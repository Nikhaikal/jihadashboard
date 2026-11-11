-- Keep row visibility per HP across monthly resets.
alter table public.team_hps
  add column if not exists hidden_rows jsonb not null default '[]'::jsonb;

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
