-- Expands the follow/self calendar-color palette (CalendarSidebar's
-- ColorMenu, Account's CalendarColorPicker) from 6 to 13 built-in swatches,
-- and lets a viewer's follow-color additionally be a fully custom hex code
-- (the "+" swatch in ColorMenu) — self color stays swatch-only by design,
-- following Google Calendar's own asymmetry (you can fully customize how
-- *you* see someone else's calendar, but your own calendar's base color is
-- still picked from a fixed set).
alter table public.profiles drop constraint if exists profiles_color_valid;
alter table public.profiles add constraint profiles_color_valid
  check (
    color is null or color in (
      '--chart-1', '--chart-3', '--chart-4', '--chart-5', '--chart-6',
      '--gold', '--success',
      '--palette-rose', '--palette-violet', '--palette-basil',
      '--palette-indigo', '--palette-flamingo', '--palette-graphite'
    )
  );

alter table public.calendar_follows drop constraint if exists calendar_follows_color_valid;
alter table public.calendar_follows add constraint calendar_follows_color_valid
  check (
    color is null
    or color in (
      '--chart-1', '--chart-3', '--chart-4', '--chart-5', '--chart-6',
      '--gold', '--success',
      '--palette-rose', '--palette-violet', '--palette-basil',
      '--palette-indigo', '--palette-flamingo', '--palette-graphite'
    )
    or color ~ '^#[0-9a-fA-F]{6}$'
  );
