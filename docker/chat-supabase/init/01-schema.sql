-- Chat schema for platform.plkhealth.go.th
-- Tables: conversations, messages, attachments
-- Realtime: postgres_changes on messages + conversations

create extension if not exists "pgcrypto";

-- Realtime container migrates into these schemas; create them up front
-- so its first boot does not fail with "no schema has been selected".
create schema if not exists _realtime;
create schema if not exists realtime;

create table if not exists conversations (
  hoscode          text primary key,
  display_name     text,
  created_at       timestamptz not null default now(),
  last_message_at  timestamptz,
  user_unread      int not null default 0,
  admin_unread     int not null default 0
);

create table if not exists messages (
  id          uuid primary key default gen_random_uuid(),
  hoscode     text not null references conversations(hoscode) on delete cascade,
  role        text not null check (role in ('user','admin')),
  body        text not null default '',
  client_id   text,
  created_at  timestamptz not null default now(),
  read_at     timestamptz
);
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
