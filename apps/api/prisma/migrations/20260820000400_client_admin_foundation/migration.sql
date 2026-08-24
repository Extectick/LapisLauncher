ALTER TABLE "build_mods"
  ADD COLUMN "enabled" BOOLEAN NOT NULL DEFAULT true;

CREATE INDEX "build_mods_build_id_enabled_idx"
  ON "build_mods"("build_id", "enabled");
