CREATE TYPE "RoleScopeType" AS ENUM ('GLOBAL', 'SERVER');

CREATE TABLE "roles" (
    "id" UUID NOT NULL,
    "key" VARCHAR(64) NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "is_super_admin" BOOLEAN NOT NULL DEFAULT false,
    "is_system" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "roles_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "permissions" (
    "id" UUID NOT NULL,
    "key" VARCHAR(96) NOT NULL,
    "description" VARCHAR(255) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "permissions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "role_permissions" (
    "role_id" UUID NOT NULL,
    "permission_id" UUID NOT NULL,
    CONSTRAINT "role_permissions_pkey" PRIMARY KEY ("role_id", "permission_id")
);

CREATE TABLE "user_roles" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "role_id" UUID NOT NULL,
    "scope_type" "RoleScopeType" NOT NULL DEFAULT 'GLOBAL',
    "scope_id" VARCHAR(32),
    "assigned_by_user_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3),
    CONSTRAINT "user_roles_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "user_roles_scope_check" CHECK (
      ("scope_type" = 'GLOBAL' AND "scope_id" IS NULL) OR
      ("scope_type" = 'SERVER' AND "scope_id" IS NOT NULL)
    )
);

CREATE TABLE "audit_events" (
    "id" UUID NOT NULL,
    "actor_user_id" UUID,
    "action" VARCHAR(120) NOT NULL,
    "resource_type" VARCHAR(80) NOT NULL,
    "resource_id" VARCHAR(100),
    "server_id" VARCHAR(32),
    "before" JSONB,
    "after" JSONB,
    "request_id" VARCHAR(64),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "audit_events_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "roles_key_key" ON "roles"("key");
CREATE UNIQUE INDEX "permissions_key_key" ON "permissions"("key");
CREATE INDEX "role_permissions_permission_id_idx" ON "role_permissions"("permission_id");
CREATE INDEX "user_roles_user_id_idx" ON "user_roles"("user_id");
CREATE INDEX "user_roles_role_id_idx" ON "user_roles"("role_id");
CREATE INDEX "user_roles_scope_type_scope_id_idx" ON "user_roles"("scope_type", "scope_id");
CREATE UNIQUE INDEX "user_roles_global_unique" ON "user_roles"("user_id", "role_id")
  WHERE "scope_type" = 'GLOBAL' AND "scope_id" IS NULL;
CREATE UNIQUE INDEX "user_roles_server_unique" ON "user_roles"("user_id", "role_id", "scope_id")
  WHERE "scope_type" = 'SERVER' AND "scope_id" IS NOT NULL;
CREATE INDEX "audit_events_actor_user_id_created_at_idx" ON "audit_events"("actor_user_id", "created_at");
CREATE INDEX "audit_events_resource_type_resource_id_created_at_idx" ON "audit_events"("resource_type", "resource_id", "created_at");
CREATE INDEX "audit_events_server_id_created_at_idx" ON "audit_events"("server_id", "created_at");

ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_role_id_fkey"
  FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_permission_id_fkey"
  FOREIGN KEY ("permission_id") REFERENCES "permissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_role_id_fkey"
  FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_assigned_by_user_id_fkey"
  FOREIGN KEY ("assigned_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_actor_user_id_fkey"
  FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

INSERT INTO "roles" ("id", "key", "name", "is_super_admin", "is_system")
VALUES ('00000000-0000-4000-8000-000000000001', 'super_admin', 'Главный администратор', true, true)
ON CONFLICT ("key") DO UPDATE SET
  "name" = EXCLUDED."name",
  "is_super_admin" = true,
  "is_system" = true,
  "updated_at" = CURRENT_TIMESTAMP;

INSERT INTO "permissions" ("id", "key", "description") VALUES
  ('10000000-0000-4000-8000-000000000001', 'admin.access', 'Доступ к административному разделу'),
  ('10000000-0000-4000-8000-000000000002', 'servers.read', 'Просмотр серверов'),
  ('10000000-0000-4000-8000-000000000003', 'servers.write', 'Изменение серверов'),
  ('10000000-0000-4000-8000-000000000004', 'mods.read', 'Просмотр каталога модов'),
  ('10000000-0000-4000-8000-000000000005', 'mods.write', 'Изменение каталога модов'),
  ('10000000-0000-4000-8000-000000000006', 'mods.archive', 'Архивация модов'),
  ('10000000-0000-4000-8000-000000000007', 'builds.read', 'Просмотр сборок'),
  ('10000000-0000-4000-8000-000000000008', 'builds.write', 'Изменение черновиков сборок'),
  ('10000000-0000-4000-8000-000000000009', 'builds.publish', 'Публикация сборок'),
  ('10000000-0000-4000-8000-000000000010', 'builds.activate', 'Активация и откат сборок'),
  ('10000000-0000-4000-8000-000000000011', 'deployments.read', 'Просмотр развёртываний'),
  ('10000000-0000-4000-8000-000000000012', 'deployments.execute', 'Запуск развёртываний'),
  ('10000000-0000-4000-8000-000000000013', 'audit.read', 'Просмотр журнала аудита'),
  ('10000000-0000-4000-8000-000000000014', 'roles.read', 'Просмотр ролей'),
  ('10000000-0000-4000-8000-000000000015', 'roles.manage', 'Назначение ролей и разрешений')
ON CONFLICT ("key") DO UPDATE SET "description" = EXCLUDED."description";
