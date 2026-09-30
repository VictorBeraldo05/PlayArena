alter table public.arenas
  add constraint arenas_latitude_range check (latitude is null or latitude between -90 and 90),
  add constraint arenas_longitude_range check (longitude is null or longitude between -180 and 180),
  add constraint arenas_coordinates_pair check ((latitude is null) = (longitude is null));
