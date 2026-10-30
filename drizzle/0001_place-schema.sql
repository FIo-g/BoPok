CREATE TYPE "public"."leg_transport" AS ENUM('walk', 'car', 'taxi', 'bus');--> statement-breakpoint
CREATE TYPE "public"."place_confidence" AS ENUM('A', 'B', 'C');--> statement-breakpoint
CREATE TYPE "public"."place_node_kind" AS ENUM('parking', 'stop', 'entrance', 'sight', 'exit', 'rest', 'toilet');--> statement-breakpoint
CREATE TYPE "public"."place_rest_type" AS ENUM('indoor', 'outdoor');--> statement-breakpoint
CREATE TYPE "public"."place_stairs_status" AS ENUM('present', 'confirmed_none', 'unknown');--> statement-breakpoint
CREATE TABLE "leg_cache" (
	"key" text PRIMARY KEY NOT NULL,
	"mode" "leg_transport" NOT NULL,
	"distance_m" double precision NOT NULL,
	"duration_min" double precision,
	"path" jsonb NOT NULL,
	"stairs_status" "place_stairs_status" NOT NULL,
	"stairs_count" integer,
	"fare_krw" double precision,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	"source" text NOT NULL,
	"checked_at" text NOT NULL,
	"confidence" "place_confidence" NOT NULL,
	CONSTRAINT "leg_cache_distance_nonnegative" CHECK ("leg_cache"."distance_m" >= 0 and "leg_cache"."distance_m" < 'Infinity'::float8),
	CONSTRAINT "leg_cache_duration_nonnegative" CHECK ("leg_cache"."duration_min" >= 0 and "leg_cache"."duration_min" < 'Infinity'::float8),
	CONSTRAINT "leg_cache_fare_nonnegative" CHECK ("leg_cache"."fare_krw" >= 0 and "leg_cache"."fare_krw" < 'Infinity'::float8),
	CONSTRAINT "leg_cache_path_array" CHECK (jsonb_typeof("leg_cache"."path") = 'array'),
	CONSTRAINT "leg_cache_stairs_count_nonnegative" CHECK ("leg_cache"."stairs_count" >= 0),
	CONSTRAINT "leg_cache_source_nonempty" CHECK (length(trim("leg_cache"."source")) > 0),
	CONSTRAINT "leg_cache_checked_at_nonempty" CHECK (length(trim("leg_cache"."checked_at")) > 0)
);
--> statement-breakpoint
CREATE TABLE "place_nodes" (
	"id" text NOT NULL,
	"place_id" text NOT NULL,
	"kind" "place_node_kind" NOT NULL,
	"name" text NOT NULL,
	"rest_type" "place_rest_type",
	"lng" double precision NOT NULL,
	"lat" double precision NOT NULL,
	CONSTRAINT "place_nodes_place_id_id_pk" PRIMARY KEY("place_id","id"),
	CONSTRAINT "place_nodes_coord_range" CHECK ("place_nodes"."lng" between -180 and 180 and "place_nodes"."lat" between -90 and 90)
);
--> statement-breakpoint
CREATE TABLE "place_segments" (
	"id" text NOT NULL,
	"place_id" text NOT NULL,
	"from_node_id" text NOT NULL,
	"to_node_id" text NOT NULL,
	"order" integer NOT NULL,
	"distance_m" double precision NOT NULL,
	"path" jsonb NOT NULL,
	"stairs_status" "place_stairs_status" NOT NULL,
	"stairs_count" integer,
	"slope" boolean NOT NULL,
	"optional" boolean NOT NULL,
	"detour_of" text,
	"source" text NOT NULL,
	"checked_at" text NOT NULL,
	"confidence" "place_confidence" NOT NULL,
	CONSTRAINT "place_segments_place_id_id_pk" PRIMARY KEY("place_id","id"),
	CONSTRAINT "place_segments_order_nonnegative" CHECK ("place_segments"."order" >= 0),
	CONSTRAINT "place_segments_distance_nonnegative" CHECK ("place_segments"."distance_m" >= 0 and "place_segments"."distance_m" < 'Infinity'::float8),
	CONSTRAINT "place_segments_path_array" CHECK (jsonb_typeof("place_segments"."path") = 'array'),
	CONSTRAINT "place_segments_path_length" CHECK (jsonb_array_length("place_segments"."path") >= 2),
	CONSTRAINT "place_segments_stairs_count_nonnegative" CHECK ("place_segments"."stairs_count" >= 0),
	CONSTRAINT "place_segments_detour_not_self" CHECK ("place_segments"."detour_of" <> "place_segments"."id"),
	CONSTRAINT "place_segments_source_nonempty" CHECK (length(trim("place_segments"."source")) > 0),
	CONSTRAINT "place_segments_checked_at_nonempty" CHECK (length(trim("place_segments"."checked_at")) > 0)
);
--> statement-breakpoint
CREATE TABLE "places" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"category" text NOT NULL,
	"styles" text[] NOT NULL,
	"lng" double precision NOT NULL,
	"lat" double precision NOT NULL,
	"visit_min" double precision,
	"seated" boolean NOT NULL,
	"indoor" boolean NOT NULL,
	"address" text,
	"phone" text,
	"homepage" text,
	"source" text NOT NULL,
	"checked_at" text NOT NULL,
	"confidence" "place_confidence" NOT NULL,
	CONSTRAINT "places_name_nonempty" CHECK (length("places"."name") > 0),
	CONSTRAINT "places_coord_range" CHECK ("places"."lng" between -180 and 180 and "places"."lat" between -90 and 90),
	CONSTRAINT "places_visit_min_nonnegative" CHECK ("places"."visit_min" >= 0 and "places"."visit_min" < 'Infinity'::float8),
	CONSTRAINT "places_source_nonempty" CHECK (length(trim("places"."source")) > 0),
	CONSTRAINT "places_checked_at_nonempty" CHECK (length(trim("places"."checked_at")) > 0)
);
--> statement-breakpoint
ALTER TABLE "place_nodes" ADD CONSTRAINT "place_nodes_place_id_places_id_fk" FOREIGN KEY ("place_id") REFERENCES "public"."places"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "place_segments" ADD CONSTRAINT "place_segments_place_id_places_id_fk" FOREIGN KEY ("place_id") REFERENCES "public"."places"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "place_segments" ADD CONSTRAINT "place_segments_from_node_fk" FOREIGN KEY ("place_id","from_node_id") REFERENCES "public"."place_nodes"("place_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "place_segments" ADD CONSTRAINT "place_segments_to_node_fk" FOREIGN KEY ("place_id","to_node_id") REFERENCES "public"."place_nodes"("place_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "place_segments" ADD CONSTRAINT "place_segments_detour_fk" FOREIGN KEY ("place_id","detour_of") REFERENCES "public"."place_segments"("place_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "place_segments_place_order_idx" ON "place_segments" USING btree ("place_id","order");