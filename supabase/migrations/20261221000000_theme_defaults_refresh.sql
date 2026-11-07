-- UI foundations: refresh stored workspace themes that still hold the old
-- platform defaults (docs/design/ui-polish-spec.md §9).
--
-- Only `workspace_themes` rows holding a full theme are touched (rows with the
-- `{"base_preset": …}` stub expand from the code and pick up the new presets
-- by themselves). Form themes (forms.theme / form_versions.theme) are not
-- touched. Each change applies only to values nobody customised:
--
--   1. Fonts: typography.sans = Google "DM Sans" AND typography.mono = Google
--      "Space Mono" (the untouched old defaults) → Inter / JetBrains Mono.
--      A theme that picked any other font keeps it.
--   2. Headings: basePreset ∈ (basecamp, trailside, night-drive) with the
--      Fraunces display family and display headings → sans headings
--      (letter spacing `normal`). A different display font is kept.
--   3. Dark palette: basePreset ∈ (basecamp = Gallery, trailside = Atelier)
--      whose dark palette still equals its light one (never customised) →
--      the new Noir-derived dark palette, so "Follow device" goes dark.
--
-- Rollback data: the full previous theme of every changed row is kept in
-- workspace_theme_refresh_backup (the stored theme's `meta` object is strict,
-- so it can't carry the old values itself). To roll back:
--
--   update public.workspace_themes w
--      set theme = b.theme, version = w.version + 1, updated_at = now()
--     from public.workspace_theme_refresh_backup b
--    where b.tenant_id = w.tenant_id and b.migration = '20261221000000';
--
-- Additive and idempotent: a second run matches no rows (every condition is
-- false once applied) and the backup keeps the first original.

create table if not exists public.workspace_theme_refresh_backup (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  migration text not null,
  theme jsonb not null,
  version integer not null,
  backed_up_at timestamptz not null default now(),
  primary key (tenant_id, migration)
);

comment on table public.workspace_theme_refresh_backup is
  'Previous workspace_themes.theme of rows rewritten by a theme-defaults refresh migration (rollback data). Service role only.';

alter table public.workspace_theme_refresh_backup enable row level security;
revoke all on public.workspace_theme_refresh_backup from anon, authenticated;

do $migration$
declare
  gallery_dark constant jsonb := $json${"primary":"#EDE8DD","primaryHover":"#D9D2C2","primaryLight":"rgba(237,232,221,0.10)","onPrimary":"#17150F","accent":"#C7A575","accentLight":"#352919","sidebar":"#121110","sidebarText":"#D9D2C2","sidebarActive":"rgba(199,165,117,0.20)","sidebarBorder":"rgba(243,239,231,0.08)","topbar":"#121110","topbarText":"#F2EFE7","surface":"#171512","surfaceBorder":"rgba(243,239,231,0.10)","cardBg":"#1F1C18","cardText":"#F2EFE7","mutedText":"#A29A89","success":"#7FA98A","warning":"#D9A441","danger":"#D38374","info":"#C7A575","status":{"todo":"#A29A89","todoBg":"rgba(162,154,137,0.16)","progress":"#D9A441","progressBg":"rgba(217,164,65,0.16)","blocked":"#D38374","blockedBg":"rgba(208,122,106,0.16)","done":"#7FA98A","doneBg":"rgba(127,169,138,0.18)","info":"#C7A575","infoBg":"rgba(199,165,117,0.16)","warningBg":"rgba(217,164,65,0.16)","dangerBg":"rgba(208,122,106,0.16)","successBg":"rgba(127,169,138,0.18)"},"rowHighlight":"rgba(176,138,84,0.10)","rowHighlightStrong":"rgba(176,138,84,0.18)","overlay":"rgba(0,0,0,0.5)","chart":["#B08A54","#4F7A5B","#5B7285","#C25E4C","#A6721C","#835F80","#8A9B6E","#9B6B4F","#6E8CA0","#8C857A"]}$json$::jsonb;
  atelier_dark constant jsonb := $json${"primary":"#C7A575","primaryHover":"#D4B68A","primaryLight":"rgba(199,165,117,0.16)","onPrimary":"#17150F","accent":"#E9E0CE","accentLight":"#070605","sidebar":"#1A1714","sidebarText":"#E0D7C4","sidebarActive":"rgba(199,165,117,0.22)","sidebarBorder":"rgba(233,224,206,0.10)","topbar":"#1A1714","topbarText":"#F2EFE7","surface":"#1C1915","surfaceBorder":"rgba(233,224,206,0.12)","cardBg":"#24201B","cardText":"#F2EFE7","mutedText":"#A89F8C","success":"#82AB8D","warning":"#D9A441","danger":"#D5887A","info":"#C7A575","status":{"todo":"#A59E8D","todoBg":"rgba(162,154,137,0.16)","progress":"#D9A441","progressBg":"rgba(217,164,65,0.16)","blocked":"#D5887A","blockedBg":"rgba(208,122,106,0.16)","done":"#82AB8D","doneBg":"rgba(127,169,138,0.18)","info":"#C7A575","infoBg":"rgba(199,165,117,0.16)","warningBg":"rgba(217,164,65,0.16)","dangerBg":"rgba(208,122,106,0.16)","successBg":"rgba(127,169,138,0.18)"},"rowHighlight":"rgba(176,138,84,0.10)","rowHighlightStrong":"rgba(176,138,84,0.18)","overlay":"rgba(0,0,0,0.5)","chart":["#B08A54","#4F7A5B","#5B7285","#C25E4C","#A6721C","#866183","#8A9B6E","#9B6B4F","#6E8CA0","#8C857A"]}$json$::jsonb;
begin
  drop table if exists pg_temp._theme_refresh;
  create temporary table _theme_refresh on commit drop as
  with full_themes as (
    select tenant_id, version, theme as old_theme, theme
      from public.workspace_themes
     where jsonb_typeof(theme -> 'meta') = 'object'
       and jsonb_typeof(theme -> 'typography') = 'object'
       and jsonb_typeof(theme -> 'colors') = 'object'
  ),
  fonts as (
    select tenant_id, version, old_theme,
      case
        when theme #> '{typography,sans}' = '{"source":"google","family":"DM Sans"}'::jsonb
         and theme #>> '{typography,mono,source}' = 'google'
         and theme #>> '{typography,mono,family}' = 'Space Mono'
        then jsonb_set(jsonb_set(theme,
               '{typography,sans}', '{"source":"google","family":"Inter"}'::jsonb),
               '{typography,mono}', '{"source":"google","family":"JetBrains Mono"}'::jsonb)
        else theme
      end as theme
    from full_themes
  ),
  headings as (
    select tenant_id, version, old_theme,
      case
        when theme #>> '{meta,basePreset}' in ('basecamp', 'trailside', 'night-drive')
         and theme #>> '{typography,display,family}' = 'Fraunces'
         and theme #>> '{typography,headingFont}' = 'display'
        then jsonb_set(jsonb_set(theme,
               '{typography,headingFont}', '"sans"'::jsonb),
               '{typography,headingLetterSpacing}', '"normal"'::jsonb)
        else theme
      end as theme
    from fonts
  ),
  dark as (
    select tenant_id, version, old_theme,
      case
        when theme #>> '{meta,basePreset}' = 'basecamp'
         and theme #> '{colors,dark}' = theme #> '{colors,light}'
        then jsonb_set(theme, '{colors,dark}', gallery_dark)
        when theme #>> '{meta,basePreset}' = 'trailside'
         and theme #> '{colors,dark}' = theme #> '{colors,light}'
        then jsonb_set(theme, '{colors,dark}', atelier_dark)
        else theme
      end as theme
    from headings
  )
  select tenant_id, version, old_theme, theme as new_theme
    from dark
   where theme is distinct from old_theme;

  insert into public.workspace_theme_refresh_backup (tenant_id, migration, theme, version)
  select tenant_id, '20261221000000', old_theme, version from _theme_refresh
  on conflict (tenant_id, migration) do nothing;

  update public.workspace_themes w
     set theme = r.new_theme,
         version = w.version + 1,
         updated_at = now()
    from _theme_refresh r
   where r.tenant_id = w.tenant_id;
end
$migration$;
