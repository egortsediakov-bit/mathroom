-- Shared task bank filter options, scoped by existing RLS.
-- Execute once in Supabase SQL Editor for an existing installation.
create or replace function public.mathroom_shared_bank_facets()
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select jsonb_build_object(
    'categories', coalesce((
      select jsonb_agg(category order by category)
      from (
        select distinct category
        from public.shared_materials
        where nullif(btrim(category), '') is not null
      ) categories
    ), '[]'::jsonb),
    'tags', coalesce((
      select jsonb_agg(tag order by tag)
      from (
        select distinct btrim(item.tag) as tag
        from public.shared_materials s
        cross join lateral unnest(s.tags) as item(tag)
        where nullif(btrim(item.tag), '') is not null
          and item.tag not like 'mathroom-core-bank-v%'
          and item.tag not like 'mrseed:%'
          and item.tag not like 'класс-%'
          and item.tag not like 'тема:%'
      ) tags
    ), '[]'::jsonb),
    'grades', coalesce((
      select jsonb_agg(grade order by grade)
      from (
        select distinct grade
        from public.shared_materials
        where grade is not null
      ) grades
    ), '[]'::jsonb)
  );
$$;
revoke all on function public.mathroom_shared_bank_facets() from public;
grant execute on function public.mathroom_shared_bank_facets() to authenticated;
