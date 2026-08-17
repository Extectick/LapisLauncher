CREATE TABLE "game_tickets" (
    "id" UUID NOT NULL,
    "token_hash" CHAR(64) NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "used_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "user_id" UUID NOT NULL,
    "server_id" VARCHAR(32) NOT NULL,
    CONSTRAINT "game_tickets_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "game_tickets_token_hash_key" ON "game_tickets"("token_hash");
CREATE INDEX "game_tickets_user_id_idx" ON "game_tickets"("user_id");
CREATE INDEX "game_tickets_server_id_idx" ON "game_tickets"("server_id");
ALTER TABLE "game_tickets" ADD CONSTRAINT "game_tickets_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
