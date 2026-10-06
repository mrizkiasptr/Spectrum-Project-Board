-- State store for the SPEctrum Sprint Board prototype (spectrum-sprint.html + supabase-sync.js).
-- One row per in-app data store (tasks, BACKLOG, SPR, ...). Kept separate from the
-- projects/sprints/work_items schema in this database, which belongs to another app.
-- Already applied to project uomajehbtzzaxkygecam.
create table public.spectrum_board_state (
  key        text primary key check (key ~ '^[A-Za-z_][A-Za-z0-9_]{0,63}$'),
  -- The store serialized as JSON text, held as a jsonb string: jsonb would re-sort object keys,
  -- and the board relies on key order (team, divisions, columns...) for display order.
  data       jsonb not null constraint spectrum_board_state_data_is_text check (jsonb_typeof(data) = 'string'),
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid()
);
comment on column public.spectrum_board_state.data is 'The store serialized as JSON text, held as a jsonb string so object key order (display order) survives. Sets/Dates are tagged as {"$set":[...]} / {"$date":"..."}.';

create or replace function public.spectrum_board_state_touch()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end $$;

create trigger spectrum_board_state_touch
before insert or update on public.spectrum_board_state
for each row execute function public.spectrum_board_state_touch();

alter table public.spectrum_board_state enable row level security;

revoke all on public.spectrum_board_state from anon;
grant select, insert, update on public.spectrum_board_state to authenticated;

create policy "signed-in users read board state" on public.spectrum_board_state
  for select to authenticated using (true);
create policy "signed-in users add board state" on public.spectrum_board_state
  for insert to authenticated with check ((select auth.uid()) is not null);
create policy "signed-in users update board state" on public.spectrum_board_state
  for update to authenticated using (true) with check ((select auth.uid()) is not null);

alter publication supabase_realtime add table public.spectrum_board_state;
