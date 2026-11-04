CREATE TABLE "place_catalog" (
	"place_id" text PRIMARY KEY NOT NULL,
	"provider" text NOT NULL,
	"source_id" text NOT NULL,
	"search_text" text NOT NULL,
	"menus" jsonb NOT NULL,
	"content_hash" text NOT NULL,
	"data" jsonb NOT NULL,
	"imported_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "place_catalog_provider_valid" CHECK ("place_catalog"."provider" in ('daejeon_food', 'tourapi')),
	CONSTRAINT "place_catalog_menus_array" CHECK (jsonb_typeof("place_catalog"."menus") = 'array'),
	CONSTRAINT "place_catalog_hash_valid" CHECK ("place_catalog"."content_hash" ~ '^[a-f0-9]{64}$')
);
--> statement-breakpoint
CREATE TABLE "place_research" (
	"namespace" text NOT NULL,
	"entity" text NOT NULL,
	"external_id" text NOT NULL,
	"place_id" text,
	"hash" text NOT NULL,
	"data" jsonb NOT NULL,
	CONSTRAINT "place_research_namespace_entity_external_id_pk" PRIMARY KEY("namespace","entity","external_id")
);
--> statement-breakpoint
ALTER TABLE "places" ADD COLUMN "kind" text;--> statement-breakpoint
ALTER TABLE "place_catalog" ADD CONSTRAINT "place_catalog_place_id_places_id_fk" FOREIGN KEY ("place_id") REFERENCES "public"."places"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "places" ADD CONSTRAINT "places_kind_valid" CHECK ("places"."kind" in ('attraction', 'restaurant', 'cafe', 'lodging'));