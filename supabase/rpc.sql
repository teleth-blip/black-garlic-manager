-- 任意実行用RPC。通常の画面操作は静的アプリから直接テーブルを更新します。
-- 大量データ投入後や整合性チェック時にSupabase SQL Editorで実行してください。

create or replace function public.black_garlic_ping()
returns jsonb
language sql
stable
as $$
  select jsonb_build_object('ok', true, 'checked_at', now());
$$;

create or replace function public.black_garlic_recalculate_inventory()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  group_row record;
  entry_row record;
  v_inventory numeric := 0;
  v_updated integer := 0;
begin
  for group_row in
    select distinct room_id, type_id, harvest_lot_id
      from public.black_garlic_entries
  loop
    v_inventory := 0;
    for entry_row in
      select *
        from public.black_garlic_entries
       where room_id = group_row.room_id
         and type_id = group_row.type_id
         and harvest_lot_id = group_row.harvest_lot_id
       order by entry_date, recorded_at, id
    loop
      if entry_row.inventory_manual then
        v_inventory := greatest(0, coalesce(entry_row.inventory_qty, 0));
      else
        v_inventory := greatest(0, v_inventory - coalesce(entry_row.out_qty, 0) + coalesce(entry_row.in_qty, 0));
      end if;

      update public.black_garlic_entries
         set inventory_qty = v_inventory
       where id = entry_row.id
         and inventory_qty is distinct from v_inventory;

      if found then
        v_updated := v_updated + 1;
      end if;
    end loop;
  end loop;

  return jsonb_build_object('ok', true, 'updated_rows', v_updated);
end;
$$;

create or replace function public.black_garlic_inventory_audit()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  group_row record;
  entry_row record;
  v_inventory numeric := 0;
  v_mismatch_count integer := 0;
  v_blank_manual_count integer := 0;
begin
  for group_row in
    select distinct room_id, type_id, harvest_lot_id
      from public.black_garlic_entries
  loop
    v_inventory := 0;
    for entry_row in
      select *
        from public.black_garlic_entries
       where room_id = group_row.room_id
         and type_id = group_row.type_id
         and harvest_lot_id = group_row.harvest_lot_id
       order by entry_date, recorded_at, id
    loop
      if entry_row.inventory_manual then
        if entry_row.inventory_qty is null then
          v_blank_manual_count := v_blank_manual_count + 1;
        end if;
        v_inventory := greatest(0, coalesce(entry_row.inventory_qty, 0));
      else
        v_inventory := greatest(0, v_inventory - coalesce(entry_row.out_qty, 0) + coalesce(entry_row.in_qty, 0));
      end if;

      if coalesce(entry_row.inventory_qty, 0) <> v_inventory then
        v_mismatch_count := v_mismatch_count + 1;
      end if;
    end loop;
  end loop;

  return jsonb_build_object(
    'ok', true,
    'mismatch_count', v_mismatch_count,
    'blank_manual_count', v_blank_manual_count
  );
end;
$$;

revoke all on function public.black_garlic_ping() from public, anon, authenticated;
revoke all on function public.black_garlic_recalculate_inventory() from public, anon, authenticated;
revoke all on function public.black_garlic_inventory_audit() from public, anon, authenticated;

grant execute on function public.black_garlic_ping() to anon;
grant execute on function public.black_garlic_recalculate_inventory() to anon;
grant execute on function public.black_garlic_inventory_audit() to anon;
