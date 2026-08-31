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
    ref_link     text,
    status       text default 'Completed',
    remarks      text,
    created_at   timestamptz not null default now()
);
create index if not exists presentations_employee_id_idx on public.presentations (employee_id);
-- Migration for existing tables created before ref_link/status/remarks existed:
alter table public.presentations add column if not exists ref_link text;
alter table public.presentations add column if not exists status text default 'Completed';
alter table public.presentations add column if not exists remarks text;

create table if not exists public.leaves (
    id           uuid primary key default gen_random_uuid(),
    employee_id  text not null,
    leave_date   text not null,
    created_at   timestamptz not null default now(),
    unique (employee_id, leave_date)
);
create index if not exists leaves_employee_id_idx on public.leaves (employee_id);

create table if not exists public.work_updates (
    id           uuid primary key default gen_random_uuid(),
    name         text not null,
    role         text,
    avatar       text,
    update_date  text not null,
    update_text  text not null,
    created_at   timestamptz not null default now()
);
create index if not exists work_updates_date_idx on public.work_updates (update_date);

create table if not exists public.presentation_assignments (
    id               uuid primary key default gen_random_uuid(),
    assigned_to      text not null,
    assigned_by      text,
    title            text not null,
    linkedin_url     text,
    description      text,
    assigned_date    text not null,
    due_date         text,
    status           text default 'Pending',
    completed_date   text,
    completion_notes text,
    created_at       timestamptz not null default now()
);
create index if not exists presentation_assignments_assigned_to_idx on public.presentation_assignments (assigned_to);
create index if not exists presentation_assignments_status_idx on public.presentation_assignments (status);

-- Detected changes from the daily conference auto-refresh (see the
-- conference-tools Edge Function's "refresh_all" mode) awaiting a human's
-- approval before they're written into the Google Sheet. Blank fields are
-- filled in automatically without needing a row here; only a CHANGE to an
-- already-filled field lands here for review.
create table if not exists public.conference_pending_changes (
    id              uuid primary key default gen_random_uuid(),
    conference_name text not null,
    conference_link text,
    field           text not null,
    old_value       text,
    new_value       text,
    detected_at     timestamptz not null default now()
);
create index if not exists conference_pending_changes_name_idx on public.conference_pending_changes (conference_name);


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
alter table public.leaves            enable row level security;
alter table public.work_updates      enable row level security;
alter table public.presentation_assignments enable row level security;
alter table public.conference_pending_changes enable row level security;

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

-- leaves
drop policy if exists leaves_read  on public.leaves;
drop policy if exists leaves_write on public.leaves;
create policy leaves_read  on public.leaves for select using (true);
create policy leaves_write on public.leaves for all
    to authenticated using (true) with check (true);

-- work_updates
drop policy if exists work_updates_read  on public.work_updates;
drop policy if exists work_updates_write on public.work_updates;
create policy work_updates_read  on public.work_updates for select using (true);
create policy work_updates_write on public.work_updates for all
    to authenticated using (true) with check (true);

-- presentation_assignments
drop policy if exists presentation_assignments_read  on public.presentation_assignments;
drop policy if exists presentation_assignments_write on public.presentation_assignments;
create policy presentation_assignments_read  on public.presentation_assignments for select using (true);
create policy presentation_assignments_write on public.presentation_assignments for all
    to authenticated using (true) with check (true);

-- conference_pending_changes
-- (the daily refresh job inserts using the service-role key, which bypasses
-- RLS entirely, so it doesn't need its own policy here)
drop policy if exists conference_pending_changes_read  on public.conference_pending_changes;
drop policy if exists conference_pending_changes_write on public.conference_pending_changes;
create policy conference_pending_changes_read  on public.conference_pending_changes for select using (true);
create policy conference_pending_changes_write on public.conference_pending_changes for all
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


-- ============================================================================
-- STEP 5 — DAILY CONFERENCE REFRESH (Cron Job)
--   Re-visits each conference's link once a day via the conference-tools
--   Edge Function: blank fields (Registration Deadline, Location, Abstract
--   Submission) get filled in automatically; a CHANGE to an already-filled
--   field is written to conference_pending_changes for review in the app
--   instead of being applied silently.
--
--   The anon key below is the same public key already embedded in index.html
--   (client-side Supabase keys are meant to be public) — not a secret.
-- ============================================================================

create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule(
    'conference-daily-refresh',
    '0 3 * * *',  -- 03:00 UTC daily; edit the schedule string to change this
    $$
    select net.http_post(
        url := 'https://boghqathvnkygdzxnzkh.supabase.co/functions/v1/conference-tools',
        headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJvZ2hxYXRodm5reWdkenhuemtoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk3NzAzODAsImV4cCI6MjA5NTM0NjM4MH0.c9KemDmU7d4YGhkizU3TZx-hYaXSftazb-5RuHgV0Rs'
        ),
        body := jsonb_build_object('mode', 'refresh_all')
    );
    $$
);

-- To change the schedule later:
--   select cron.alter_job(job_id := (select jobid from cron.job where jobname = 'conference-daily-refresh'), schedule := '0 3 * * *');
-- To remove it entirely:
--   select cron.unschedule('conference-daily-refresh');

-- Done.
