BEGIN;
ALTER TABLE public.user_preferences
  ADD COLUMN tutorial_status text NOT NULL DEFAULT 'unseen'
  CONSTRAINT user_preferences_tutorial_status_check
  CHECK (tutorial_status IN ('unseen', 'dismissed', 'completed'));
NOTIFY pgrst, 'reload schema';
COMMIT;
