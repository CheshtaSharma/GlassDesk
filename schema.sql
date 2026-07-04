-- Run this in SSMS against the database you want to use.
-- It creates the two tables the Flask app reads/writes.

IF NOT EXISTS (SELECT * FROM sys.databases WHERE name = 'GlassDesk')
BEGIN
    CREATE DATABASE GlassDesk;
END
GO

USE GlassDesk;
GO

IF OBJECT_ID('dbo.Documents', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.Documents (
        DocumentId   INT IDENTITY(1,1) PRIMARY KEY,
        FileName     NVARCHAR(255) NOT NULL,
        PageCount    INT NOT NULL,
        ChunkCount   INT NOT NULL,
        UploadedAt   DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
    );
END
GO

IF OBJECT_ID('dbo.Chunks', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.Chunks (
        ChunkId      INT IDENTITY(1,1) PRIMARY KEY,
        DocumentId   INT NOT NULL FOREIGN KEY REFERENCES dbo.Documents(DocumentId) ON DELETE CASCADE,
        ChunkLabel   NVARCHAR(20) NOT NULL,   -- e.g. 'c14', shown to the AI as the chunk id
        PageNumber   INT NOT NULL,
        ChunkText    NVARCHAR(MAX) NOT NULL
    );
    CREATE INDEX IX_Chunks_DocumentId ON dbo.Chunks(DocumentId);
END
GO



IF COL_LENGTH('dbo.Chunks', 'ChapterNumber') IS NULL
BEGIN
    ALTER TABLE dbo.Chunks ADD ChapterNumber INT NULL;
END
GO
 
IF COL_LENGTH('dbo.Chunks', 'ChapterTitle') IS NULL
BEGIN
    ALTER TABLE dbo.Chunks ADD ChapterTitle NVARCHAR(255) NULL;
END
GO
 
-- Optional: full text search makes search_chunks much faster on large PDFs.
-- If you have Full-Text Search installed, uncomment below.
-- IF NOT EXISTS (SELECT * FROM sys.fulltext_catalogs WHERE name = 'GlassDeskFTCatalog')
--     CREATE FULLTEXT CATALOG GlassDeskFTCatalog;
-- CREATE FULLTEXT INDEX ON dbo.Chunks(ChunkText)
--     KEY INDEX PK__Chunks__... -- replace with actual PK constraint name
--     ON GlassDeskFTCatalog;
SELECT @@SERVERNAME;
USE GlassDesk;
ALTER TABLE dbo.Chunks ADD Embedding NVARCHAR(MAX) NULL;