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
ALTER TABLE "trip_travelers" ADD CONSTRAINT "trip_travelers_trip_id_trips_id_fk" FOREIGN KEY ("trip_id") REFERENCES "public"."trips"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip_travelers" ADD CONSTRAINT "trip_travelers_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trips" ADD CONSTRAINT "trips_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trips" ADD CONSTRAINT "trips_confirmed_by_user_id_user_id_fk" FOREIGN KEY ("confirmed_by_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trips" ADD CONSTRAINT "trips_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "trip_travelers_tripId_idx" ON "trip_travelers" USING btree ("trip_id");--> statement-breakpoint
CREATE INDEX "trips_groupId_idx" ON "trips" USING btree ("group_id");