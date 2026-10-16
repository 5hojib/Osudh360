--> statement-breakpoint
CREATE TABLE IF NOT EXISTS prescriptions (
  id text PRIMARY KEY,
  user_id text NOT NULL,
  title text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS prescriptions_user_updated_idx
  ON prescriptions (user_id, updated_at DESC);