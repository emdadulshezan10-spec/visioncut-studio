-- VisionCut Studio — Supabase setup.
-- Run ONCE in the Supabase SQL editor AFTER creating the tables with `npm run db:push`.
-- Safe to re-run (idempotent where possible).

-- 1) Link our users table to Supabase Auth. Passwords live ONLY in auth.users (bcrypt hash, managed by Supabase).
alter table public.users drop constraint if exists users_id_fkey;
alter table public.users
  add constraint users_id_fkey foreign key (id) references auth.users (id) on delete cascade;

-- 2) Create profile / subscription / preferences rows automatically at sign-up.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.users (id, email, full_name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data ->> 'full_name', split_part(new.email, '@', 1)))
  on conflict (id) do nothing;

  insert into public.subscriptions (id, user_id, plan, status, limits, updated_at)
  values (gen_random_uuid(), new.id, 'free', 'active',
          '{"maxProjects":5,"maxStorageMb":0,"maxExportHeight":1080}'::jsonb, now())
  on conflict (user_id) do nothing;

  insert into public.user_preferences (user_id) values (new.id) on conflict (user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- 3) Row Level Security: a signed-in user can only ever touch their own rows.
alter table public.users            enable row level security;
alter table public.projects         enable row level security;
alter table public.project_files    enable row level security;
alter table public.project_settings enable row level security;
alter table public.subscriptions    enable row level security;
alter table public.export_history   enable row level security;
alter table public.user_preferences enable row level security;

-- users: read own row; update ONLY harmless columns (so nobody can grant themselves a paid plan).
drop policy if exists users_select_own on public.users;
create policy users_select_own on public.users for select to authenticated using (id = auth.uid());
drop policy if exists users_update_own on public.users;
create policy users_update_own on public.users for update to authenticated using (id = auth.uid()) with check (id = auth.uid());
revoke update on public.users from authenticated, anon;
grant update (full_name, profile_image, last_login) on public.users to authenticated;

-- projects
drop policy if exists projects_own on public.projects;
create policy projects_own on public.projects for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- project_files
drop policy if exists project_files_own on public.project_files;
create policy project_files_own on public.project_files for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- project_settings (no user_id column: authorise through the parent project)
drop policy if exists project_settings_own on public.project_settings;
create policy project_settings_own on public.project_settings for all to authenticated
  using (exists (select 1 from public.projects p where p.id = project_id and p.user_id = auth.uid()))
  with check (exists (select 1 from public.projects p where p.id = project_id and p.user_id = auth.uid()));

-- subscriptions: read-only for users. Only the server / a payment webhook (service role) may change plans.
drop policy if exists subscriptions_select_own on public.subscriptions;
create policy subscriptions_select_own on public.subscriptions for select to authenticated using (user_id = auth.uid());

-- export_history
drop policy if exists export_history_select_own on public.export_history;
create policy export_history_select_own on public.export_history for select to authenticated using (user_id = auth.uid());
drop policy if exists export_history_insert_own on public.export_history;
create policy export_history_insert_own on public.export_history for insert to authenticated with check (user_id = auth.uid());

-- user_preferences
drop policy if exists user_preferences_own on public.user_preferences;
create policy user_preferences_own on public.user_preferences for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- 4) Storage buckets (both PRIVATE). Objects must live under a folder named after the user's id.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', false, 2097152, array['image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do update set public = false, file_size_limit = 2097152, allowed_mime_types = excluded.allowed_mime_types;

insert into storage.buckets (id, name, public)
values ('project-media', 'project-media', false)
on conflict (id) do update set public = false;

drop policy if exists avatars_own on storage.objects;
create policy avatars_own on storage.objects for all to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists project_media_own on storage.objects;
create policy project_media_own on storage.objects for all to authenticated
  using (bucket_id = 'project-media' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'project-media' and (storage.foldername(name))[1] = auth.uid()::text);
