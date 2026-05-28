create extension if not exists pgcrypto;

create table if not exists public.rooms (
  id text primary key,
  created_at timestamptz not null default now()
);

create table if not exists public.players (
  id uuid primary key,
  name text not null,
  created_at timestamptz not null default now(),
  constraint players_name_not_blank check (length(trim(name)) > 0)
);

create table if not exists public.room_players (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references public.players(id) on delete cascade,
  room_id text not null references public.rooms(id) on delete cascade,
  chips integer not null default 1000,
  joined_at timestamptz not null default now(),
  constraint room_players_chips_non_negative check (chips >= 0),
  constraint room_players_room_id_player_id_key unique (room_id, player_id)
);

create table if not exists public.transactions (
  id uuid primary key default gen_random_uuid(),
  room_id text not null references public.rooms(id) on delete cascade,
  from_player uuid not null references public.players(id),
  to_player uuid not null references public.players(id),
  from_player_name text not null,
  to_player_name text not null,
  amount integer not null,
  timestamp timestamptz not null default now(),
  constraint transactions_from_player_name_not_blank check (length(trim(from_player_name)) > 0),
  constraint transactions_to_player_name_not_blank check (length(trim(to_player_name)) > 0),
  constraint transactions_amount_positive check (amount > 0),
  constraint transactions_distinct_players check (from_player <> to_player)
);

alter table public.rooms
  add column if not exists created_at timestamptz not null default now();

alter table public.players
  add column if not exists name text,
  add column if not exists created_at timestamptz not null default now();

alter table public.room_players
  add column if not exists id uuid default gen_random_uuid(),
  add column if not exists chips integer not null default 1000,
  add column if not exists joined_at timestamptz not null default now();

alter table public.transactions
  add column if not exists from_player_name text,
  add column if not exists to_player_name text,
  add column if not exists amount integer,
  add column if not exists timestamp timestamptz not null default now();

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'players_name_not_blank'
  ) then
    alter table public.players
      add constraint players_name_not_blank check (length(trim(name)) > 0);
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'room_players_chips_non_negative'
  ) then
    alter table public.room_players
      add constraint room_players_chips_non_negative check (chips >= 0);
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'room_players_room_id_player_id_key'
  ) then
    alter table public.room_players
      add constraint room_players_room_id_player_id_key unique (room_id, player_id);
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'transactions_from_player_name_not_blank'
  ) then
    alter table public.transactions
      add constraint transactions_from_player_name_not_blank
      check (from_player_name is null or length(trim(from_player_name)) > 0);
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'transactions_to_player_name_not_blank'
  ) then
    alter table public.transactions
      add constraint transactions_to_player_name_not_blank
      check (to_player_name is null or length(trim(to_player_name)) > 0);
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'transactions_amount_positive'
  ) then
    alter table public.transactions
      add constraint transactions_amount_positive check (amount > 0);
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'transactions_distinct_players'
  ) then
    alter table public.transactions
      add constraint transactions_distinct_players check (from_player <> to_player);
  end if;
end;
$$;

create index if not exists room_players_room_id_idx
  on public.room_players(room_id);

create index if not exists room_players_player_id_idx
  on public.room_players(player_id);

create index if not exists transactions_room_id_timestamp_idx
  on public.transactions(room_id, timestamp desc);

alter table public.rooms enable row level security;
alter table public.players enable row level security;
alter table public.room_players enable row level security;
alter table public.transactions enable row level security;

do $$
begin
  if not exists (
    select 1
      from pg_publication_tables
     where pubname = 'supabase_realtime'
       and schemaname = 'public'
       and tablename = 'room_players'
  ) then
    alter publication supabase_realtime add table public.room_players;
  end if;

  if not exists (
    select 1
      from pg_publication_tables
     where pubname = 'supabase_realtime'
       and schemaname = 'public'
       and tablename = 'transactions'
  ) then
    alter publication supabase_realtime add table public.transactions;
  end if;
end;
$$;

drop policy if exists rooms_select_public on public.rooms;
drop policy if exists rooms_insert_public on public.rooms;
drop policy if exists players_select_public on public.players;
drop policy if exists players_insert_public on public.players;
drop policy if exists players_update_public on public.players;
drop policy if exists room_players_select_public on public.room_players;
drop policy if exists room_players_insert_public on public.room_players;
drop policy if exists room_players_delete_public on public.room_players;
drop policy if exists transactions_select_public on public.transactions;

create policy rooms_select_public
  on public.rooms for select
  using (true);

create policy rooms_insert_public
  on public.rooms for insert
  with check (length(trim(id)) > 0);

create policy players_select_public
  on public.players for select
  using (true);

create policy players_insert_public
  on public.players for insert
  with check (length(trim(name)) > 0);

create policy players_update_public
  on public.players for update
  using (true)
  with check (length(trim(name)) > 0);

create policy room_players_select_public
  on public.room_players for select
  using (true);

create policy room_players_insert_public
  on public.room_players for insert
  with check (chips = 1000);

create policy room_players_delete_public
  on public.room_players for delete
  using (true);

create policy transactions_select_public
  on public.transactions for select
  using (true);

create or replace function public.transfer_chips(
  p_room_id text,
  p_from_player uuid,
  p_to_player uuid,
  p_amount integer
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_member_count integer;
  v_sender_chips integer;
  v_from_player_name text;
  v_to_player_name text;
begin
  if p_amount <= 0 then
    raise exception 'Transfer amount must be positive';
  end if;

  if p_from_player = p_to_player then
    raise exception 'Cannot transfer chips to yourself';
  end if;

  with locked_room_players as (
    select room_players.player_id, room_players.chips, players.name
      from room_players
      join players on players.id = room_players.player_id
     where room_players.room_id = p_room_id
       and room_players.player_id in (p_from_player, p_to_player)
     order by room_players.player_id
       for update of room_players
  )
  select
    count(*),
    max(chips) filter (where player_id = p_from_player),
    max(name) filter (where player_id = p_from_player),
    max(name) filter (where player_id = p_to_player)
    into v_member_count, v_sender_chips, v_from_player_name, v_to_player_name
    from locked_room_players;

  if v_member_count <> 2 then
    raise exception 'Both players must be in this room';
  end if;

  if v_sender_chips < p_amount then
    raise exception 'Insufficient chips';
  end if;

  update room_players
     set chips = chips - p_amount
   where room_id = p_room_id
     and player_id = p_from_player;

  update room_players
     set chips = chips + p_amount
   where room_id = p_room_id
     and player_id = p_to_player;

  insert into transactions (
    room_id,
    from_player,
    to_player,
    from_player_name,
    to_player_name,
    amount
  )
  values (
    p_room_id,
    p_from_player,
    p_to_player,
    v_from_player_name,
    v_to_player_name,
    p_amount
  );
end;
$$;

grant usage on schema public to anon, authenticated;

grant select, insert on public.rooms to anon, authenticated;
grant select, insert, update on public.players to anon, authenticated;
grant select, insert, delete on public.room_players to anon, authenticated;
grant select on public.transactions to anon, authenticated;
grant execute on function public.transfer_chips(text, uuid, uuid, integer) to anon, authenticated;
