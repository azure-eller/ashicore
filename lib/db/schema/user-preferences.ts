import { text, timestamp } from "drizzle-orm/pg-core";
import { systemSchema, user } from "./auth";

export const userPreferences = systemSchema.table("user_preferences", {
  userId: text("user_id")
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  readability: text("readability").notNull().default("default"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at")
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});
