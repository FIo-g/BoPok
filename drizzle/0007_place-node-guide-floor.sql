ALTER TABLE "place_nodes" ADD COLUMN "floor" integer;--> statement-breakpoint
ALTER TABLE "place_nodes" ADD COLUMN "guide_no" integer;--> statement-breakpoint
ALTER TABLE "place_nodes" ADD CONSTRAINT "place_nodes_guide_no_positive" CHECK ("place_nodes"."guide_no" is null or "place_nodes"."guide_no" >= 1);