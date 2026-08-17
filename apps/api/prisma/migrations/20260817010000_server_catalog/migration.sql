CREATE TABLE "servers" (
    "id" VARCHAR(32) NOT NULL,
    "slug" VARCHAR(64) NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "host" VARCHAR(255) NOT NULL,
    "port" INTEGER NOT NULL,
    "minecraft_version" VARCHAR(32) NOT NULL,
    "loader" VARCHAR(32) NOT NULL,
    "visible" BOOLEAN NOT NULL DEFAULT true,
    "maintenance" BOOLEAN NOT NULL DEFAULT false,
    "online_players" INTEGER,
    "max_players" INTEGER,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "servers_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "servers_slug_key" ON "servers"("slug");

INSERT INTO "servers" ("id", "slug", "name", "host", "port", "minecraft_version", "loader", "visible", "maintenance", "updated_at")
VALUES ('main', 'main', 'Lapis', '195.208.129.43', 25565, '26.2', 'fabric', true, false, CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO NOTHING;
