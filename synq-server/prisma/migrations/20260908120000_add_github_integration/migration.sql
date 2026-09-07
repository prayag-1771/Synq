-- CreateTable
CREATE TABLE "GitHubAccount" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "githubLogin" TEXT NOT NULL,
    "githubUserId" TEXT NOT NULL,
    "avatarUrl" TEXT,
    "accessToken" TEXT NOT NULL,
    "tokenType" TEXT NOT NULL DEFAULT 'pat',
    "scopes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GitHubAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Repository" (
    "id" TEXT NOT NULL,
    "owner" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "description" TEXT,
    "defaultBranch" TEXT NOT NULL DEFAULT 'main',
    "isPrivate" BOOLEAN NOT NULL DEFAULT false,
    "htmlUrl" TEXT NOT NULL,
    "language" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Repository_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChatRepository" (
    "id" TEXT NOT NULL,
    "chatId" TEXT NOT NULL,
    "repositoryId" TEXT NOT NULL,
    "linkedById" TEXT NOT NULL,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "webhookId" TEXT,
    "webhookSecret" TEXT,
    "notifyEvents" TEXT NOT NULL DEFAULT 'pull_request,push,issues,check_suite,release',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChatRepository_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GitHubEvent" (
    "id" TEXT NOT NULL,
    "repositoryId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "action" TEXT,
    "actorLogin" TEXT,
    "actorAvatar" TEXT,
    "title" TEXT,
    "summary" TEXT,
    "url" TEXT,
    "tone" TEXT NOT NULL DEFAULT 'neutral',
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GitHubEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "GitHubAccount_userId_key" ON "GitHubAccount"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Repository_fullName_key" ON "Repository"("fullName");

-- CreateIndex
CREATE INDEX "ChatRepository_repositoryId_idx" ON "ChatRepository"("repositoryId");

-- CreateIndex
CREATE UNIQUE INDEX "ChatRepository_chatId_repositoryId_key" ON "ChatRepository"("chatId", "repositoryId");

-- CreateIndex
CREATE INDEX "GitHubEvent_repositoryId_createdAt_idx" ON "GitHubEvent"("repositoryId", "createdAt");

-- AddForeignKey
ALTER TABLE "GitHubAccount" ADD CONSTRAINT "GitHubAccount_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatRepository" ADD CONSTRAINT "ChatRepository_chatId_fkey" FOREIGN KEY ("chatId") REFERENCES "Chat"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatRepository" ADD CONSTRAINT "ChatRepository_repositoryId_fkey" FOREIGN KEY ("repositoryId") REFERENCES "Repository"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatRepository" ADD CONSTRAINT "ChatRepository_linkedById_fkey" FOREIGN KEY ("linkedById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GitHubEvent" ADD CONSTRAINT "GitHubEvent_repositoryId_fkey" FOREIGN KEY ("repositoryId") REFERENCES "Repository"("id") ON DELETE CASCADE ON UPDATE CASCADE;
