ALTER TABLE "medicines" ADD COLUMN IF NOT EXISTS "brand_base" text;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "medicines_brand_base_idx" ON "medicines" USING btree ("brand_base","company_id","form");
