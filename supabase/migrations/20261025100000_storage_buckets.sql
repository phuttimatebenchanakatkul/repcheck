-- Storage: the two kinds of file the website keeps, as private buckets.
--
-- Today both live on the Render disk, are never served by a static route, and are
-- reached only through an owner-checked Flask route (/api/checkin/photo/<id> and
-- /analyze/video/<id>). Challenge clips are NOT kept (the route deletes them as soon as
-- they are graded), so they get no bucket.
--
-- Object key: '<user id>/<name>', where <name> is progress_photos.filename or
-- analyze_results.video_filename. The first path segment is what the policies compare
-- with the caller, so a file can be reached only by the account it sits under.
--
-- What the app may do: READ its own objects (a signed URL, a download, a listing of its
-- own folder). Nothing else. Uploading, replacing and deleting stay with Flask (service
-- role, which bypasses these policies) for the same reason the matching tables are
-- read-only to the app: Flask checks what the database cannot (that the bytes are really
-- an image, the per-account cap, the check-in date window), and an object nobody records
-- in progress_photos / analyze_results is just stored garbage. If the app ever uploads
-- straight to Storage (the plan's phase 4 does for analysis clips), that is a new INSERT
-- policy and new isolation tests, decided then.
--
-- Rows in storage.objects cannot be deleted with SQL (Storage's own trigger refuses and
-- the bytes would be orphaned anyway): deleting an account must remove its objects through
-- the Storage API first. Deleting the Auth user does not cascade to them.

-- The limits are the website's own: progress photos were capped at MAX_PHOTO_BYTES = 12 MiB
-- and recognised as JPEG / PNG / WebP; an analysis clip is a trimmed copy of an upload that
-- the site accepted as .mp4 .mov .m4v .avi .mkv .webm (it has to fit Gemini's ~20 MB inline
-- request, so 50 MiB is generous headroom, and is also Supabase's default project-wide cap).
-- Storage checks the declared Content-Type, not the bytes: this is a seat belt, not a
-- validator.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
    ('progress-photos', 'progress-photos', false, 12582912,
        array['image/jpeg', 'image/png', 'image/webp']),
    ('analyze-videos', 'analyze-videos', false, 52428800,
        array['video/mp4', 'video/quicktime', 'video/x-m4v', 'video/x-msvideo',
              'video/x-matroska', 'video/webm']);

-- RLS is already on for storage.objects and nothing is allowed without a policy. One
-- policy per bucket, so each can be loosened (and tested) on its own.
create policy progress_photos_read_own on storage.objects
    for select to authenticated
    using (bucket_id = 'progress-photos' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy analyze_videos_read_own on storage.objects
    for select to authenticated
    using (bucket_id = 'analyze-videos' and (storage.foldername(name))[1] = (select auth.uid())::text);
