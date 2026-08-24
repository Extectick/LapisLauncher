ALTER TABLE "build_mods"
ADD COLUMN "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

CREATE INDEX "build_mods_build_id_created_at_idx"
ON "build_mods"("build_id", "created_at");
