CREATE TABLE "categories" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"path" text NOT NULL,
	"slug_path" text NOT NULL,
	"depth" integer NOT NULL,
	"parent_id" integer
);
--> statement-breakpoint
CREATE TABLE "companies" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "generics" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"source_id" text
);
--> statement-breakpoint
CREATE TABLE "medicines" (
	"id" serial PRIMARY KEY NOT NULL,
	"source_id" text NOT NULL,
	"slug" text NOT NULL,
	"brand_name" text NOT NULL,
	"display_name" text NOT NULL,
	"generic_id" integer,
	"company_id" integer,
	"category_id" integer,
	"generic_name" text,
	"generic_slug" text,
	"company_name" text,
	"company_slug" text,
	"category_name" text,
	"category_slug_path" text,
	"form" text NOT NULL,
	"strength_raw" text NOT NULL,
	"strength_value" double precision,
	"strength_unit" text,
	"is_combo_strength" boolean DEFAULT false NOT NULL,
	"pack_type" text,
	"pack_size" integer,
	"base_unit" text,
	"base_count" integer,
	"current_price" numeric(10, 2),
	"currency" text DEFAULT 'BDT' NOT NULL,
	"image_url" text,
	"source_url" text NOT NULL,
	"scraped_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"search_vector" "tsvector" GENERATED ALWAYS AS (to_tsvector('simple',
        coalesce(brand_name, '') || ' ' ||
        coalesce(display_name, '') || ' ' ||
        coalesce(generic_name, '') || ' ' ||
        coalesce(company_name, '') || ' ' ||
        coalesce(strength_raw, ''))) STORED
);
--> statement-breakpoint
CREATE TABLE "price_history" (
	"id" serial PRIMARY KEY NOT NULL,
	"medicine_id" integer NOT NULL,
	"price" numeric(10, 2),
	"currency" text DEFAULT 'BDT' NOT NULL,
	"pack_type" text,
	"pack_size" integer,
	"source" text DEFAULT 'arogga' NOT NULL,
	"captured_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scrape_runs" (
	"id" serial PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"items_processed" integer DEFAULT 0 NOT NULL,
	"items_written" integer DEFAULT 0 NOT NULL,
	"notes" text
);
--> statement-breakpoint
ALTER TABLE "medicines" ADD CONSTRAINT "medicines_generic_id_generics_id_fk" FOREIGN KEY ("generic_id") REFERENCES "public"."generics"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "medicines" ADD CONSTRAINT "medicines_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "medicines" ADD CONSTRAINT "medicines_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_history" ADD CONSTRAINT "price_history_medicine_id_medicines_id_fk" FOREIGN KEY ("medicine_id") REFERENCES "public"."medicines"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "categories_path_uq" ON "categories" USING btree ("path");--> statement-breakpoint
CREATE UNIQUE INDEX "categories_slug_path_uq" ON "categories" USING btree ("slug_path");--> statement-breakpoint
CREATE INDEX "categories_depth_idx" ON "categories" USING btree ("depth");--> statement-breakpoint
CREATE UNIQUE INDEX "companies_slug_uq" ON "companies" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "companies_name_idx" ON "companies" USING btree ("name");--> statement-breakpoint
CREATE UNIQUE INDEX "generics_slug_uq" ON "generics" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "generics_name_idx" ON "generics" USING btree ("name");--> statement-breakpoint
CREATE UNIQUE INDEX "medicines_source_id_uq" ON "medicines" USING btree ("source_id");--> statement-breakpoint
CREATE UNIQUE INDEX "medicines_slug_uq" ON "medicines" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "medicines_generic_idx" ON "medicines" USING btree ("generic_id");--> statement-breakpoint
CREATE INDEX "medicines_company_idx" ON "medicines" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "medicines_category_idx" ON "medicines" USING btree ("category_id");--> statement-breakpoint
CREATE INDEX "medicines_form_idx" ON "medicines" USING btree ("form");--> statement-breakpoint
CREATE INDEX "medicines_alt_idx" ON "medicines" USING btree ("generic_id","strength_value","strength_unit","form");--> statement-breakpoint
CREATE INDEX "medicines_price_idx" ON "medicines" USING btree ("current_price");--> statement-breakpoint
CREATE INDEX "medicines_search_idx" ON "medicines" USING gin ("search_vector");--> statement-breakpoint
CREATE INDEX "price_history_med_idx" ON "price_history" USING btree ("medicine_id");