CREATE TYPE "public"."user_role" AS ENUM('rider', 'driver', 'admin', 'gov');--> statement-breakpoint
CREATE TYPE "public"."verification_status" AS ENUM('pending', 'verified', 'rejected', 'expired');--> statement-breakpoint
CREATE TYPE "public"."vehicle_type" AS ENUM('car', 'bus', 'tricycle', 'motorcycle', 'minivan');--> statement-breakpoint
CREATE TYPE "public"."ride_status" AS ENUM('active', 'completed', 'cancelled', 'sos');--> statement-breakpoint
CREATE TYPE "public"."sos_status" AS ENUM('active', 'acknowledged', 'resolved', 'cancelled', 'false_alarm');--> statement-breakpoint
CREATE TYPE "public"."sos_type" AS ENUM('panic', 'silent', 'crash', 'medical');--> statement-breakpoint
CREATE TABLE "drivers" (
	"id" varchar(32) PRIMARY KEY NOT NULL,
	"user_id" varchar(32) NOT NULL,
	"license_number" varchar(40),
	"license_status" "verification_status" DEFAULT 'pending' NOT NULL,
	"license_verified_at" timestamp with time zone,
	"license_provider" varchar(40),
	"license_provider_ref" varchar(128),
	"license_expires_at" timestamp with time zone,
	"background_check_status" "verification_status" DEFAULT 'pending' NOT NULL,
	"background_check_at" timestamp with time zone,
	"rating" integer DEFAULT 0 NOT NULL,
	"rating_count" integer DEFAULT 0 NOT NULL,
	"total_verified_trips" integer DEFAULT 0 NOT NULL,
	"is_online" boolean DEFAULT false NOT NULL,
	"last_seen_at" timestamp with time zone,
	"flag_count" integer DEFAULT 0 NOT NULL,
	"suspended_at" timestamp with time zone,
	"suspension_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "drivers_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE "emergency_contacts" (
	"id" varchar(32) PRIMARY KEY NOT NULL,
	"user_id" varchar(32) NOT NULL,
	"name" varchar(120) NOT NULL,
	"phone" varchar(20) NOT NULL,
	"relationship" varchar(40),
	"priority" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "otps" (
	"id" varchar(32) PRIMARY KEY NOT NULL,
	"phone" varchar(20) NOT NULL,
	"code_hash" text NOT NULL,
	"purpose" varchar(40) NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"consumed" boolean DEFAULT false NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "refresh_tokens" (
	"id" varchar(32) PRIMARY KEY NOT NULL,
	"user_id" varchar(32) NOT NULL,
	"token_hash" text NOT NULL,
	"user_agent" text,
	"ip" varchar(64),
	"revoked_at" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" varchar(32) PRIMARY KEY NOT NULL,
	"phone" varchar(20) NOT NULL,
	"email" varchar(255),
	"full_name" varchar(200),
	"photo_url" text,
	"role" "user_role" NOT NULL,
	"nin_hash" varchar(128),
	"nin_last4" varchar(4),
	"nin_status" "verification_status" DEFAULT 'pending' NOT NULL,
	"nin_verified_at" timestamp with time zone,
	"nin_provider" varchar(40),
	"nin_provider_ref" varchar(128),
	"sos_pin_hash" text,
	"is_blocked" boolean DEFAULT false NOT NULL,
	"blocked_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_login_at" timestamp with time zone,
	CONSTRAINT "users_phone_unique" UNIQUE("phone")
);
--> statement-breakpoint
CREATE TABLE "vehicles" (
	"id" varchar(32) PRIMARY KEY NOT NULL,
	"driver_id" varchar(32) NOT NULL,
	"type" "vehicle_type" NOT NULL,
	"brand" varchar(60) NOT NULL,
	"model" varchar(60) NOT NULL,
	"year" integer NOT NULL,
	"color" varchar(40) NOT NULL,
	"plate_number" varchar(20) NOT NULL,
	"qr_token" text NOT NULL,
	"qr_version" integer DEFAULT 1 NOT NULL,
	"registration_status" "verification_status" DEFAULT 'pending' NOT NULL,
	"photos" text[] DEFAULT ARRAY[]::text[] NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"revoked_at" timestamp with time zone,
	"revoked_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "vehicles_qr_token_unique" UNIQUE("qr_token")
);
--> statement-breakpoint
CREATE TABLE "reports" (
	"id" varchar(32) PRIMARY KEY NOT NULL,
	"reporter_id" varchar(32) NOT NULL,
	"target_type" varchar(20) NOT NULL,
	"target_id" varchar(32) NOT NULL,
	"ride_id" varchar(32),
	"reason" varchar(60) NOT NULL,
	"detail" text,
	"status" varchar(20) DEFAULT 'open' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ride_locations" (
	"id" varchar(32) PRIMARY KEY NOT NULL,
	"ride_id" varchar(32) NOT NULL,
	"lat" double precision NOT NULL,
	"lng" double precision NOT NULL,
	"accuracy_meters" double precision,
	"speed_mps" double precision,
	"source" varchar(20) DEFAULT 'socket' NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ride_ratings" (
	"id" varchar(32) PRIMARY KEY NOT NULL,
	"ride_id" varchar(32) NOT NULL,
	"rider_id" varchar(32) NOT NULL,
	"driver_id" varchar(32) NOT NULL,
	"stars" double precision NOT NULL,
	"comment" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ride_ratings_ride_id_unique" UNIQUE("ride_id")
);
--> statement-breakpoint
CREATE TABLE "ride_shares" (
	"id" varchar(32) PRIMARY KEY NOT NULL,
	"ride_id" varchar(32) NOT NULL,
	"contact_id" varchar(32) NOT NULL,
	"shared_at" timestamp with time zone DEFAULT now() NOT NULL,
	"unshared_at" timestamp with time zone,
	"watch_token" varchar(64) NOT NULL,
	"last_viewed_at" timestamp with time zone,
	"view_count" double precision DEFAULT 0 NOT NULL,
	CONSTRAINT "ride_shares_watch_token_unique" UNIQUE("watch_token")
);
--> statement-breakpoint
CREATE TABLE "rides" (
	"id" varchar(32) PRIMARY KEY NOT NULL,
	"rider_id" varchar(32) NOT NULL,
	"driver_id" varchar(32) NOT NULL,
	"vehicle_id" varchar(32) NOT NULL,
	"status" "ride_status" DEFAULT 'active' NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone,
	"last_lat" double precision,
	"last_lng" double precision,
	"last_ping_at" timestamp with time zone,
	"end_reason" varchar(40)
);
--> statement-breakpoint
CREATE TABLE "sos_events" (
	"id" varchar(32) PRIMARY KEY NOT NULL,
	"user_id" varchar(32) NOT NULL,
	"ride_id" varchar(32),
	"type" "sos_type" DEFAULT 'panic' NOT NULL,
	"status" "sos_status" DEFAULT 'active' NOT NULL,
	"triggered_lat" double precision NOT NULL,
	"triggered_lng" double precision NOT NULL,
	"notified" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"cancel_attempts" integer DEFAULT 0 NOT NULL,
	"triggered_at" timestamp with time zone DEFAULT now() NOT NULL,
	"acknowledged_at" timestamp with time zone,
	"resolved_at" timestamp with time zone,
	"resolution_note" text
);
--> statement-breakpoint
CREATE TABLE "audit_events" (
	"id" varchar(32) PRIMARY KEY NOT NULL,
	"actor_id" varchar(32),
	"actor_role" varchar(20),
	"action" varchar(80) NOT NULL,
	"target_type" varchar(40),
	"target_id" varchar(40),
	"before" jsonb,
	"after" jsonb,
	"correlation_id" varchar(64),
	"ip" varchar(64),
	"user_agent" text,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "drivers" ADD CONSTRAINT "drivers_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "emergency_contacts" ADD CONSTRAINT "emergency_contacts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_driver_id_drivers_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."drivers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_reporter_id_users_id_fk" FOREIGN KEY ("reporter_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_ride_id_rides_id_fk" FOREIGN KEY ("ride_id") REFERENCES "public"."rides"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ride_locations" ADD CONSTRAINT "ride_locations_ride_id_rides_id_fk" FOREIGN KEY ("ride_id") REFERENCES "public"."rides"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ride_ratings" ADD CONSTRAINT "ride_ratings_ride_id_rides_id_fk" FOREIGN KEY ("ride_id") REFERENCES "public"."rides"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ride_ratings" ADD CONSTRAINT "ride_ratings_rider_id_users_id_fk" FOREIGN KEY ("rider_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ride_ratings" ADD CONSTRAINT "ride_ratings_driver_id_users_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ride_shares" ADD CONSTRAINT "ride_shares_ride_id_rides_id_fk" FOREIGN KEY ("ride_id") REFERENCES "public"."rides"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ride_shares" ADD CONSTRAINT "ride_shares_contact_id_emergency_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."emergency_contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rides" ADD CONSTRAINT "rides_rider_id_users_id_fk" FOREIGN KEY ("rider_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rides" ADD CONSTRAINT "rides_driver_id_users_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rides" ADD CONSTRAINT "rides_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sos_events" ADD CONSTRAINT "sos_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sos_events" ADD CONSTRAINT "sos_events_ride_id_rides_id_fk" FOREIGN KEY ("ride_id") REFERENCES "public"."rides"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "drivers_online_idx" ON "drivers" USING btree ("is_online");--> statement-breakpoint
CREATE INDEX "drivers_rating_idx" ON "drivers" USING btree ("rating");--> statement-breakpoint
CREATE INDEX "emergency_contacts_user_idx" ON "emergency_contacts" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "otps_phone_idx" ON "otps" USING btree ("phone");--> statement-breakpoint
CREATE INDEX "refresh_tokens_user_idx" ON "refresh_tokens" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "users_phone_idx" ON "users" USING btree ("phone");--> statement-breakpoint
CREATE INDEX "users_role_idx" ON "users" USING btree ("role");--> statement-breakpoint
CREATE INDEX "vehicles_driver_idx" ON "vehicles" USING btree ("driver_id");--> statement-breakpoint
CREATE UNIQUE INDEX "vehicles_plate_uidx" ON "vehicles" USING btree ("plate_number");--> statement-breakpoint
CREATE UNIQUE INDEX "vehicles_qr_token_uidx" ON "vehicles" USING btree ("qr_token");--> statement-breakpoint
CREATE INDEX "vehicles_active_idx" ON "vehicles" USING btree ("is_active");--> statement-breakpoint
CREATE INDEX "reports_target_idx" ON "reports" USING btree ("target_type","target_id");--> statement-breakpoint
CREATE INDEX "reports_status_idx" ON "reports" USING btree ("status");--> statement-breakpoint
CREATE INDEX "ride_locations_ride_time_idx" ON "ride_locations" USING btree ("ride_id","recorded_at");--> statement-breakpoint
CREATE INDEX "ride_ratings_driver_idx" ON "ride_ratings" USING btree ("driver_id");--> statement-breakpoint
CREATE INDEX "ride_shares_ride_idx" ON "ride_shares" USING btree ("ride_id");--> statement-breakpoint
CREATE INDEX "ride_shares_watch_token_idx" ON "ride_shares" USING btree ("watch_token");--> statement-breakpoint
CREATE INDEX "rides_rider_idx" ON "rides" USING btree ("rider_id");--> statement-breakpoint
CREATE INDEX "rides_driver_idx" ON "rides" USING btree ("driver_id");--> statement-breakpoint
CREATE INDEX "rides_status_idx" ON "rides" USING btree ("status");--> statement-breakpoint
CREATE INDEX "sos_events_user_idx" ON "sos_events" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "sos_events_status_idx" ON "sos_events" USING btree ("status");--> statement-breakpoint
CREATE INDEX "sos_events_triggered_at_idx" ON "sos_events" USING btree ("triggered_at");--> statement-breakpoint
CREATE INDEX "audit_events_actor_idx" ON "audit_events" USING btree ("actor_id");--> statement-breakpoint
CREATE INDEX "audit_events_action_idx" ON "audit_events" USING btree ("action");--> statement-breakpoint
CREATE INDEX "audit_events_target_idx" ON "audit_events" USING btree ("target_type","target_id");--> statement-breakpoint
CREATE INDEX "audit_events_correlation_idx" ON "audit_events" USING btree ("correlation_id");--> statement-breakpoint
CREATE INDEX "audit_events_created_at_idx" ON "audit_events" USING btree ("created_at");