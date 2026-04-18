CREATE SCHEMA IF NOT EXISTS "system";
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "system"."account" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp,
	"refresh_token_expires_at" timestamp,
	"scope" text,
	"password" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "system"."invitation" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"email" text NOT NULL,
	"role" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"inviter_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "system"."member" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"user_id" text NOT NULL,
	"role" text DEFAULT 'member' NOT NULL,
	"created_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "system"."organization" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"logo" text,
	"created_at" timestamp NOT NULL,
	"metadata" text,
	CONSTRAINT "organization_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "system"."session" (
	"id" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" text NOT NULL,
	"active_organization_id" text,
	CONSTRAINT "session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "system"."user" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "system"."verification" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint ALTER TABLE "system"."account" DROP CONSTRAINT IF EXISTS "account_user_id_user_id_fk";--> statement-breakpoint
ALTER TABLE "system"."account" ADD CONSTRAINT "account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "system"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint ALTER TABLE "system"."invitation" DROP CONSTRAINT IF EXISTS "invitation_organization_id_organization_id_fk";--> statement-breakpoint
ALTER TABLE "system"."invitation" ADD CONSTRAINT "invitation_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "system"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint ALTER TABLE "system"."invitation" DROP CONSTRAINT IF EXISTS "invitation_inviter_id_user_id_fk";--> statement-breakpoint
ALTER TABLE "system"."invitation" ADD CONSTRAINT "invitation_inviter_id_user_id_fk" FOREIGN KEY ("inviter_id") REFERENCES "system"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint ALTER TABLE "system"."member" DROP CONSTRAINT IF EXISTS "member_organization_id_organization_id_fk";--> statement-breakpoint
ALTER TABLE "system"."member" ADD CONSTRAINT "member_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "system"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint ALTER TABLE "system"."member" DROP CONSTRAINT IF EXISTS "member_user_id_user_id_fk";--> statement-breakpoint
ALTER TABLE "system"."member" ADD CONSTRAINT "member_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "system"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint ALTER TABLE "system"."session" DROP CONSTRAINT IF EXISTS "session_user_id_user_id_fk";--> statement-breakpoint
ALTER TABLE "system"."session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "system"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "account_userId_idx" ON "system"."account" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "invitation_organizationId_idx" ON "system"."invitation" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "invitation_email_idx" ON "system"."invitation" USING btree ("email");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "member_organizationId_idx" ON "system"."member" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "member_userId_idx" ON "system"."member" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "organization_slug_uidx" ON "system"."organization" USING btree ("slug");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "session_userId_idx" ON "system"."session" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "verification_identifier_idx" ON "system"."verification" USING btree ("identifier");