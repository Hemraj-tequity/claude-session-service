-- CreateEnum
CREATE TYPE "SessionStatus" AS ENUM ('running', 'stopped', 'error');

-- CreateEnum
CREATE TYPE "HistoryRole" AS ENUM ('user', 'assistant');

-- CreateTable
CREATE TABLE "sessions" (
    "session_id" UUID NOT NULL,
    "status" "SessionStatus" NOT NULL DEFAULT 'running',
    "sdk_started" BOOLEAN NOT NULL DEFAULT false,
    "last_activity_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("session_id")
);

-- CreateTable
CREATE TABLE "session_history" (
    "id" SERIAL NOT NULL,
    "session_id" UUID NOT NULL,
    "role" "HistoryRole" NOT NULL,
    "content" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "session_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "session_transcripts" (
    "id" SERIAL NOT NULL,
    "session_id" UUID NOT NULL,
    "subpath" TEXT NOT NULL DEFAULT 'root',
    "sequence" INTEGER NOT NULL,
    "event_type" TEXT NOT NULL,
    "entry" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "session_transcripts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "session_history_session_id_idx" ON "session_history"("session_id");

-- CreateIndex
CREATE INDEX "session_transcripts_session_id_idx" ON "session_transcripts"("session_id");

-- CreateIndex
CREATE INDEX "session_transcripts_session_id_sequence_idx" ON "session_transcripts"("session_id", "sequence");

-- AddForeignKey
ALTER TABLE "session_history" ADD CONSTRAINT "session_history_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "sessions"("session_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "session_transcripts" ADD CONSTRAINT "session_transcripts_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "sessions"("session_id") ON DELETE RESTRICT ON UPDATE CASCADE;
