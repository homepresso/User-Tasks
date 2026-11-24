-- Data table grouping and child records (lib/grid/grouping.ts,
-- lib/services/data-table-grouping.ts).
--
--  * custom_tables.child_relations — the table's child-record relations:
--    [{ id, table_id, lookup_column, label?, roots_only? }] — rows of another
--    table (or this one, for a hierarchy) whose `lookup` column points at a
--    row of this table. A jsonb array on the table row like `columns` and
--    `views`: it travels with the table and RLS is the table's own.
--  * data_table_row_matches(...) — the row filter of the grid / API
--    (equals, contains, gt, is_empty, in…), case-insensitive like the
--    in-memory filter in lib/services/data-tables.ts.
--  * data_table_row_groups(...) — group counts and sums of a table's rows
--    (one or two group columns) over the WHOLE filtered result.
--  * data_table_rows_page(...) — one page of a table's filtered / searched /
--    sorted rows with the exact total (rows of a group, top-level rows of a
--    hierarchy).
--
-- Every function is SECURITY INVOKER: the caller's RLS on custom_table_rows
-- applies exactly as to a plain select (tenant isolation unchanged). anon has
-- no EXECUTE. Additive and idempotent; apply before or after the code (until
-- applied, grouping is computed from the newest 2,000 rows and child
-- relations cannot be saved).

alter table public.custom_tables add column if not exists child_relations jsonb not null default '[]'::jsonb;

comment on column public.custom_tables.child_relations is
  'Child-record relations: [{ id, table_id, lookup_column, label, roots_only }] — rows of table_id whose lookup column points at a row of this table (lib/grid/grouping.ts)';

-- A number from a cell's text, or null when it is not one.
create or replace function public.data_table_numeric(p_value text)
returns numeric
language sql
immutable
set search_path = public, pg_temp
as $$
  select case
    when p_value ~ '^\s*[-+]?(\d+(\.\d*)?|\.\d+)([eE][-+]?\d+)?\s*$' then btrim(p_value)::numeric
    else null
  end
$$;

-- LIKE metacharacters escaped (backslash is the default escape).
create or replace function public.data_table_like_escape(p_value text)
returns text
language sql
immutable
set search_path = public, pg_temp
as $$
  select replace(replace(replace(coalesce(p_value, ''), '\', '\\'), '%', '\%'), '_', '\_')
$$;

-- Whether a row passes every filter: [{ field, operator, value }].
-- Fields: a column key, or id / row_id, created_at, updated_at, created_by.
-- Text comparisons are case-insensitive; `in` (value: an array) is exact.
create or replace function public.data_table_row_matches(
  p_id uuid,
  p_data jsonb,
  p_created_at timestamptz,
  p_updated_at timestamptz,
  p_created_by uuid,
  p_filters jsonb
)
returns boolean
language plpgsql
immutable
set search_path = public, pg_temp
as $$
declare
  f jsonb;
  v_field text;
  v_op text;
  v_raw text;
  v_left text;
  v_right text;
  v_l numeric;
  v_r numeric;
begin
  if p_filters is null or jsonb_typeof(p_filters) <> 'array' then
    return true;
  end if;
  for f in select value from jsonb_array_elements(p_filters) loop
    v_field := f->>'field';
    v_op := f->>'operator';
    if v_field is null or v_field = '' then
      continue;
    end if;
    v_raw := case v_field
      when 'id' then p_id::text
      when 'row_id' then p_id::text
      when '_row_id' then p_id::text
      when 'created_at' then to_jsonb(p_created_at)#>>'{}'
      when '_created_at' then to_jsonb(p_created_at)#>>'{}'
      when 'updated_at' then to_jsonb(p_updated_at)#>>'{}'
      when '_updated_at' then to_jsonb(p_updated_at)#>>'{}'
      when 'created_by' then p_created_by::text
      else p_data->>v_field
    end;
    v_left := lower(coalesce(v_raw, ''));
    v_right := lower(coalesce(f->>'value', ''));
    if v_op = 'equals' then
      if v_left <> v_right then return false; end if;
    elsif v_op = 'not_equals' then
      if v_left = v_right then return false; end if;
    elsif v_op = 'contains' then
      if strpos(v_left, v_right) = 0 then return false; end if;
    elsif v_op = 'starts_with' then
      if left(v_left, length(v_right)) <> v_right then return false; end if;
    elsif v_op = 'ends_with' then
      if length(v_right) > 0 and right(v_left, length(v_right)) <> v_right then return false; end if;
    elsif v_op in ('gt', 'gte', 'lt', 'lte') then
      v_l := public.data_table_numeric(v_raw);
      v_r := public.data_table_numeric(f->>'value');
      if v_l is null or v_r is null then return false; end if;
      if v_op = 'gt' and not v_l > v_r then return false; end if;
      if v_op = 'gte' and not v_l >= v_r then return false; end if;
      if v_op = 'lt' and not v_l < v_r then return false; end if;
      if v_op = 'lte' and not v_l <= v_r then return false; end if;
    elsif v_op = 'is_empty' then
      if btrim(v_left) <> '' then return false; end if;
    elsif v_op = 'not_empty' then
      if btrim(v_left) = '' then return false; end if;
    elsif v_op = 'in' then
      if v_raw is null or jsonb_typeof(f->'value') <> 'array' then return false; end if;
      if not exists (select 1 from jsonb_array_elements_text(f->'value') as e(val) where e.val = v_raw) then return false; end if;
    end if;
  end loop;
  return true;
end
$$;

-- Group counts (and sums of number columns) of a table's rows, by one or two
-- column keys, over every row that passes the search and filters. A blank
-- cell (missing, null or only spaces) is the null group.
create or replace function public.data_table_row_groups(
  p_table_id uuid,
  p_group_by text[],
  p_search text default null,
  p_filters jsonb default '[]'::jsonb,
  p_sum text[] default '{}'::text[],
  p_tenant_id uuid default null,
  p_limit integer default 2000,
  p_root_field text default null,
  p_root_source text default null
)
returns table (g1 text, g2 text, row_count bigint, sums jsonb)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  with link_values as (
    select p.id, p.data->>p_root_source as v
    from public.custom_table_rows p
    where p_root_field is not null
      and p.table_id = p_table_id
      and (p_tenant_id is null or p.tenant_id = p_tenant_id)
  ),
  base as (
    select
      r.data,
      case when btrim(coalesce(r.data->>p_group_by[1], '')) = '' then null else r.data->>p_group_by[1] end as k1,
      case when coalesce(array_length(p_group_by, 1), 0) < 2 or btrim(coalesce(r.data->>p_group_by[2], '')) = '' then null else r.data->>p_group_by[2] end as k2
    from public.custom_table_rows r
    where r.table_id = p_table_id
      and (p_tenant_id is null or r.tenant_id = p_tenant_id)
      and (
        coalesce(btrim(p_search), '') = ''
        or r.id::text ilike '%' || public.data_table_like_escape(btrim(p_search)) || '%'
        or r.data::text ilike '%' || public.data_table_like_escape(btrim(p_search)) || '%'
      )
      and public.data_table_row_matches(r.id, r.data, r.created_at, r.updated_at, r.created_by, p_filters)
      and (
        p_root_field is null
        or btrim(coalesce(r.data->>p_root_field, '')) = ''
        or not exists (select 1 from link_values l where l.v = r.data->>p_root_field and l.id <> r.id)
      )
  ),
  counts as (
    select k1, k2, count(*)::bigint as n from base group by k1, k2
  ),
  totals as (
    select b.k1, b.k2, s.col, sum(public.data_table_numeric(b.data->>s.col)) as total
    from base b
    cross join unnest(coalesce(p_sum, '{}'::text[])) as s(col)
    group by b.k1, b.k2, s.col
  )
  select
    c.k1,
    c.k2,
    c.n,
    coalesce((
      select jsonb_object_agg(t.col, t.total)
      from totals t
      where t.k1 is not distinct from c.k1 and t.k2 is not distinct from c.k2 and t.total is not null
    ), '{}'::jsonb)
  from counts c
  order by c.k1 nulls first, c.k2 nulls first
  limit greatest(1, least(coalesce(p_limit, 2000), 5000))
$$;

-- p_root_field / p_root_source (a same-table hierarchy listing its top level):
-- only rows whose p_root_field cell is blank or names no OTHER row of the
-- table (by its p_root_source cell) — a row whose parent is missing, or that
-- is its own parent, still shows at the top.

-- One page of a table's rows that pass the search and filters, sorted by a
-- system field (_updated_at, _created_at, _row_id) or a column key (numbers
-- numerically, then text), each row as jsonb with the exact `_total`.
create or replace function public.data_table_rows_page(
  p_table_id uuid,
  p_search text default null,
  p_filters jsonb default '[]'::jsonb,
  p_sort text default '_updated_at',
  p_dir text default 'desc',
  p_limit integer default 100,
  p_offset integer default 0,
  p_tenant_id uuid default null,
  p_root_field text default null,
  p_root_source text default null
)
returns setof jsonb
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  with link_values as (
    select p.id, p.data->>p_root_source as v
    from public.custom_table_rows p
    where p_root_field is not null
      and p.table_id = p_table_id
      and (p_tenant_id is null or p.tenant_id = p_tenant_id)
  ),
  filtered as (
    select r.*
    from public.custom_table_rows r
    where r.table_id = p_table_id
      and (p_tenant_id is null or r.tenant_id = p_tenant_id)
      and (
        coalesce(btrim(p_search), '') = ''
        or r.id::text ilike '%' || public.data_table_like_escape(btrim(p_search)) || '%'
        or r.data::text ilike '%' || public.data_table_like_escape(btrim(p_search)) || '%'
      )
      and public.data_table_row_matches(r.id, r.data, r.created_at, r.updated_at, r.created_by, p_filters)
      and (
        p_root_field is null
        or btrim(coalesce(r.data->>p_root_field, '')) = ''
        or not exists (select 1 from link_values l where l.v = r.data->>p_root_field and l.id <> r.id)
      )
  ),
  counted as (
    select f.*, count(*) over () as total_count from filtered f
  )
  select to_jsonb(c) - 'total_count' || jsonb_build_object('_total', c.total_count)
  from counted c
  order by
    case when p_dir = 'asc' then case coalesce(p_sort, '_updated_at') when '_created_at' then c.created_at when '_updated_at' then c.updated_at end end asc nulls last,
    case when p_dir <> 'asc' then case coalesce(p_sort, '_updated_at') when '_created_at' then c.created_at when '_updated_at' then c.updated_at end end desc nulls last,
    case when p_dir = 'asc' and p_sort not in ('_created_at', '_updated_at', '_row_id') then public.data_table_numeric(c.data->>p_sort) end asc nulls last,
    case when p_dir <> 'asc' and p_sort not in ('_created_at', '_updated_at', '_row_id') then public.data_table_numeric(c.data->>p_sort) end desc nulls last,
    case when p_dir = 'asc' then case when p_sort = '_row_id' then c.id::text when p_sort in ('_created_at', '_updated_at') then null else lower(c.data->>p_sort) end end asc nulls last,
    case when p_dir <> 'asc' then case when p_sort = '_row_id' then c.id::text when p_sort in ('_created_at', '_updated_at') then null else lower(c.data->>p_sort) end end desc nulls last,
    c.updated_at desc nulls last,
    c.id
  limit greatest(1, least(coalesce(p_limit, 100), 500))
  offset greatest(0, coalesce(p_offset, 0))
$$;

revoke all on function public.data_table_numeric(text) from public;
revoke all on function public.data_table_like_escape(text) from public;
revoke all on function public.data_table_row_matches(uuid, jsonb, timestamptz, timestamptz, uuid, jsonb) from public;
revoke all on function public.data_table_row_groups(uuid, text[], text, jsonb, text[], uuid, integer, text, text) from public;
revoke all on function public.data_table_rows_page(uuid, text, jsonb, text, text, integer, integer, uuid, text, text) from public;

grant execute on function public.data_table_numeric(text) to authenticated, service_role;
grant execute on function public.data_table_like_escape(text) to authenticated, service_role;
grant execute on function public.data_table_row_matches(uuid, jsonb, timestamptz, timestamptz, uuid, jsonb) to authenticated, service_role;
grant execute on function public.data_table_row_groups(uuid, text[], text, jsonb, text[], uuid, integer, text, text) to authenticated, service_role;
grant execute on function public.data_table_rows_page(uuid, text, jsonb, text, text, integer, integer, uuid, text, text) to authenticated, service_role;

-- Supabase's default privileges grant EXECUTE on new functions to anon too.
revoke execute on function public.data_table_row_groups(uuid, text[], text, jsonb, text[], uuid, integer, text, text) from anon;
revoke execute on function public.data_table_rows_page(uuid, text, jsonb, text, text, integer, integer, uuid, text, text) from anon;
revoke execute on function public.data_table_row_matches(uuid, jsonb, timestamptz, timestamptz, uuid, jsonb) from anon;
revoke execute on function public.data_table_numeric(text) from anon;
revoke execute on function public.data_table_like_escape(text) from anon;

notify pgrst, 'reload schema';
