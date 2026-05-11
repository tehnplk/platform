-- Chat schema for platform.plkhealth.go.th
-- Tables: conversations, messages, attachments
-- Realtime: postgres_changes on messages + conversations

create extension if not exists "pgcrypto";

-- Realtime container migrates into these schemas; create them up front
-- so its first boot does not fail with "no schema has been selected".
create schema if not exists _realtime;
create schema if not exists realtime;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'postgres') then
    create role postgres nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin bypassrls;
  end if;
end$$;

create table if not exists conversations (
  hoscode          text primary key,
  display_name     text,
  created_at       timestamptz not null default now(),
  last_message_at  timestamptz,
  user_unread      int not null default 0,
  admin_unread     int not null default 0,
  hidden_at        timestamptz
);
alter table conversations add column if not exists hidden_at timestamptz;

create table if not exists messages (
  id          uuid primary key default gen_random_uuid(),
  hoscode     text not null references conversations(hoscode) on delete cascade,
  role        text not null check (role in ('user','admin')),
  body        text not null default '',
  client_id   text,
  team_user_id uuid,
  created_at  timestamptz not null default now(),
  read_at     timestamptz,
  cancelled_at timestamptz
);
alter table messages add column if not exists cancelled_at timestamptz;
alter table messages add column if not exists team_user_id uuid;
create index if not exists messages_hoscode_created_at_idx
  on messages (hoscode, created_at desc);

create table if not exists attachments (
  id            uuid primary key default gen_random_uuid(),
  message_id    uuid not null references messages(id) on delete cascade,
  kind          text not null check (kind in ('image','video','doc')),
  filename      text not null,
  mime_type     text not null,
  size_bytes    int not null,
  duration_ms   int,
  data          bytea not null,
  created_at    timestamptz not null default now()
);
create index if not exists attachments_message_id_idx
  on attachments (message_id);

create table if not exists hospcode (
  hospcode         text primary key,
  name             text,
  chwpart          text,
  amppart          text,
  district         text,
  province         text,
  hospcode_5_digit text,
  hospcode_9_digit text,
  updated_at       timestamptz not null default now()
);
create index if not exists hospcode_5_digit_idx
  on hospcode (hospcode_5_digit);
create index if not exists hospcode_9_digit_idx
  on hospcode (hospcode_9_digit);

create table if not exists push_subscriptions (
  endpoint       text primary key,
  role           text not null check (role in ('admin')),
  subscription   jsonb not null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists push_subscriptions_role_idx
  on push_subscriptions (role);

drop table if exists admin_users;

do $$
begin
  if to_regclass('public.team_users') is null and to_regclass('public.users') is not null then
    alter table users rename to team_users;
  end if;
end$$;

create table if not exists team_users (
  id             uuid primary key default gen_random_uuid(),
  username       text not null unique,
  password_hash  text not null,
  fullname       text,
  area           text,
  department     text,
  role           text not null default 'team' check (role in ('admin','team')),
  is_active      boolean not null default true,
  last_login     timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

alter table team_users add column if not exists fullname text;
alter table team_users add column if not exists area text;

update team_users
   set role = 'team',
       updated_at = now()
 where role not in ('admin','team');

alter table team_users
  alter column role set default 'team';

do $$
declare
  role_check record;
begin
  for role_check in
    select conname
      from pg_constraint
     where conrelid = 'public.team_users'::regclass
       and contype = 'c'
       and pg_get_constraintdef(oid) like '%role%'
  loop
    execute format('alter table public.team_users drop constraint %I', role_check.conname);
  end loop;

  alter table public.team_users
    add constraint team_users_role_check check (role in ('admin','team'));
end$$;

update messages
   set team_user_id = (
     select id
       from team_users
      where role = 'admin'
      order by created_at asc
      limit 1
   )
 where role = 'admin'
   and team_user_id is null;

do $$
begin
  if not exists (
    select 1
      from pg_constraint
     where conname = 'messages_team_user_id_fkey'
       and conrelid = 'public.messages'::regclass
  ) then
    alter table public.messages
      add constraint messages_team_user_id_fkey
      foreign key (team_user_id) references public.team_users(id)
      on delete set null;
  end if;
end$$;

insert into team_users (username, password_hash, role, department)
values (
  'admin',
  'e0bc60c82713f64ef8a57c0c40d02ce24fd0141d5cc3086259c19b1e62a62bea',
  'admin',
  'IT'
)
on conflict (username) do update
  set password_hash = excluded.password_hash,
      role = excluded.role,
      department = excluded.department,
      updated_at = now();

-- Auto-create conversation row + bump last_message_at + unread on insert
create or replace function bump_conversation() returns trigger
  language plpgsql as $$
begin
  insert into conversations (hoscode, last_message_at)
    values (new.hoscode, new.created_at)
    on conflict (hoscode) do update
      set last_message_at = excluded.last_message_at;

  if new.role = 'user' then
    update conversations
       set admin_unread = admin_unread + 1
     where hoscode = new.hoscode;
  else
    update conversations
       set user_unread = user_unread + 1
     where hoscode = new.hoscode;
  end if;

  return new;
end;
$$;

drop trigger if exists messages_bump_conversation on messages;
create trigger messages_bump_conversation
  after insert on messages
  for each row execute function bump_conversation();

-- Retention: keep only last 15 days of messages per hoscode.
-- Triggered on each insert (amortized cleanup; cascades to attachments).
create or replace function purge_old_messages() returns trigger
  language plpgsql as $$
begin
  delete from messages
   where hoscode = new.hoscode
     and created_at < now() - interval '15 days';
  return new;
end;
$$;

drop trigger if exists messages_purge_old on messages;
create trigger messages_purge_old
  after insert on messages
  for each row execute function purge_old_messages();

-- Add tables to realtime publication (created by realtime container)
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    execute 'alter publication supabase_realtime add table messages';
    execute 'alter publication supabase_realtime add table conversations';
  else
    create publication supabase_realtime for table messages, conversations;
  end if;
exception when duplicate_object then
  null;
end$$;
