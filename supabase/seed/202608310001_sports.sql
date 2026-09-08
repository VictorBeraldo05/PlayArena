insert into public.sports (name, slug)
values
  ('Society', 'society'),
  ('Futevolei', 'futevolei'),
  ('Beach Tennis', 'beach-tennis'),
  ('Tenis', 'tenis'),
  ('Padel', 'padel'),
  ('Volei', 'volei')
on conflict (slug) do update
set name = excluded.name;
