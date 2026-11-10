-- Run once in the Supabase SQL Editor. Enable Auth email confirmation first.
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  name text not null,
  hp_code text unique,
  parent_uid uuid references auth.users(id)
);
create table if not exists public.hps (
  code text primary key,
  uid uuid unique not null references auth.users(id) on delete cascade,
  parent_uid uuid references auth.users(id),
  email text not null,
  name text not null,
  metrics jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create table if not exists public.hp_invites (
  code text primary key,
  email text not null,
  name text not null,
  parent_uid uuid references auth.users(id),
  created_at timestamptz not null default now()
);
create table if not exists public.dashboards (
  id text primary key,
  values jsonb not null default '{}'::jsonb
);
insert into public.dashboards(id) values ('main') on conflict do nothing;

create or replace function public.is_manager() returns boolean language sql stable security definer set search_path=public as $$
  select exists(select 1 from auth.users where id=auth.uid() and email_confirmed_at is not null
    and lower(email) in ('nikkhaikal@gmail.com','nealia.najihah@gmail.com'));
$$;
create or replace function public.is_member() returns boolean language sql stable security definer set search_path=public as $$
  select exists(select 1 from public.profiles where id=auth.uid());
$$;

alter table public.profiles enable row level security;
alter table public.hps enable row level security;
alter table public.hp_invites enable row level security;
alter table public.dashboards enable row level security;

drop policy if exists "Members read profiles" on public.profiles;
create policy "Members read profiles" on public.profiles for select to authenticated using (public.is_manager() or id=auth.uid());
drop policy if exists "Members read HPs" on public.hps;
create policy "Members read HPs" on public.hps for select to authenticated using (public.is_manager() or public.is_member());
drop policy if exists "Owners and parents update HPs" on public.hps;
create policy "Owners and parents update HPs" on public.hps for update to authenticated using (public.is_manager() or uid=auth.uid() or parent_uid=auth.uid()) with check (public.is_manager() or uid=auth.uid() or parent_uid=auth.uid());
drop policy if exists "Managers read dashboard" on public.dashboards;
create policy "Managers read dashboard" on public.dashboards for select to authenticated using (public.is_manager() or public.is_member());
drop policy if exists "Managers update dashboard" on public.dashboards;
create policy "Managers update dashboard" on public.dashboards for update to authenticated using (public.is_manager()) with check (public.is_manager());
drop policy if exists "Invite recipient and creator read" on public.hp_invites;
create policy "Invite recipient and creator read" on public.hp_invites for select to authenticated using (lower(email)=lower(auth.jwt()->>'email') or parent_uid=auth.uid() or public.is_manager());
drop policy if exists "Members create invitations" on public.hp_invites;
create policy "Members create invitations" on public.hp_invites for insert to authenticated with check (
  code ~ '^[A-Z0-9-]{2,24}$' and length(name) between 1 and 100 and email ~ '^[^@]+@[^@]+\.[^@]+$'
  and ((public.is_manager() and parent_uid is null) or (public.is_member() and parent_uid=auth.uid()))
);

revoke all on public.profiles,public.hps,public.hp_invites,public.dashboards from anon,authenticated;
grant select on public.profiles,public.hps,public.hp_invites,public.dashboards to authenticated;
grant insert on public.hp_invites to authenticated;
grant update(metrics) on public.hps to authenticated;
grant update(values) on public.dashboards to authenticated;
grant execute on function public.is_manager(),public.is_member() to authenticated;

create or replace function public.claim_hp_invite(p_code text) returns text
language plpgsql security definer set search_path=public as $$
declare invitation public.hp_invites%rowtype; verified_email text;
begin
  select lower(email) into verified_email from auth.users where id=auth.uid() and email_confirmed_at is not null;
  if verified_email is null then raise exception 'Confirm your email and sign in first'; end if;
  select * into invitation from public.hp_invites where code=upper(trim(p_code)) for update;
  if not found then raise exception 'Invitation code not found'; end if;
  if lower(invitation.email)<>verified_email then raise exception 'This invitation belongs to another email'; end if;
  if exists(select 1 from public.profiles where id=auth.uid()) then raise exception 'This account already has an HP'; end if;
  insert into public.hps(code,uid,parent_uid,email,name) values(invitation.code,auth.uid(),invitation.parent_uid,verified_email,invitation.name);
  insert into public.profiles(id,email,name,hp_code,parent_uid) values(auth.uid(),verified_email,invitation.name,invitation.code,invitation.parent_uid);
  delete from public.hp_invites where code=invitation.code;
  return invitation.code;
end; $$;
revoke all on function public.claim_hp_invite(text) from public,anon;
grant execute on function public.claim_hp_invite(text) to authenticated;
