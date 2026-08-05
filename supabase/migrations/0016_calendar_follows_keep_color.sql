-- Unfollowing someone used to hard-delete their calendar_follows row,
-- which threw away the color the viewer had picked for them along with
-- the follow itself — re-following (or picking a color again) then fell
-- back to the auto hash color instead of remembering the old pick.
-- Decoupling "followed" (visibility) from row existence (color memory)
-- fixes that: unfollow now just flips this flag instead of deleting.
alter table public.calendar_follows add column if not exists followed boolean not null default true;
