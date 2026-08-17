CREATE TABLE "game_builds" (
    "id" VARCHAR(64) NOT NULL,
    "slug" VARCHAR(64) NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "minecraft_version" VARCHAR(32) NOT NULL,
    "loader" VARCHAR(32) NOT NULL,
    "loader_version" VARCHAR(32) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "game_builds_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "game_builds_slug_key" ON "game_builds"("slug");

CREATE TABLE "build_mods" (
    "id" UUID NOT NULL,
    "build_id" VARCHAR(64) NOT NULL,
    "file_name" VARCHAR(180) NOT NULL,
    "url" TEXT NOT NULL,
    "sha1" CHAR(40) NOT NULL,
    "required" BOOLEAN NOT NULL DEFAULT true,
    CONSTRAINT "build_mods_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "build_mods_build_id_file_name_key" ON "build_mods"("build_id", "file_name");
CREATE INDEX "build_mods_build_id_idx" ON "build_mods"("build_id");

INSERT INTO "game_builds" ("id", "slug", "name", "minecraft_version", "loader", "loader_version")
VALUES ('lapis-26.2-fabric-0.19.3', 'lapis-26.2-fabric-0.19.3', 'Lapis 26.2', '26.2', 'fabric', '0.19.3')
ON CONFLICT ("id") DO NOTHING;

ALTER TABLE "servers" ADD COLUMN "active_build_id" VARCHAR(64);
UPDATE "servers" SET "active_build_id" = 'lapis-26.2-fabric-0.19.3' WHERE "active_build_id" IS NULL;
ALTER TABLE "servers" ALTER COLUMN "active_build_id" SET NOT NULL;
CREATE INDEX "servers_active_build_id_idx" ON "servers"("active_build_id");

ALTER TABLE "servers" ADD CONSTRAINT "servers_active_build_id_fkey"
  FOREIGN KEY ("active_build_id") REFERENCES "game_builds"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "build_mods" ADD CONSTRAINT "build_mods_build_id_fkey"
  FOREIGN KEY ("build_id") REFERENCES "game_builds"("id") ON DELETE CASCADE ON UPDATE CASCADE;
