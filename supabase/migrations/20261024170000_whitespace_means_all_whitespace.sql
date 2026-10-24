-- The previous migration made keep_required_coaching_fields() treat whitespace as blank, but
-- btrim(x) with no second argument strips only the space character, so a tab, a newline or a
-- non-breaking space still counted as a value and could wipe a stored required field. Caught by
-- the isolation suite (a gender of E'\t'). Trim every kind of whitespace.
create or replace function public.keep_required_coaching_fields()
returns trigger language plpgsql as $$
declare
    ws constant text := E' \t\r\n\f\v ';
begin
    if nullif(btrim(new.aspiration, ws), '')         is null then new.aspiration         := coalesce(nullif(btrim(old.aspiration, ws), ''), new.aspiration); end if;
    if nullif(btrim(new.gender, ws), '')             is null then new.gender             := coalesce(nullif(btrim(old.gender, ws), ''), new.gender); end if;
    if new.weight_kg                                 is null then new.weight_kg          := old.weight_kg; end if;
    if nullif(btrim(new.body_fat_range_id, ws), '')  is null then new.body_fat_range_id  := coalesce(nullif(btrim(old.body_fat_range_id, ws), ''), new.body_fat_range_id); end if;
    if nullif(btrim(new.activity_level, ws), '')     is null then new.activity_level     := coalesce(nullif(btrim(old.activity_level, ws), ''), new.activity_level); end if;
    if nullif(btrim(new.protein_preference, ws), '') is null then new.protein_preference := coalesce(nullif(btrim(old.protein_preference, ws), ''), new.protein_preference); end if;
    return new;
end $$;
