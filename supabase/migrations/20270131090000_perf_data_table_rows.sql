-- Data table grid performance at enterprise scale (QA perf pass 2026-11-24).
--
-- Measured on a 200,000-row table (laptop, local Supabase):
--  * the plain grid page (`order by updated_at desc limit 100` on one table)
--    scanned and sorted every row of the tenant: ~380–560 ms per page, plus
--    ~470 ms for the exact count. Composite (table_id, updated_at / created_at)
--    indexes make both a short index walk.
--  * data_table_rows_page built to_jsonb() of EVERY filtered row and kept
--    whole rows in a count(*) over () window (spilling to temp) before the
--    top-N sort, and called the plpgsql filter per row even with no filters:
--    15–45 s per page. It now sorts lean keys, counts separately and builds
--    jsonb only for the page's rows.
--  * data_table_numeric / data_table_like_escape carry `set search_path`,
--    so they are never inlined: ~9 µs per row. The sort key's number parse
--    is inlined (same regex) and the search pattern is built once.
--  * the plpgsql filter ran per row (~14 µs) even with no filters: every
--    operator is now evaluated inline in SQL with the same semantics
--    (data_table_row_matches stays for other callers).
--  * data_table_row_groups materialised whole rows (data included) twice:
--    ~9 s. The base now carries only the group keys and the summed numbers.
--
--  * data_table_numeric accepted any exponent, so a text cell such as an
--    md5 '0e4620974…' raised "value overflows numeric format" and broke the
--    whole grouped / sorted grid of that table. Exponents are capped at 3
--    digits (larger ones are not a number, like any other text).
--
-- Semantics are otherwise unchanged: same filter function, same sort keys and order
-- (including tie-breakers), same totals. Every function stays SECURITY
-- INVOKER (RLS of the caller applies), anon still has no EXECUTE.
-- Additive and idempotent.

create index if not exists idx_custom_rows_table_updated
  on public.custom_table_rows (table_id, updated_at desc nulls last, id) include (tenant_id);
create index if not exists idx_custom_rows_table_created
  on public.custom_table_rows (table_id, created_at desc, id) include (tenant_id);

create or replace function public.data_table_numeric(p_value text)
returns numeric
language sql
immutable
set search_path = public, pg_temp
as $$
  select case
    when p_value ~ '^\s*[-+]?(\d+(\.\d*)?|\.\d+)([eE][-+]?\d{1,3})?\s*$' then btrim(p_value)::numeric
    else null
  end
$$;

-- The grid page, cheap path first: keys only, jsonb for the page.
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
  params as (
    select
      case when coalesce(btrim(p_search), '') = '' then null
        else '%' || public.data_table_like_escape(btrim(p_search)) || '%' end as pat,
      case when jsonb_typeof(p_filters) = 'array' then p_filters else '[]'::jsonb end as filters
  ),
  filtered as materialized (
    select
      r.id,
      r.updated_at,
      case coalesce(p_sort, '_updated_at') when '_created_at' then r.created_at when '_updated_at' then r.updated_at end as k_ts,
      case when p_sort not in ('_created_at', '_updated_at', '_row_id') then case when (r.data->>p_sort) ~ '^\s*[-+]?(\d+(\.\d*)?|\.\d+)([eE][-+]?\d{1,3})?\s*$' then btrim((r.data->>p_sort))::numeric end end as k_num,
      case when p_sort = '_row_id' then r.id::text when p_sort in ('_created_at', '_updated_at') then null else lower(r.data->>p_sort) end as k_txt
    from public.custom_table_rows r
    cross join params prm
    where r.table_id = p_table_id
      and (p_tenant_id is null or r.tenant_id = p_tenant_id)
      and (
        prm.pat is null
        or r.id::text ilike prm.pat
        or r.data::text ilike prm.pat
      )
      -- Every filter, exactly as data_table_row_matches compares it, in plain
      -- SQL (no plpgsql call per row): a row passes when no filter rejects it.
      and not exists (
        select 1
        from jsonb_array_elements(prm.filters) e
        cross join lateral (
          select case e.value->>'field'
            when 'id' then r.id::text when 'row_id' then r.id::text when '_row_id' then r.id::text
            when 'created_at' then to_jsonb(r.created_at)#>>'{}' when '_created_at' then to_jsonb(r.created_at)#>>'{}'
            when 'updated_at' then to_jsonb(r.updated_at)#>>'{}' when '_updated_at' then to_jsonb(r.updated_at)#>>'{}'
            when 'created_by' then r.created_by::text
            else r.data->>(e.value->>'field')
          end as raw
        ) x
        cross join lateral (
          select lower(coalesce(x.raw, '')) as l, lower(coalesce(e.value->>'value', '')) as rt
        ) y
        where coalesce(e.value->>'field', '') <> ''
          and not (case e.value->>'operator'
            when 'equals' then y.l = y.rt
            when 'not_equals' then y.l <> y.rt
            when 'contains' then strpos(y.l, y.rt) > 0
            when 'starts_with' then left(y.l, length(y.rt)) = y.rt
            when 'ends_with' then length(y.rt) = 0 or right(y.l, length(y.rt)) = y.rt
            when 'gt' then coalesce((case when x.raw ~ '^\s*[-+]?(\d+(\.\d*)?|\.\d+)([eE][-+]?\d{1,3})?\s*$' then btrim(x.raw)::numeric end) > (case when (e.value->>'value') ~ '^\s*[-+]?(\d+(\.\d*)?|\.\d+)([eE][-+]?\d{1,3})?\s*$' then btrim((e.value->>'value'))::numeric end), false)
            when 'gte' then coalesce((case when x.raw ~ '^\s*[-+]?(\d+(\.\d*)?|\.\d+)([eE][-+]?\d{1,3})?\s*$' then btrim(x.raw)::numeric end) >= (case when (e.value->>'value') ~ '^\s*[-+]?(\d+(\.\d*)?|\.\d+)([eE][-+]?\d{1,3})?\s*$' then btrim((e.value->>'value'))::numeric end), false)
            when 'lt' then coalesce((case when x.raw ~ '^\s*[-+]?(\d+(\.\d*)?|\.\d+)([eE][-+]?\d{1,3})?\s*$' then btrim(x.raw)::numeric end) < (case when (e.value->>'value') ~ '^\s*[-+]?(\d+(\.\d*)?|\.\d+)([eE][-+]?\d{1,3})?\s*$' then btrim((e.value->>'value'))::numeric end), false)
            when 'lte' then coalesce((case when x.raw ~ '^\s*[-+]?(\d+(\.\d*)?|\.\d+)([eE][-+]?\d{1,3})?\s*$' then btrim(x.raw)::numeric end) <= (case when (e.value->>'value') ~ '^\s*[-+]?(\d+(\.\d*)?|\.\d+)([eE][-+]?\d{1,3})?\s*$' then btrim((e.value->>'value'))::numeric end), false)
            when 'is_empty' then btrim(y.l) = ''
            when 'not_empty' then btrim(y.l) <> ''
            when 'in' then x.raw is not null and jsonb_typeof(e.value->'value') = 'array'
              and exists (select 1 from jsonb_array_elements_text(e.value->'value') as v(val) where v.val = x.raw)
            else true
          end)
      )
      and (
        p_root_field is null
        or btrim(coalesce(r.data->>p_root_field, '')) = ''
        or not exists (select 1 from link_values l where l.v = r.data->>p_root_field and l.id <> r.id)
      )
  ),
  total as (
    select count(*) as n from filtered
  ),
  page as (
    select f.*
    from filtered f
    order by
      case when p_dir = 'asc' then f.k_ts end asc nulls last,
      case when p_dir <> 'asc' then f.k_ts end desc nulls last,
      case when p_dir = 'asc' then f.k_num end asc nulls last,
      case when p_dir <> 'asc' then f.k_num end desc nulls last,
      case when p_dir = 'asc' then f.k_txt end asc nulls last,
      case when p_dir <> 'asc' then f.k_txt end desc nulls last,
      f.updated_at desc nulls last,
      f.id
    limit greatest(1, least(coalesce(p_limit, 100), 500))
    offset greatest(0, coalesce(p_offset, 0))
  )
  select to_jsonb(r) || jsonb_build_object('_total', (select n from total))
  from page pg
  join public.custom_table_rows r on r.id = pg.id
  order by
    case when p_dir = 'asc' then pg.k_ts end asc nulls last,
    case when p_dir <> 'asc' then pg.k_ts end desc nulls last,
    case when p_dir = 'asc' then pg.k_num end asc nulls last,
    case when p_dir <> 'asc' then pg.k_num end desc nulls last,
    case when p_dir = 'asc' then pg.k_txt end asc nulls last,
    case when p_dir <> 'asc' then pg.k_txt end desc nulls last,
    pg.updated_at desc nulls last,
    pg.id
$$;

-- Group counts and sums: the base keeps the two keys and the summed numbers only.
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
  params as (
    select
      case when coalesce(btrim(p_search), '') = '' then null
        else '%' || public.data_table_like_escape(btrim(p_search)) || '%' end as pat,
      case when jsonb_typeof(p_filters) = 'array' then p_filters else '[]'::jsonb end as filters
  ),
  base as materialized (
    select
      case when btrim(coalesce(r.data->>p_group_by[1], '')) = '' then null else r.data->>p_group_by[1] end as k1,
      case when coalesce(array_length(p_group_by, 1), 0) < 2 or btrim(coalesce(r.data->>p_group_by[2], '')) = '' then null else r.data->>p_group_by[2] end as k2,
      case when coalesce(array_length(p_sum, 1), 0) = 0 then null
        else array(select case when (r.data->>s.col) ~ '^\s*[-+]?(\d+(\.\d*)?|\.\d+)([eE][-+]?\d{1,3})?\s*$' then btrim((r.data->>s.col))::numeric end from unnest(p_sum) with ordinality as s(col, i) order by s.i) end as vals
    from public.custom_table_rows r
    cross join params prm
    where r.table_id = p_table_id
      and (p_tenant_id is null or r.tenant_id = p_tenant_id)
      and (
        prm.pat is null
        or r.id::text ilike prm.pat
        or r.data::text ilike prm.pat
      )
      -- Every filter, exactly as data_table_row_matches compares it, in plain
      -- SQL (no plpgsql call per row): a row passes when no filter rejects it.
      and not exists (
        select 1
        from jsonb_array_elements(prm.filters) e
        cross join lateral (
          select case e.value->>'field'
            when 'id' then r.id::text when 'row_id' then r.id::text when '_row_id' then r.id::text
            when 'created_at' then to_jsonb(r.created_at)#>>'{}' when '_created_at' then to_jsonb(r.created_at)#>>'{}'
            when 'updated_at' then to_jsonb(r.updated_at)#>>'{}' when '_updated_at' then to_jsonb(r.updated_at)#>>'{}'
            when 'created_by' then r.created_by::text
            else r.data->>(e.value->>'field')
          end as raw
        ) x
        cross join lateral (
          select lower(coalesce(x.raw, '')) as l, lower(coalesce(e.value->>'value', '')) as rt
        ) y
        where coalesce(e.value->>'field', '') <> ''
          and not (case e.value->>'operator'
            when 'equals' then y.l = y.rt
            when 'not_equals' then y.l <> y.rt
            when 'contains' then strpos(y.l, y.rt) > 0
            when 'starts_with' then left(y.l, length(y.rt)) = y.rt
            when 'ends_with' then length(y.rt) = 0 or right(y.l, length(y.rt)) = y.rt
            when 'gt' then coalesce((case when x.raw ~ '^\s*[-+]?(\d+(\.\d*)?|\.\d+)([eE][-+]?\d{1,3})?\s*$' then btrim(x.raw)::numeric end) > (case when (e.value->>'value') ~ '^\s*[-+]?(\d+(\.\d*)?|\.\d+)([eE][-+]?\d{1,3})?\s*$' then btrim((e.value->>'value'))::numeric end), false)
            when 'gte' then coalesce((case when x.raw ~ '^\s*[-+]?(\d+(\.\d*)?|\.\d+)([eE][-+]?\d{1,3})?\s*$' then btrim(x.raw)::numeric end) >= (case when (e.value->>'value') ~ '^\s*[-+]?(\d+(\.\d*)?|\.\d+)([eE][-+]?\d{1,3})?\s*$' then btrim((e.value->>'value'))::numeric end), false)
            when 'lt' then coalesce((case when x.raw ~ '^\s*[-+]?(\d+(\.\d*)?|\.\d+)([eE][-+]?\d{1,3})?\s*$' then btrim(x.raw)::numeric end) < (case when (e.value->>'value') ~ '^\s*[-+]?(\d+(\.\d*)?|\.\d+)([eE][-+]?\d{1,3})?\s*$' then btrim((e.value->>'value'))::numeric end), false)
            when 'lte' then coalesce((case when x.raw ~ '^\s*[-+]?(\d+(\.\d*)?|\.\d+)([eE][-+]?\d{1,3})?\s*$' then btrim(x.raw)::numeric end) <= (case when (e.value->>'value') ~ '^\s*[-+]?(\d+(\.\d*)?|\.\d+)([eE][-+]?\d{1,3})?\s*$' then btrim((e.value->>'value'))::numeric end), false)
            when 'is_empty' then btrim(y.l) = ''
            when 'not_empty' then btrim(y.l) <> ''
            when 'in' then x.raw is not null and jsonb_typeof(e.value->'value') = 'array'
              and exists (select 1 from jsonb_array_elements_text(e.value->'value') as v(val) where v.val = x.raw)
            else true
          end)
      )
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
    select b.k1, b.k2, s.col, sum(b.vals[s.i]) as total
    from base b
    cross join unnest(coalesce(p_sum, '{}'::text[])) with ordinality as s(col, i)
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

-- create or replace keeps grants; restate them so a fresh apply matches 20270119090000.
revoke all on function public.data_table_numeric(text) from public;
grant execute on function public.data_table_numeric(text) to authenticated, service_role;
revoke execute on function public.data_table_numeric(text) from anon;
revoke all on function public.data_table_row_groups(uuid, text[], text, jsonb, text[], uuid, integer, text, text) from public;
revoke all on function public.data_table_rows_page(uuid, text, jsonb, text, text, integer, integer, uuid, text, text) from public;
grant execute on function public.data_table_row_groups(uuid, text[], text, jsonb, text[], uuid, integer, text, text) to authenticated, service_role;
grant execute on function public.data_table_rows_page(uuid, text, jsonb, text, text, integer, integer, uuid, text, text) to authenticated, service_role;
revoke execute on function public.data_table_row_groups(uuid, text[], text, jsonb, text[], uuid, integer, text, text) from anon;
revoke execute on function public.data_table_rows_page(uuid, text, jsonb, text, text, integer, integer, uuid, text, text) from anon;

notify pgrst, 'reload schema';
