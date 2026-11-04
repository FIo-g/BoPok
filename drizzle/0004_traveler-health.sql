CREATE TABLE "trip_traveler_health" (
	"trip_id" text NOT NULL,
	"traveler_id" text NOT NULL,
	"conditions" text[] DEFAULT '{}' NOT NULL,
	"medication_classes" text[] DEFAULT '{}' NOT NULL,
	"visibility" text NOT NULL,
	"consent_at" timestamp with time zone NOT NULL,
	"entered_by_user_id" text NOT NULL,
	CONSTRAINT "trip_traveler_health_trip_id_traveler_id_pk" PRIMARY KEY("trip_id","traveler_id")
);
--> statement-breakpoint
ALTER TABLE "trip_travelers" ADD COLUMN "exercise_frequency" text;--> statement-breakpoint
ALTER TABLE "trip_traveler_health" ADD CONSTRAINT "trip_traveler_health_trip_id_trips_id_fk" FOREIGN KEY ("trip_id") REFERENCES "public"."trips"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip_traveler_health" ADD CONSTRAINT "trip_traveler_health_entered_by_user_id_user_id_fk" FOREIGN KEY ("entered_by_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;