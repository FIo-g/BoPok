CREATE TABLE "group_invites" (
	"id" text PRIMARY KEY NOT NULL,
	"group_id" text NOT NULL,
	"token" text NOT NULL,
	"created_by" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "group_invites_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "trip_interviews" (
	"trip_id" text PRIMARY KEY NOT NULL,
	"state" jsonb NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trip_travelers" (
	"id" text NOT NULL,
	"trip_id" text NOT NULL,
	"user_id" text,
	"label" text NOT NULL,
	"age" integer,
	"height_cm" double precision,
	"sex" text,
	"pace" text NOT NULL,
	"mobility_aid" boolean DEFAULT false NOT NULL,
	"is_parent" boolean DEFAULT false NOT NULL,
	"condition" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"filled_by_self" boolean DEFAULT false NOT NULL,
	"sort_order" integer NOT NULL,
	CONSTRAINT "trip_travelers_trip_id_id_pk" PRIMARY KEY("trip_id","id")
);
--> statement-breakpoint
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
CREATE TABLE "trips" (
	"id" text PRIMARY KEY NOT NULL,
	"group_id" text NOT NULL,
	"title" text NOT NULL,
	"date" date,
	"start_mode" text NOT NULL,
	"transport" text,
	"styles" text[] DEFAULT '{}' NOT NULL,
	"budget" text,
	"confirmed_version_id" text,
	"confirmed_by_user_id" text,
	"created_by" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
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
ALTER TABLE "group_invites" ADD CONSTRAINT "group_invites_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_invites" ADD CONSTRAINT "group_invites_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip_interviews" ADD CONSTRAINT "trip_interviews_trip_id_trips_id_fk" FOREIGN KEY ("trip_id") REFERENCES "public"."trips"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip_travelers" ADD CONSTRAINT "trip_travelers_trip_id_trips_id_fk" FOREIGN KEY ("trip_id") REFERENCES "public"."trips"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip_travelers" ADD CONSTRAINT "trip_travelers_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip_versions" ADD CONSTRAINT "trip_versions_trip_id_trips_id_fk" FOREIGN KEY ("trip_id") REFERENCES "public"."trips"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip_versions" ADD CONSTRAINT "trip_versions_parent_id_trip_versions_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."trip_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip_versions" ADD CONSTRAINT "trip_versions_made_by_user_id_user_id_fk" FOREIGN KEY ("made_by_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trips" ADD CONSTRAINT "trips_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trips" ADD CONSTRAINT "trips_confirmed_version_id_trip_versions_id_fk" FOREIGN KEY ("confirmed_version_id") REFERENCES "public"."trip_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trips" ADD CONSTRAINT "trips_confirmed_by_user_id_user_id_fk" FOREIGN KEY ("confirmed_by_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trips" ADD CONSTRAINT "trips_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "version_opinions" ADD CONSTRAINT "version_opinions_version_id_trip_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."trip_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "version_opinions" ADD CONSTRAINT "version_opinions_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "version_opinions" ADD CONSTRAINT "version_opinions_applied_in_version_id_trip_versions_id_fk" FOREIGN KEY ("applied_in_version_id") REFERENCES "public"."trip_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "group_invites_groupId_idx" ON "group_invites" USING btree ("group_id");--> statement-breakpoint
CREATE INDEX "trip_travelers_tripId_idx" ON "trip_travelers" USING btree ("trip_id");--> statement-breakpoint
CREATE INDEX "trip_versions_tripId_idx" ON "trip_versions" USING btree ("trip_id");--> statement-breakpoint
CREATE INDEX "trips_groupId_idx" ON "trips" USING btree ("group_id");--> statement-breakpoint
CREATE INDEX "version_opinions_versionId_idx" ON "version_opinions" USING btree ("version_id");