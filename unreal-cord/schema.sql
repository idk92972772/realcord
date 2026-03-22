-- Run this in your Supabase SQL Editor (safe to re-run)

-- Profiles
create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text not null,
  avatar_color text default '#5865f2',
  avatar_url text,
  bio text,
  status text default 'offline',
  is_admin boolean default false,
  banned boolean default false,
  created_at timestamptz default now()
);

-- Servers
create table if not exists servers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  icon text,
  description text,
  invite_code text unique default substr(md5(random()::text), 1, 8),
  owner_id uuid references profiles(id) on delete set null,
  created_at timestamptz default now()
);

-- Server Members
create table if not exists server_members (
  id uuid primary key default gen_random_uuid(),
  server_id uuid references servers(id) on delete cascade,
  user_id uuid references profiles(id) on delete cascade,
  role text default 'member',
  nickname text,
  joined_at timestamptz default now(),
  unique(server_id, user_id)
);

-- Channels
create table if not exists channels (
  id uuid primary key default gen_random_uuid(),
  server_id uuid references servers(id) on delete cascade,
  name text not null,
  type text default 'text',
  topic text,
  category text default 'TEXT CHANNELS',
  position int default 0,
  nsfw boolean default false,
  slowmode int default 0,
  created_at timestamptz default now()
);

-- Direct Messages
create table if not exists direct_messages (
  id uuid primary key default gen_random_uuid(),
  user1_id uuid references profiles(id) on delete cascade,
  user2_id uuid references profiles(id) on delete cascade,
  created_at timestamptz default now()
);

-- Messages
create table if not exists messages (
  id uuid primary key default gen_random_uuid(),
  channel_id uuid references channels(id) on delete cascade,
  dm_id uuid references direct_messages(id) on delete cascade,
  user_id uuid references profiles(id) on delete set null,
  content text,
  reactions jsonb default '{}',
  edited boolean default false,
  reply_to uuid references messages(id) on delete set null,
  pinned boolean default false,
  created_at timestamptz default now()
);

-- Roles
create table if not exists roles (
  id uuid primary key default gen_random_uuid(),
  server_id uuid references servers(id) on delete cascade,
  name text not null,
  color text default '#99aab5',
  permissions jsonb default '{}',
  position int default 0,
  created_at timestamptz default now()
);

-- Enable Realtime (safe to skip if already added)
do $$ begin
  alter publication supabase_realtime add table messages;
exception when others then null; end $$;
do $$ begin
  alter publication supabase_realtime add table profiles;
exception when others then null; end $$;
do $$ begin
  alter publication supabase_realtime add table server_members;
exception when others then null; end $$;

-- RLS
alter table profiles enable row level security;
alter table servers enable row level security;
alter table server_members enable row level security;
alter table channels enable row level security;
alter table messages enable row level security;
alter table direct_messages enable row level security;
alter table roles enable row level security;

drop policy if exists "Public profiles" on profiles;
drop policy if exists "Public servers" on servers;
drop policy if exists "Public server_members" on server_members;
drop policy if exists "Public channels" on channels;
drop policy if exists "Public messages" on messages;
drop policy if exists "Public direct_messages" on direct_messages;
drop policy if exists "Public roles" on roles;

create policy "Public profiles" on profiles for all using (true) with check (true);
create policy "Public servers" on servers for all using (true) with check (true);
create policy "Public server_members" on server_members for all using (true) with check (true);
create policy "Public channels" on channels for all using (true) with check (true);
create policy "Public messages" on messages for all using (true) with check (true);
create policy "Public direct_messages" on direct_messages for all using (true) with check (true);
create policy "Public roles" on roles for all using (true) with check (true);

-- Set admin UUID
insert into profiles (id, username, avatar_color, is_admin, status)
values ('d0de9c14-6ff8-416d-8bdf-8e22adfbadc3', 'Admin', '#5865f2', true, 'online')
on conflict (id) do update set is_admin = true;
