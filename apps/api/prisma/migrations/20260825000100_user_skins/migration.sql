CREATE TABLE "user_skins" (
    "user_id" UUID NOT NULL,
    "texture_value" TEXT NOT NULL,
    "texture_signature" TEXT NOT NULL,
    "texture_url" VARCHAR(255) NOT NULL,
    "model" VARCHAR(8) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_skins_pkey" PRIMARY KEY ("user_id")
);

ALTER TABLE "user_skins"
ADD CONSTRAINT "user_skins_user_id_fkey"
FOREIGN KEY ("user_id") REFERENCES "users"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "user_skins"
ADD CONSTRAINT "user_skins_model_check"
CHECK ("model" IN ('default', 'slim'));
