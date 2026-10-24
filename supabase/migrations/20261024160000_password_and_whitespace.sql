-- Second round of hardening, from the adversarial review.

-- ---------------------------------------------------------------------------
-- 1. A legacy password hash dies with the password it stood in for
-- ---------------------------------------------------------------------------
-- legacy_password_hashes holds the old scrypt hash of an account whose password has not
-- been migrated yet. The plan: at first sign-in Flask checks the typed password against
-- it, and on a match sets that password in Supabase Auth and deletes the row.
--
-- The gap: any OTHER way the password changes (a recovery email, a reset the user asked
-- for because the old password leaked) left the row behind, and the fallback would then
-- accept the OLD password again and put it back. Here the row is removed whenever the
-- password hash in auth.users changes, by anything. Deleting it from Flask as well is
-- harmless; this is the net underneath.
create function public.drop_legacy_password_hash()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
    delete from public.legacy_password_hashes where user_id = new.id;
    return new;
end $$;
revoke execute on function public.drop_legacy_password_hash() from public, anon, authenticated;

create trigger drop_legacy_hash_on_password_change
    after update of encrypted_password on auth.users
    for each row
    when (old.encrypted_password is distinct from new.encrypted_password)
    execute function public.drop_legacy_password_hash();

-- ---------------------------------------------------------------------------
-- 2. "Blank" means blank, including whitespace
-- ---------------------------------------------------------------------------
-- keep_required_coaching_fields() treated '' as blank but not '   ', so a client could still
-- wipe a stored required field with whitespace.
create or replace function public.keep_required_coaching_fields()
returns trigger language plpgsql as $$
begin
    if nullif(btrim(new.aspiration), '')         is null then new.aspiration         := coalesce(nullif(btrim(old.aspiration), ''), new.aspiration); end if;
    if nullif(btrim(new.gender), '')             is null then new.gender             := coalesce(nullif(btrim(old.gender), ''), new.gender); end if;
    if new.weight_kg                             is null then new.weight_kg          := old.weight_kg; end if;
    if nullif(btrim(new.body_fat_range_id), '')  is null then new.body_fat_range_id  := coalesce(nullif(btrim(old.body_fat_range_id), ''), new.body_fat_range_id); end if;
    if nullif(btrim(new.activity_level), '')     is null then new.activity_level     := coalesce(nullif(btrim(old.activity_level), ''), new.activity_level); end if;
    if nullif(btrim(new.protein_preference), '') is null then new.protein_preference := coalesce(nullif(btrim(old.protein_preference), ''), new.protein_preference); end if;
    return new;
end $$;
