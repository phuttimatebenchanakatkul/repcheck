-- Two child tables that the first cut left without the `extra jsonb` escape
-- hatch every other imported table has. Without it, one unexpected key on a race
-- split or an analyze-log entry would force the whole parent row into
-- import_quarantine; with it the key is kept next to the row it belongs to.

alter table public.hyrox_race_splits  add column extra jsonb not null default '{}';
alter table public.analyze_log_entries add column extra jsonb not null default '{}';

-- Coach turns written by older builds carry no `date` at all (the coach chat is a
-- single-day thread with no turn ids), so there is nothing true to put here.
-- Dropping the NOT NULL keeps those turns instead of discarding a user's chat.
alter table public.coach_messages alter column msg_date drop not null;
