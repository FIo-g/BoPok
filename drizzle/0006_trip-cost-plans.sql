CREATE TABLE "version_cost_plans" (
	"version_id" text NOT NULL,
	"day" integer NOT NULL,
	"party_size" integer NOT NULL,
	"context" text NOT NULL,
	"drafts" jsonb NOT NULL,
	"extra_count" integer NOT NULL,
	"revision" integer NOT NULL,
	"updated_by_user_id" text NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "version_cost_plans_version_id_day_pk" PRIMARY KEY("version_id","day")
);
--> statement-breakpoint
ALTER TABLE "version_cost_plans" ADD CONSTRAINT "version_cost_plans_version_id_trip_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."trip_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "version_cost_plans" ADD CONSTRAINT "version_cost_plans_updated_by_user_id_user_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;