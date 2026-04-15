-- ============================================
-- Test schema file (SSMS-style export)
-- SQL Server 2022
-- ============================================

SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO

CREATE TABLE [dbo].[Users](
	[Id] [int] IDENTITY(1,1) NOT NULL,
	[Email] [nvarchar](255) NOT NULL,
	[UserName] [nvarchar](100) NOT NULL,
	[FirstName] [nvarchar](100) NULL,
	[LastName] [nvarchar](100) NULL,
	[PasswordHash] [nvarchar](500) NOT NULL,
	[CreatedDate] [datetime2](7) NOT NULL,
	[IsActive] [bit] NOT NULL,
	[DepartmentId] [int] NULL,
 CONSTRAINT [PK_Users] PRIMARY KEY CLUSTERED
(
	[Id] ASC
)
)
GO

CREATE TABLE [dbo].[Departments](
	[Id] [int] IDENTITY(1,1) NOT NULL,
	[Name] [nvarchar](200) NOT NULL,
	[Code] [nvarchar](20) NOT NULL,
	[ManagerId] [int] NULL,
	[CreatedDate] [datetime2](7) NOT NULL,
	[IsActive] [bit] NOT NULL,
 CONSTRAINT [PK_Departments] PRIMARY KEY CLUSTERED
(
	[Id] ASC
)
)
GO

CREATE TABLE [dbo].[Orders](
	[Id] [int] IDENTITY(1,1) NOT NULL,
	[UserId] [int] NOT NULL,
	[OrderDate] [datetime2](7) NOT NULL,
	[TotalAmount] [decimal](18, 2) NOT NULL,
	[Status] [nvarchar](50) NOT NULL,
	[ShippingAddress] [nvarchar](500) NULL,
	[Notes] [nvarchar](max) NULL,
 CONSTRAINT [PK_Orders] PRIMARY KEY CLUSTERED
(
	[Id] ASC
)
)
GO

CREATE TABLE [dbo].[OrderItems](
	[Id] [int] IDENTITY(1,1) NOT NULL,
	[OrderId] [int] NOT NULL,
	[ProductId] [int] NOT NULL,
	[Quantity] [int] NOT NULL,
	[UnitPrice] [decimal](18, 2) NOT NULL,
	[Discount] [decimal](18, 2) NULL,
 CONSTRAINT [PK_OrderItems] PRIMARY KEY CLUSTERED
(
	[Id] ASC
)
)
GO

CREATE TABLE [dbo].[Products](
	[Id] [int] IDENTITY(1,1) NOT NULL,
	[Name] [nvarchar](200) NOT NULL,
	[SKU] [nvarchar](50) NOT NULL,
	[Price] [decimal](18, 2) NOT NULL,
	[CategoryId] [int] NULL,
	[IsActive] [bit] NOT NULL,
 CONSTRAINT [PK_Products] PRIMARY KEY CLUSTERED
(
	[Id] ASC
)
)
GO

CREATE VIEW [dbo].[vw_ActiveUsers] AS
SELECT u.Id, u.Email, u.UserName, u.FirstName, u.LastName, d.Name AS DepartmentName
FROM dbo.Users u
LEFT JOIN dbo.Departments d ON u.DepartmentId = d.Id
WHERE u.IsActive = 1
GO

CREATE NONCLUSTERED INDEX [IX_Users_Email] ON [dbo].[Users]
(
	[Email] ASC
)
GO

CREATE NONCLUSTERED INDEX [IX_Users_DepartmentId] ON [dbo].[Users]
(
	[DepartmentId] ASC
)
GO

CREATE NONCLUSTERED INDEX [IX_Orders_UserId] ON [dbo].[Orders]
(
	[UserId] ASC
)
GO

CREATE FUNCTION [dbo].[fn_GetUserFullName]
(
	@UserId INT
)
RETURNS NVARCHAR(200)
AS
BEGIN
	DECLARE @FullName NVARCHAR(200)
	SELECT @FullName = FirstName + ' ' + LastName FROM dbo.Users WHERE Id = @UserId
	RETURN @FullName
END
GO

CREATE FUNCTION [dbo].[fn_GetOrderTotal]
(
	@OrderId INT
)
RETURNS DECIMAL(18,2)
AS
BEGIN
	DECLARE @Total DECIMAL(18,2)
	SELECT @Total = SUM(Quantity * UnitPrice) FROM dbo.OrderItems WHERE OrderId = @OrderId
	RETURN @Total
END
GO

CREATE PROCEDURE [dbo].[sp_GetUserOrders]
	@UserId INT,
	@Status NVARCHAR(50) = NULL
AS
BEGIN
	SELECT o.Id, o.OrderDate, o.TotalAmount, o.Status
	FROM dbo.Orders o
	WHERE o.UserId = @UserId
	AND (@Status IS NULL OR o.Status = @Status)
END
GO
