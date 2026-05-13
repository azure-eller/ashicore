import {
  index,
  integer,
  pgPolicy,
  pgSchema,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const attachmentsSchema = pgSchema("attachments");

export const attachmentFiles = attachmentsSchema
  .table(
    "files",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      organizationId: text("organization_id").notNull(),
      ownerType: varchar("owner_type", { length: 50 }).notNull(),
      ownerId: uuid("owner_id").notNull(),
      storageKey: text("storage_key").notNull(),
      blobUrl: text("blob_url").notNull(),
      filename: text("filename").notNull(),
      contentType: varchar("content_type", { length: 255 }).notNull(),
      sizeBytes: integer("size_bytes").notNull(),
      uploadedByUserId: text("uploaded_by_user_id"),
      uploadedByName: text("uploaded_by_name"),
      deletedAt: timestamp("deleted_at", { withTimezone: true }),
      createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
      updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    },
    (table) => [
      index("attachment_files_org_owner_idx").on(
        table.organizationId,
        table.ownerType,
        table.ownerId
      ),
      index("attachment_files_active_idx")
        .on(table.organizationId, table.ownerType, table.ownerId)
        .where(sql`deleted_at IS NULL`),
      uniqueIndex("attachment_files_storage_key_uidx").on(table.storageKey),
      pgPolicy("attachment_files_org_isolation", {
        for: "all",
        to: "public",
        using: sql`organization_id = current_setting('app.current_org_id', true)`,
        withCheck: sql`organization_id = current_setting('app.current_org_id', true)`,
      }),
    ]
  )
  .enableRLS();
