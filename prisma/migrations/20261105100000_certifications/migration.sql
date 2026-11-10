-- CreateTable
CREATE TABLE "Certification" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT '',
    "issuer" TEXT NOT NULL DEFAULT '',
    "issuedOn" TEXT NOT NULL DEFAULT '',
    "expiresOn" TEXT NOT NULL DEFAULT '',
    "noExpiry" BOOLEAN NOT NULL DEFAULT false,
    "credentialId" TEXT NOT NULL DEFAULT '',
    "url" TEXT NOT NULL DEFAULT '',
    "onResumes" BOOLEAN NOT NULL DEFAULT true,
    "sort" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Certification_pkey" PRIMARY KEY ("id")
);

