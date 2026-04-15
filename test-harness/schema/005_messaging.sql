/****** Object:  Schema [msg]    Script Date: 04/14/2026 ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO

/****** Object:  Table [msg].[Conversations]    Script Date: 04/14/2026 ******/
CREATE TABLE [msg].[Conversations](
	[ConversationId] [int] IDENTITY(1,1) NOT NULL,
	[Subject] [nvarchar](300) NULL,
	[ConversationType] [nvarchar](50) NOT NULL,
	[CreatedBy] [int] NOT NULL,
	[CreatedDate] [datetime2](7) NOT NULL,
	[LastMessageDate] [datetime2](7) NULL,
	[IsArchived] [bit] NOT NULL,
 CONSTRAINT [PK_Conversations] PRIMARY KEY CLUSTERED
(
	[ConversationId] ASC
)
) ON [PRIMARY]
GO

/****** Object:  Table [msg].[ConversationParticipants]    Script Date: 04/14/2026 ******/
CREATE TABLE [msg].[ConversationParticipants](
	[ParticipantId] [int] IDENTITY(1,1) NOT NULL,
	[ConversationId] [int] NOT NULL,
	[UserId] [int] NOT NULL,
	[JoinedDate] [datetime2](7) NOT NULL,
	[LeftDate] [datetime2](7) NULL,
	[IsAdmin] [bit] NOT NULL,
	[IsMuted] [bit] NOT NULL,
	[LastReadMessageId] [int] NULL,
 CONSTRAINT [PK_ConversationParticipants] PRIMARY KEY CLUSTERED
(
	[ParticipantId] ASC
)
) ON [PRIMARY]
GO

/****** Object:  Table [msg].[Messages]    Script Date: 04/14/2026 ******/
CREATE TABLE [msg].[Messages](
	[MessageId] [int] IDENTITY(1,1) NOT NULL,
	[ConversationId] [int] NOT NULL,
	[SenderId] [int] NOT NULL,
	[MessageText] [nvarchar](max) NOT NULL,
	[MessageType] [nvarchar](50) NOT NULL,
	[IsEdited] [bit] NOT NULL,
	[IsDeleted] [bit] NOT NULL,
	[ParentMessageId] [int] NULL,
	[SentDate] [datetime2](7) NOT NULL,
	[EditedDate] [datetime2](7) NULL,
 CONSTRAINT [PK_Messages] PRIMARY KEY CLUSTERED
(
	[MessageId] ASC
)
) ON [PRIMARY]
GO

/****** Object:  Table [msg].[Attachments]    Script Date: 04/14/2026 ******/
CREATE TABLE [msg].[Attachments](
	[AttachmentId] [int] IDENTITY(1,1) NOT NULL,
	[MessageId] [int] NOT NULL,
	[FileName] [nvarchar](300) NOT NULL,
	[FileSize] [bigint] NOT NULL,
	[ContentType] [nvarchar](100) NOT NULL,
	[StoragePath] [nvarchar](500) NOT NULL,
	[UploadedDate] [datetime2](7) NOT NULL,
 CONSTRAINT [PK_Attachments] PRIMARY KEY CLUSTERED
(
	[AttachmentId] ASC
)
) ON [PRIMARY]
GO

/****** Object:  Table [msg].[Notifications]    Script Date: 04/14/2026 ******/
CREATE TABLE [msg].[Notifications](
	[NotificationId] [int] IDENTITY(1,1) NOT NULL,
	[UserId] [int] NOT NULL,
	[Title] [nvarchar](200) NOT NULL,
	[Body] [nvarchar](max) NULL,
	[NotificationType] [nvarchar](50) NOT NULL,
	[ReferenceType] [nvarchar](100) NULL,
	[ReferenceId] [nvarchar](100) NULL,
	[IsRead] [bit] NOT NULL,
	[CreatedDate] [datetime2](7) NOT NULL,
	[ReadDate] [datetime2](7) NULL,
 CONSTRAINT [PK_Notifications] PRIMARY KEY CLUSTERED
(
	[NotificationId] ASC
)
) ON [PRIMARY]
GO

/****** Object:  Index [IX_Messages_ConversationId]    Script Date: 04/14/2026 ******/
CREATE NONCLUSTERED INDEX [IX_Messages_ConversationId] ON [msg].[Messages]
(
	[ConversationId] ASC,
	[SentDate] DESC
)
GO

/****** Object:  Index [IX_Notifications_UserId]    Script Date: 04/14/2026 ******/
CREATE NONCLUSTERED INDEX [IX_Notifications_UserId] ON [msg].[Notifications]
(
	[UserId] ASC,
	[IsRead] ASC
)
GO

/****** Object:  Index [IX_ConversationParticipants_UserId]    Script Date: 04/14/2026 ******/
CREATE NONCLUSTERED INDEX [IX_ConversationParticipants_UserId] ON [msg].[ConversationParticipants]
(
	[UserId] ASC
)
GO

/****** Object:  View [msg].[vw_UnreadMessages]    Script Date: 04/14/2026 ******/
CREATE VIEW [msg].[vw_UnreadMessages] AS
SELECT cp.UserId, c.ConversationId, c.Subject, COUNT(m.MessageId) AS UnreadCount
FROM msg.ConversationParticipants cp
INNER JOIN msg.Conversations c ON cp.ConversationId = c.ConversationId
INNER JOIN msg.Messages m ON c.ConversationId = m.ConversationId
WHERE m.MessageId > ISNULL(cp.LastReadMessageId, 0)
  AND m.SenderId <> cp.UserId
  AND m.IsDeleted = 0
  AND cp.LeftDate IS NULL
GROUP BY cp.UserId, c.ConversationId, c.Subject
GO

/****** Object:  UserDefinedFunction [msg].[fn_GetUnreadCount]    Script Date: 04/14/2026 ******/
CREATE FUNCTION [msg].[fn_GetUnreadCount]
(
	@UserId INT
)
RETURNS INT
AS
BEGIN
	DECLARE @Count INT
	SELECT @Count = COUNT(*)
	FROM msg.Messages m
	INNER JOIN msg.ConversationParticipants cp ON m.ConversationId = cp.ConversationId
	WHERE cp.UserId = @UserId AND m.MessageId > ISNULL(cp.LastReadMessageId, 0) AND m.SenderId <> @UserId AND m.IsDeleted = 0
	RETURN ISNULL(@Count, 0)
END
GO

/****** Object:  StoredProcedure [msg].[sp_SendMessage]    Script Date: 04/14/2026 ******/
CREATE PROCEDURE [msg].[sp_SendMessage]
	@ConversationId INT,
	@SenderId INT,
	@MessageText NVARCHAR(MAX),
	@MessageType NVARCHAR(50) = 'Text',
	@ParentMessageId INT = NULL
AS
BEGIN
	SET NOCOUNT ON
	INSERT INTO msg.Messages (ConversationId, SenderId, MessageText, MessageType, IsEdited, IsDeleted, ParentMessageId, SentDate)
	VALUES (@ConversationId, @SenderId, @MessageText, @MessageType, 0, 0, @ParentMessageId, GETDATE())
	UPDATE msg.Conversations SET LastMessageDate = GETDATE() WHERE ConversationId = @ConversationId
END
GO

/****** Object:  StoredProcedure [msg].[sp_MarkAsRead]    Script Date: 04/14/2026 ******/
CREATE PROCEDURE [msg].[sp_MarkAsRead]
	@ConversationId INT,
	@UserId INT
AS
BEGIN
	SET NOCOUNT ON
	DECLARE @MaxMessageId INT
	SELECT @MaxMessageId = MAX(MessageId) FROM msg.Messages WHERE ConversationId = @ConversationId
	UPDATE msg.ConversationParticipants SET LastReadMessageId = @MaxMessageId
	WHERE ConversationId = @ConversationId AND UserId = @UserId
END
GO
