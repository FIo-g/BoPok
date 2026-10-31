CREATE TABLE "trip_versions" (
	"id" text PRIMARY KEY NOT NULL,
	"trip_id" text NOT NULL,
	"number" integer NOT NULL,
	"parent_id" text,
	"made_by" text NOT NULL,
	"made_by_user_id" text,
	"stops" jsonb NOT NULL,
	"judge_summary" jsonb,
	"note" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "trip_versions_trip_number_unique" UNIQUE("trip_id","number")
);
--> statement-breakpoint
CREATE TABLE "version_opinions" (
	"id" text PRIMARY KEY NOT NULL,
	"version_id" text NOT NULL,
	"stop_key" text,
	"user_id" text NOT NULL,
	"reactions" text[] DEFAULT '{}' NOT NULL,
	"comment" text,
	"applied_in_version_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "trip_versions" ADD CONSTRAINT "trip_versions_trip_id_trips_id_fk" FOREIGN KEY ("trip_id") REFERENCES "public"."trips"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip_versions" ADD CONSTRAINT "trip_versions_parent_id_trip_versions_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."trip_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip_versions" ADD CONSTRAINT "trip_versions_made_by_user_id_user_id_fk" FOREIGN KEY ("made_by_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "version_opinions" ADD CONSTRAINT "version_opinions_version_id_trip_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."trip_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "version_opinions" ADD CONSTRAINT "version_opinions_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "version_opinions" ADD CONSTRAINT "version_opinions_applied_in_version_id_trip_versions_id_fk" FOREIGN KEY ("applied_in_version_id") REFERENCES "public"."trip_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "trip_versions_tripId_idx" ON "trip_versions" USING btree ("trip_id");--> statement-breakpoint
CREATE INDEX "version_opinions_versionId_idx" ON "version_opinions" USING btree ("version_id");--> statement-breakpoint
ALTER TABLE "trips" ADD CONSTRAINT "trips_confirmed_version_id_trip_versions_id_fk" FOREIGN KEY ("confirmed_version_id") REFERENCES "public"."trip_versions"("id") ON DELETE no action ON UPDATE no action;