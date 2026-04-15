/****** Object:  Schema [auth]    Script Date: 04/14/2026 ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO

/****** Object:  Table [auth].[Users]    Script Date: 04/14/2026 ******/
CREATE TABLE [auth].[Users](
	[UserId] [int] IDENTITY(1,1) NOT NULL,
	[Email] [nvarchar](255) NOT NULL,
	[UserName] [nvarchar](100) NOT NULL,
	[PasswordHash] [nvarchar](500) NOT NULL,
	[FirstName] [nvarchar](100) NULL,
	[LastName] [nvarchar](100) NULL,
	[PhoneNumber] [nvarchar](20) NULL,
	[AvatarUrl] [nvarchar](500) NULL,
	[IsActive] [bit] NOT NULL,
	[IsLocked] [bit] NOT NULL,
	[FailedLoginAttempts] [int] NOT NULL,
	[LastLoginDate] [datetime2](7) NULL,
	[CreatedDate] [datetime2](7) NOT NULL,
	[ModifiedDate] [datetime2](7) NULL,
	[CreatedBy] [int] NULL,
 CONSTRAINT [PK_Users] PRIMARY KEY CLUSTERED
(
	[UserId] ASC
)WITH (PAD_INDEX = OFF) ON [PRIMARY]
) ON [PRIMARY]
GO

/****** Object:  Table [auth].[Roles]    Script Date: 04/14/2026 ******/
CREATE TABLE [auth].[Roles](
	[RoleId] [int] IDENTITY(1,1) NOT NULL,
	[RoleName] [nvarchar](100) NOT NULL,
	[Description] [nvarchar](500) NULL,
	[IsSystem] [bit] NOT NULL,
	[CreatedDate] [datetime2](7) NOT NULL,
 CONSTRAINT [PK_Roles] PRIMARY KEY CLUSTERED
(
	[RoleId] ASC
)
) ON [PRIMARY]
GO

/****** Object:  Table [auth].[UserRoles]    Script Date: 04/14/2026 ******/
CREATE TABLE [auth].[UserRoles](
	[UserRoleId] [int] IDENTITY(1,1) NOT NULL,
	[UserId] [int] NOT NULL,
	[RoleId] [int] NOT NULL,
	[AssignedDate] [datetime2](7) NOT NULL,
	[AssignedBy] [int] NULL,
 CONSTRAINT [PK_UserRoles] PRIMARY KEY CLUSTERED
(
	[UserRoleId] ASC
)
) ON [PRIMARY]
GO

/****** Object:  Table [auth].[Permissions]    Script Date: 04/14/2026 ******/
CREATE TABLE [auth].[Permissions](
	[PermissionId] [int] IDENTITY(1,1) NOT NULL,
	[PermissionName] [nvarchar](200) NOT NULL,
	[Resource] [nvarchar](200) NOT NULL,
	[Action] [nvarchar](50) NOT NULL,
	[Description] [nvarchar](500) NULL,
 CONSTRAINT [PK_Permissions] PRIMARY KEY CLUSTERED
(
	[PermissionId] ASC
)
) ON [PRIMARY]
GO

/****** Object:  Table [auth].[RolePermissions]    Script Date: 04/14/2026 ******/
CREATE TABLE [auth].[RolePermissions](
	[RolePermissionId] [int] IDENTITY(1,1) NOT NULL,
	[RoleId] [int] NOT NULL,
	[PermissionId] [int] NOT NULL,
 CONSTRAINT [PK_RolePermissions] PRIMARY KEY CLUSTERED
(
	[RolePermissionId] ASC
)
) ON [PRIMARY]
GO

/****** Object:  Table [auth].[AuditLog]    Script Date: 04/14/2026 ******/
CREATE TABLE [auth].[AuditLog](
	[AuditId] [bigint] IDENTITY(1,1) NOT NULL,
	[UserId] [int] NULL,
	[Action] [nvarchar](100) NOT NULL,
	[EntityType] [nvarchar](100) NOT NULL,
	[EntityId] [nvarchar](100) NULL,
	[OldValues] [nvarchar](max) NULL,
	[NewValues] [nvarchar](max) NULL,
	[IpAddress] [nvarchar](45) NULL,
	[UserAgent] [nvarchar](500) NULL,
	[Timestamp] [datetime2](7) NOT NULL,
 CONSTRAINT [PK_AuditLog] PRIMARY KEY CLUSTERED
(
	[AuditId] ASC
)
) ON [PRIMARY]
GO

/****** Object:  Table [auth].[Sessions]    Script Date: 04/14/2026 ******/
CREATE TABLE [auth].[Sessions](
	[SessionId] [uniqueidentifier] NOT NULL,
	[UserId] [int] NOT NULL,
	[Token] [nvarchar](500) NOT NULL,
	[IpAddress] [nvarchar](45) NULL,
	[UserAgent] [nvarchar](500) NULL,
	[ExpiresAt] [datetime2](7) NOT NULL,
	[CreatedAt] [datetime2](7) NOT NULL,
	[IsRevoked] [bit] NOT NULL,
 CONSTRAINT [PK_Sessions] PRIMARY KEY CLUSTERED
(
	[SessionId] ASC
)
) ON [PRIMARY]
GO

/****** Object:  Index [IX_Users_Email]    Script Date: 04/14/2026 ******/
CREATE UNIQUE NONCLUSTERED INDEX [IX_Users_Email] ON [auth].[Users]
(
	[Email] ASC
)
GO

/****** Object:  Index [IX_Users_UserName]    Script Date: 04/14/2026 ******/
CREATE UNIQUE NONCLUSTERED INDEX [IX_Users_UserName] ON [auth].[Users]
(
	[UserName] ASC
)
GO

/****** Object:  Index [IX_UserRoles_UserId]    Script Date: 04/14/2026 ******/
CREATE NONCLUSTERED INDEX [IX_UserRoles_UserId] ON [auth].[UserRoles]
(
	[UserId] ASC
)
GO

/****** Object:  Index [IX_AuditLog_UserId_Timestamp]    Script Date: 04/14/2026 ******/
CREATE NONCLUSTERED INDEX [IX_AuditLog_UserId_Timestamp] ON [auth].[AuditLog]
(
	[UserId] ASC,
	[Timestamp] DESC
)
GO

/****** Object:  Index [IX_Sessions_UserId]    Script Date: 04/14/2026 ******/
CREATE NONCLUSTERED INDEX [IX_Sessions_UserId] ON [auth].[Sessions]
(
	[UserId] ASC
)
GO

/****** Object:  View [auth].[vw_UserDetails]    Script Date: 04/14/2026 ******/
CREATE VIEW [auth].[vw_UserDetails] AS
SELECT u.UserId, u.Email, u.UserName, u.FirstName, u.LastName,
       u.PhoneNumber, u.IsActive, u.LastLoginDate, u.CreatedDate,
       r.RoleName
FROM auth.Users u
LEFT JOIN auth.UserRoles ur ON u.UserId = ur.UserId
LEFT JOIN auth.Roles r ON ur.RoleId = r.RoleId
GO

/****** Object:  View [auth].[vw_ActiveSessions]    Script Date: 04/14/2026 ******/
CREATE VIEW [auth].[vw_ActiveSessions] AS
SELECT s.SessionId, s.UserId, u.Email, u.UserName,
       s.IpAddress, s.CreatedAt, s.ExpiresAt
FROM auth.Sessions s
INNER JOIN auth.Users u ON s.UserId = u.UserId
WHERE s.IsRevoked = 0 AND s.ExpiresAt > GETDATE()
GO

/****** Object:  UserDefinedFunction [auth].[fn_GetUserFullName]    Script Date: 04/14/2026 ******/
CREATE FUNCTION [auth].[fn_GetUserFullName]
(
	@UserId INT
)
RETURNS NVARCHAR(200)
AS
BEGIN
	DECLARE @FullName NVARCHAR(200)
	SELECT @FullName = ISNULL(FirstName, '') + ' ' + ISNULL(LastName, '')
	FROM auth.Users WHERE UserId = @UserId
	RETURN LTRIM(RTRIM(@FullName))
END
GO

/****** Object:  UserDefinedFunction [auth].[fn_HasPermission]    Script Date: 04/14/2026 ******/
CREATE FUNCTION [auth].[fn_HasPermission]
(
	@UserId INT,
	@Resource NVARCHAR(200),
	@Action NVARCHAR(50)
)
RETURNS BIT
AS
BEGIN
	DECLARE @HasPerm BIT = 0
	IF EXISTS (
		SELECT 1 FROM auth.UserRoles ur
		INNER JOIN auth.RolePermissions rp ON ur.RoleId = rp.RoleId
		INNER JOIN auth.Permissions p ON rp.PermissionId = p.PermissionId
		WHERE ur.UserId = @UserId AND p.Resource = @Resource AND p.Action = @Action
	)
		SET @HasPerm = 1
	RETURN @HasPerm
END
GO

/****** Object:  StoredProcedure [auth].[sp_AuthenticateUser]    Script Date: 04/14/2026 ******/
CREATE PROCEDURE [auth].[sp_AuthenticateUser]
	@Email NVARCHAR(255),
	@PasswordHash NVARCHAR(500)
AS
BEGIN
	SET NOCOUNT ON
	SELECT UserId, Email, UserName, FirstName, LastName
	FROM auth.Users
	WHERE Email = @Email AND PasswordHash = @PasswordHash AND IsActive = 1 AND IsLocked = 0
END
GO

/****** Object:  StoredProcedure [auth].[sp_CreateSession]    Script Date: 04/14/2026 ******/
CREATE PROCEDURE [auth].[sp_CreateSession]
	@UserId INT,
	@Token NVARCHAR(500),
	@IpAddress NVARCHAR(45),
	@UserAgent NVARCHAR(500),
	@ExpiresAt DATETIME2(7)
AS
BEGIN
	SET NOCOUNT ON
	INSERT INTO auth.Sessions (SessionId, UserId, Token, IpAddress, UserAgent, ExpiresAt, CreatedAt, IsRevoked)
	VALUES (NEWID(), @UserId, @Token, @IpAddress, @UserAgent, @ExpiresAt, GETDATE(), 0)
END
GO

/****** Object:  StoredProcedure [auth].[sp_RevokeSession]    Script Date: 04/14/2026 ******/
CREATE PROCEDURE [auth].[sp_RevokeSession]
	@SessionId UNIQUEIDENTIFIER
AS
BEGIN
	SET NOCOUNT ON
	UPDATE auth.Sessions SET IsRevoked = 1 WHERE SessionId = @SessionId
END
GO
