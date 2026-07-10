-- 黒にんにく管理 GitHub Pages + Supabase版
-- 既存のにんにく冷蔵庫管理と同じSupabaseプロジェクトで同居できるよう、
-- 作業者テーブル workers だけを共有し、黒にんにく用テーブルは black_garlic_ 接頭辞にしています。

create extension if not exists pgcrypto;

create or replace function public.black_garlic_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists public.workers (
  worker_id text primary key,
  worker_name text not null,
  role text not null default 'operator' check (role in ('admin', 'operator', 'viewer')),
  display_order integer not null default 999,
  active boolean not null default true,
  note text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.black_garlic_rooms (
  id uuid primary key default gen_random_uuid(),
  room_name text not null unique,
  display_order integer not null default 999,
  active boolean not null default true,
  note text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.black_garlic_types (
  id uuid primary key default gen_random_uuid(),
  type_name text not null unique,
  display_order integer not null default 999,
  active boolean not null default true,
  note text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.black_garlic_storage_types (
  id uuid primary key default gen_random_uuid(),
  type_name text not null unique,
  display_order integer not null default 999,
  active boolean not null default true,
  note text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.black_garlic_harvest_lots (
  id uuid primary key default gen_random_uuid(),
  lot_name text not null unique,
  harvest_date date not null,
  display_order integer not null default 999,
  active boolean not null default true,
  note text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.black_garlic_age_brackets (
  id uuid primary key default gen_random_uuid(),
  label text not null unique,
  min_days integer not null default 0 check (min_days >= 0),
  max_days integer check (max_days is null or max_days >= min_days),
  display_order integer not null default 999,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.black_garlic_maturation_rules (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.black_garlic_rooms(id) on delete cascade,
  age_bracket_id uuid not null references public.black_garlic_age_brackets(id) on delete cascade,
  maturation_days integer not null default 30 check (maturation_days >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (room_id, age_bracket_id)
);

create table if not exists public.black_garlic_entries (
  id uuid primary key default gen_random_uuid(),
  recorded_at timestamptz not null default now(),
  entry_date date not null,
  worker_id text not null references public.workers(worker_id),
  room_id uuid not null references public.black_garlic_rooms(id),
  type_id uuid not null references public.black_garlic_types(id),
  harvest_lot_id uuid not null references public.black_garlic_harvest_lots(id),
  temperature numeric(8, 2),
  out_qty numeric(12, 2) not null default 0 check (out_qty >= 0),
  in_qty numeric(12, 2) not null default 0 check (in_qty >= 0),
  empty_qty numeric(12, 2) not null default 0 check (empty_qty >= 0),
  inventory_qty numeric(12, 2) not null default 0 check (inventory_qty >= 0),
  inventory_manual boolean not null default false,
  note text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (entry_date, room_id, type_id, harvest_lot_id)
);

create table if not exists public.black_garlic_storage_entries (
  id uuid primary key default gen_random_uuid(),
  recorded_at timestamptz not null default now(),
  storage_date date not null,
  worker_id text not null references public.workers(worker_id),
  storage_type_id uuid not null references public.black_garlic_storage_types(id),
  columns16 integer not null default 0 check (columns16 >= 0),
  pieces integer not null default 0 check (pieces >= 0),
  note text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (storage_date, storage_type_id)
);

create table if not exists public.black_garlic_settings (
  setting_key text primary key,
  setting_value jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_black_garlic_entries_date on public.black_garlic_entries(entry_date);
create index if not exists idx_black_garlic_entries_group on public.black_garlic_entries(room_id, type_id, harvest_lot_id, entry_date);
create index if not exists idx_black_garlic_storage_entries_date on public.black_garlic_storage_entries(storage_date);

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'black_garlic_rooms',
    'black_garlic_types',
    'black_garlic_storage_types',
    'black_garlic_harvest_lots',
    'black_garlic_age_brackets',
    'black_garlic_maturation_rules',
    'black_garlic_entries',
    'black_garlic_storage_entries',
    'black_garlic_settings'
  ]
  loop
    execute format('drop trigger if exists %I_set_updated_at on public.%I', table_name, table_name);
    execute format(
      'create trigger %I_set_updated_at before update on public.%I for each row execute function public.black_garlic_set_updated_at()',
      table_name,
      table_name
    );
  end loop;
end $$;

insert into public.workers (worker_id, worker_name, role, display_order, active, note)
values ('admin', '管理者', 'admin', 1, true, '')
on conflict (worker_id) do nothing;

insert into public.black_garlic_rooms (room_name, display_order) values
  ('六戸①', 1),
  ('六戸②', 2),
  ('六戸③', 3),
  ('六戸④', 4),
  ('六戸⑤', 5),
  ('十和田①', 6),
  ('十和田②', 7),
  ('新室①', 8),
  ('新室②', 9)
on conflict (room_name) do nothing;

insert into public.black_garlic_types (type_name, display_order) values
  ('エイト', 1),
  ('青幸', 2),
  ('TF', 3)
on conflict (type_name) do nothing;

insert into public.black_garlic_storage_types (type_name, display_order) values
  ('エイト', 1),
  ('青幸', 2),
  ('TF', 3),
  ('S玉', 4),
  ('線虫', 5),
  ('D級', 6),
  ('むき黒', 7)
on conflict (type_name) do nothing;

insert into public.black_garlic_harvest_lots (lot_name, harvest_date, display_order) values
  ('未指定', current_date, 1)
on conflict (lot_name) do nothing;

insert into public.black_garlic_age_brackets (label, min_days, max_days, display_order) values
  ('0-30日', 0, 30, 1),
  ('31-60日', 31, 60, 2),
  ('61-120日', 61, 120, 3),
  ('121日以上', 121, null, 4)
on conflict (label) do nothing;

insert into public.black_garlic_maturation_rules (room_id, age_bracket_id, maturation_days)
select r.id, b.id, 30
  from public.black_garlic_rooms r
 cross join public.black_garlic_age_brackets b
on conflict (room_id, age_bracket_id) do nothing;

insert into public.black_garlic_settings (setting_key, setting_value)
values ('prediction', '{"avgUsage": 0}'::jsonb)
on conflict (setting_key) do nothing;

alter table public.workers enable row level security;
alter table public.black_garlic_rooms enable row level security;
alter table public.black_garlic_types enable row level security;
alter table public.black_garlic_storage_types enable row level security;
alter table public.black_garlic_harvest_lots enable row level security;
alter table public.black_garlic_age_brackets enable row level security;
alter table public.black_garlic_maturation_rules enable row level security;
alter table public.black_garlic_entries enable row level security;
alter table public.black_garlic_storage_entries enable row level security;
alter table public.black_garlic_settings enable row level security;

drop policy if exists black_garlic_workers_read on public.workers;
create policy black_garlic_workers_read on public.workers for select to anon using (true);

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'black_garlic_rooms',
    'black_garlic_types',
    'black_garlic_storage_types',
    'black_garlic_harvest_lots',
    'black_garlic_age_brackets',
    'black_garlic_maturation_rules',
    'black_garlic_entries',
    'black_garlic_storage_entries',
    'black_garlic_settings'
  ]
  loop
    execute format('drop policy if exists anon_all_%I on public.%I', table_name, table_name);
    execute format('create policy anon_all_%I on public.%I for all to anon using (true) with check (true)', table_name, table_name);
  end loop;
end $$;

grant usage on schema public to anon;
grant select on public.workers to anon;
grant select, insert, update, delete on public.black_garlic_rooms to anon;
grant select, insert, update, delete on public.black_garlic_types to anon;
grant select, insert, update, delete on public.black_garlic_storage_types to anon;
grant select, insert, update, delete on public.black_garlic_harvest_lots to anon;
grant select, insert, update, delete on public.black_garlic_age_brackets to anon;
grant select, insert, update, delete on public.black_garlic_maturation_rules to anon;
grant select, insert, update, delete on public.black_garlic_entries to anon;
grant select, insert, update, delete on public.black_garlic_storage_entries to anon;
grant select, insert, update, delete on public.black_garlic_settings to anon;
