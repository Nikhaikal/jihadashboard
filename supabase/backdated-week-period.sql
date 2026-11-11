-- Change the active period's start and four week ends together, preserving goals.
create or replace function public.set_week_period(p_start date,p_ends date[]) returns void
language plpgsql security definer set search_path=public as $$
declare setting public.report_settings%rowtype; latest_archive date;
begin
  select * into setting from public.report_settings where id='main' for update;
  if setting.id is null or p_start is null or array_length(p_ends,1)<>4 or
     p_ends[1] is null or p_ends[2] is null or p_ends[3] is null or p_ends[4] is null or
     p_ends[1]<p_start or p_ends[2]<=p_ends[1] or p_ends[3]<=p_ends[2] or p_ends[4]<=p_ends[3] then
    raise exception 'Choose a start date and four increasing week-end dates';
  end if;
  select max(period_end) into latest_archive from public.monthly_reports;
  if latest_archive is not null and p_start<=latest_archive then
    raise exception 'The current period cannot overlap an archived report';
  end if;
  if p_start<>setting.period_start and exists(select 1 from public.weekly_plans where period_start=p_start) then
    raise exception 'Weekly plans already exist for that start date';
  end if;
  update public.report_settings
  set period_start=p_start,period_end=p_ends[4],closing_day=extract(day from p_ends[4])::integer
  where id='main';
  update public.weekly_plans
  set period_start=p_start,end_date=p_ends[week_no]
  where period_start=setting.period_start;
end; $$;
revoke all on function public.set_week_period(date,date[]) from public,anon,authenticated;
grant execute on function public.set_week_period(date,date[]) to service_role;
