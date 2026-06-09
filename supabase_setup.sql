-- ============================================================================
--  Anderson Internal Portal — Supabase storage setup
--  Run this ONCE in: Supabase Dashboard -> SQL Editor -> New query -> Run
--  (Buckets are created in step 1 via the Storage UI; tables/policies below.)
-- ============================================================================

-- ----------------------------------------------------------------------------
-- STEP 1 (do this in the DASHBOARD UI, not here):
--   Supabase -> Storage -> "New bucket" and create these 5 buckets.
--   For EACH bucket toggle **Public bucket = ON**:
--       certificates
--       album
--       avatars
--       publications      (scaffolding for a future tab)
--       presentations     (scaffolding for a future tab)
--   Then come back and run STEP 2 + STEP 3 below.
-- ----------------------------------------------------------------------------


-- ============================================================================
-- STEP 2 — TABLES
-- ============================================================================

create table if not exists public.certificates (
    id               uuid primary key default gen_random_uuid(),
    employee_id      text not null,
    event_name       text,
    event_date       text,
    place            text,
    award            text,
    certificate_url  text,
    certificate_name text,
    photo_url        text,
    created_at       timestamptz not null default now()
);
create index if not exists certificates_employee_id_idx on public.certificates (employee_id);

create table if not exists public.album_photos (
    id          uuid primary key default gen_random_uuid(),
    src_url     text not null,
    name        text,
    photo_date  text,
    created_at  timestamptz not null default now()
);

create table if not exists public.employee_avatars (
    employee_id text primary key,
    avatar_url  text,
    updated_at  timestamptz not null default now()
);

create table if not exists public.app_settings (
    key   text primary key,
    value jsonb
);

create table if not exists public.publications (
    id           uuid primary key default gen_random_uuid(),
    employee_id  text not null,
    author_name  text,
    title        text,
    authors      text,
    venue        text,
    pub_date     text,
    link         text,
    file_url     text,
    file_name    text,
    cover_url    text,
    created_at   timestamptz not null default now()
);
create index if not exists publications_employee_id_idx on public.publications (employee_id);

create table if not exists public.presentations (
    id           uuid primary key default gen_random_uuid(),
    employee_id  text not null,
    author_name  text,
    title        text,
    event_name   text,
    pres_date    text,
    place        text,
    pres_type    text,
    file_url     text,
    file_name    text,
    photo_url    text,
    created_at   timestamptz not null default now()
);
create index if not exists presentations_employee_id_idx on public.presentations (employee_id);


-- ============================================================================
-- STEP 3 — ROW LEVEL SECURITY
--   Everyone (incl. logged-out) can READ so content displays for all employees.
--   Only logged-in (authenticated) users can WRITE.
-- ============================================================================

alter table public.certificates     enable row level security;
alter table public.album_photos      enable row level security;
alter table public.employee_avatars  enable row level security;
alter table public.app_settings      enable row level security;
alter table public.publications      enable row level security;
alter table public.presentations     enable row level security;

-- certificates
drop policy if exists certificates_read  on public.certificates;
drop policy if exists certificates_write on public.certificates;
create policy certificates_read  on public.certificates for select using (true);
create policy certificates_write on public.certificates for all
    to authenticated using (true) with check (true);

-- album_photos
drop policy if exists album_photos_read  on public.album_photos;
drop policy if exists album_photos_write on public.album_photos;
create policy album_photos_read  on public.album_photos for select using (true);
create policy album_photos_write on public.album_photos for all
    to authenticated using (true) with check (true);

-- employee_avatars
drop policy if exists employee_avatars_read  on public.employee_avatars;
drop policy if exists employee_avatars_write on public.employee_avatars;
create policy employee_avatars_read  on public.employee_avatars for select using (true);
create policy employee_avatars_write on public.employee_avatars for all
    to authenticated using (true) with check (true);

-- app_settings
drop policy if exists app_settings_read  on public.app_settings;
drop policy if exists app_settings_write on public.app_settings;
create policy app_settings_read  on public.app_settings for select using (true);
create policy app_settings_write on public.app_settings for all
    to authenticated using (true) with check (true);

-- publications
drop policy if exists publications_read  on public.publications;
drop policy if exists publications_write on public.publications;
create policy publications_read  on public.publications for select using (true);
create policy publications_write on public.publications for all
    to authenticated using (true) with check (true);

-- presentations
drop policy if exists presentations_read  on public.presentations;
drop policy if exists presentations_write on public.presentations;
create policy presentations_read  on public.presentations for select using (true);
create policy presentations_write on public.presentations for all
    to authenticated using (true) with check (true);


-- ============================================================================
-- STEP 4 — STORAGE POLICIES (buckets)
--   Public read on the 5 buckets; logged-in users can upload/replace/delete.
-- ============================================================================

drop policy if exists portal_storage_read   on storage.objects;
drop policy if exists portal_storage_write  on storage.objects;
drop policy if exists portal_storage_update on storage.objects;
drop policy if exists portal_storage_delete on storage.objects;

create policy portal_storage_read on storage.objects for select
    using (bucket_id in ('certificates','album','avatars','publications','presentations'));

create policy portal_storage_write on storage.objects for insert to authenticated
    with check (bucket_id in ('certificates','album','avatars','publications','presentations'));

create policy portal_storage_update on storage.objects for update to authenticated
    using (bucket_id in ('certificates','album','avatars','publications','presentations'));

create policy portal_storage_delete on storage.objects for delete to authenticated
    using (bucket_id in ('certificates','album','avatars','publications','presentations'));

-- Done.
