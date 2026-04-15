/****** Object:  Schema [sales]    Script Date: 04/14/2026 ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO

/****** Object:  Table [sales].[Orders]    Script Date: 04/14/2026 ******/
CREATE TABLE [sales].[Orders](
	[OrderId] [int] IDENTITY(1,1) NOT NULL,
	[OrderNumber] [nvarchar](50) NOT NULL,
	[UserId] [int] NOT NULL,
	[OrderDate] [datetime2](7) NOT NULL,
	[Status] [nvarchar](50) NOT NULL,
	[SubTotal] [decimal](18, 2) NOT NULL,
	[TaxAmount] [decimal](18, 2) NOT NULL,
	[ShippingAmount] [decimal](18, 2) NOT NULL,
	[DiscountAmount] [decimal](18, 2) NOT NULL,
	[GrandTotal] [decimal](18, 2) NOT NULL,
	[CurrencyCode] [nvarchar](3) NOT NULL,
	[PaymentMethod] [nvarchar](50) NULL,
	[PaymentStatus] [nvarchar](50) NOT NULL,
	[ShippingMethod] [nvarchar](100) NULL,
	[TrackingNumber] [nvarchar](100) NULL,
	[Notes] [nvarchar](max) NULL,
	[CancelledDate] [datetime2](7) NULL,
	[CompletedDate] [datetime2](7) NULL,
	[CreatedDate] [datetime2](7) NOT NULL,
	[ModifiedDate] [datetime2](7) NULL,
 CONSTRAINT [PK_Orders] PRIMARY KEY CLUSTERED
(
	[OrderId] ASC
)
) ON [PRIMARY]
GO

/****** Object:  Table [sales].[OrderItems]    Script Date: 04/14/2026 ******/
CREATE TABLE [sales].[OrderItems](
	[OrderItemId] [int] IDENTITY(1,1) NOT NULL,
	[OrderId] [int] NOT NULL,
	[ProductId] [int] NOT NULL,
	[VariantId] [int] NULL,
	[ProductName] [nvarchar](300) NOT NULL,
	[SKU] [nvarchar](50) NOT NULL,
	[Quantity] [int] NOT NULL,
	[UnitPrice] [decimal](18, 2) NOT NULL,
	[DiscountAmount] [decimal](18, 2) NOT NULL,
	[TaxAmount] [decimal](18, 2) NOT NULL,
	[LineTotal] [decimal](18, 2) NOT NULL,
 CONSTRAINT [PK_OrderItems] PRIMARY KEY CLUSTERED
(
	[OrderItemId] ASC
)
) ON [PRIMARY]
GO

/****** Object:  Table [sales].[ShippingAddresses]    Script Date: 04/14/2026 ******/
CREATE TABLE [sales].[ShippingAddresses](
	[AddressId] [int] IDENTITY(1,1) NOT NULL,
	[OrderId] [int] NOT NULL,
	[RecipientName] [nvarchar](200) NOT NULL,
	[Street1] [nvarchar](300) NOT NULL,
	[Street2] [nvarchar](300) NULL,
	[City] [nvarchar](100) NOT NULL,
	[State] [nvarchar](50) NOT NULL,
	[ZipCode] [nvarchar](20) NOT NULL,
	[Country] [nvarchar](100) NOT NULL,
	[PhoneNumber] [nvarchar](20) NULL,
 CONSTRAINT [PK_ShippingAddresses] PRIMARY KEY CLUSTERED
(
	[AddressId] ASC
)
) ON [PRIMARY]
GO

/****** Object:  Table [sales].[Payments]    Script Date: 04/14/2026 ******/
CREATE TABLE [sales].[Payments](
	[PaymentId] [int] IDENTITY(1,1) NOT NULL,
	[OrderId] [int] NOT NULL,
	[Amount] [decimal](18, 2) NOT NULL,
	[PaymentMethod] [nvarchar](50) NOT NULL,
	[TransactionId] [nvarchar](200) NULL,
	[Status] [nvarchar](50) NOT NULL,
	[ProcessedDate] [datetime2](7) NULL,
	[CreatedDate] [datetime2](7) NOT NULL,
 CONSTRAINT [PK_Payments] PRIMARY KEY CLUSTERED
(
	[PaymentId] ASC
)
) ON [PRIMARY]
GO

/****** Object:  Table [sales].[Coupons]    Script Date: 04/14/2026 ******/
CREATE TABLE [sales].[Coupons](
	[CouponId] [int] IDENTITY(1,1) NOT NULL,
	[CouponCode] [nvarchar](50) NOT NULL,
	[Description] [nvarchar](500) NULL,
	[DiscountType] [nvarchar](20) NOT NULL,
	[DiscountValue] [decimal](18, 2) NOT NULL,
	[MinimumOrderAmount] [decimal](18, 2) NULL,
	[MaxUsageCount] [int] NULL,
	[CurrentUsageCount] [int] NOT NULL,
	[StartDate] [datetime2](7) NOT NULL,
	[EndDate] [datetime2](7) NOT NULL,
	[IsActive] [bit] NOT NULL,
 CONSTRAINT [PK_Coupons] PRIMARY KEY CLUSTERED
(
	[CouponId] ASC
)
) ON [PRIMARY]
GO

/****** Object:  Table [sales].[OrderCoupons]    Script Date: 04/14/2026 ******/
CREATE TABLE [sales].[OrderCoupons](
	[OrderCouponId] [int] IDENTITY(1,1) NOT NULL,
	[OrderId] [int] NOT NULL,
	[CouponId] [int] NOT NULL,
	[DiscountApplied] [decimal](18, 2) NOT NULL,
 CONSTRAINT [PK_OrderCoupons] PRIMARY KEY CLUSTERED
(
	[OrderCouponId] ASC
)
) ON [PRIMARY]
GO

/****** Object:  Table [sales].[Returns]    Script Date: 04/14/2026 ******/
CREATE TABLE [sales].[Returns](
	[ReturnId] [int] IDENTITY(1,1) NOT NULL,
	[OrderId] [int] NOT NULL,
	[OrderItemId] [int] NOT NULL,
	[Reason] [nvarchar](500) NOT NULL,
	[Status] [nvarchar](50) NOT NULL,
	[RefundAmount] [decimal](18, 2) NULL,
	[RequestedDate] [datetime2](7) NOT NULL,
	[ProcessedDate] [datetime2](7) NULL,
 CONSTRAINT [PK_Returns] PRIMARY KEY CLUSTERED
(
	[ReturnId] ASC
)
) ON [PRIMARY]
GO

/****** Object:  Index [IX_Orders_UserId]    Script Date: 04/14/2026 ******/
CREATE NONCLUSTERED INDEX [IX_Orders_UserId] ON [sales].[Orders]
(
	[UserId] ASC
)
GO

/****** Object:  Index [IX_Orders_OrderNumber]    Script Date: 04/14/2026 ******/
CREATE UNIQUE NONCLUSTERED INDEX [IX_Orders_OrderNumber] ON [sales].[Orders]
(
	[OrderNumber] ASC
)
GO

/****** Object:  Index [IX_Orders_Status]    Script Date: 04/14/2026 ******/
CREATE NONCLUSTERED INDEX [IX_Orders_Status] ON [sales].[Orders]
(
	[Status] ASC
)
GO

/****** Object:  Index [IX_OrderItems_OrderId]    Script Date: 04/14/2026 ******/
CREATE NONCLUSTERED INDEX [IX_OrderItems_OrderId] ON [sales].[OrderItems]
(
	[OrderId] ASC
)
GO

/****** Object:  Index [IX_Payments_OrderId]    Script Date: 04/14/2026 ******/
CREATE NONCLUSTERED INDEX [IX_Payments_OrderId] ON [sales].[Payments]
(
	[OrderId] ASC
)
GO

/****** Object:  Index [IX_Coupons_CouponCode]    Script Date: 04/14/2026 ******/
CREATE UNIQUE NONCLUSTERED INDEX [IX_Coupons_CouponCode] ON [sales].[Coupons]
(
	[CouponCode] ASC
)
GO

/****** Object:  View [sales].[vw_OrderSummary]    Script Date: 04/14/2026 ******/
CREATE VIEW [sales].[vw_OrderSummary] AS
SELECT o.OrderId, o.OrderNumber, o.UserId, u.Email, u.FirstName, u.LastName,
       o.OrderDate, o.Status, o.GrandTotal, o.PaymentStatus,
       o.ShippingMethod, o.TrackingNumber,
       (SELECT COUNT(*) FROM sales.OrderItems oi WHERE oi.OrderId = o.OrderId) AS ItemCount
FROM sales.Orders o
INNER JOIN auth.Users u ON o.UserId = u.UserId
GO

/****** Object:  UserDefinedFunction [sales].[fn_CalculateOrderTotal]    Script Date: 04/14/2026 ******/
CREATE FUNCTION [sales].[fn_CalculateOrderTotal]
(
	@OrderId INT
)
RETURNS DECIMAL(18,2)
AS
BEGIN
	DECLARE @Total DECIMAL(18,2)
	SELECT @Total = SUM(LineTotal) FROM sales.OrderItems WHERE OrderId = @OrderId
	RETURN ISNULL(@Total, 0)
END
GO

/****** Object:  UserDefinedFunction [sales].[fn_GetOrderStatus]    Script Date: 04/14/2026 ******/
CREATE FUNCTION [sales].[fn_GetOrderStatus]
(
	@OrderId INT
)
RETURNS NVARCHAR(50)
AS
BEGIN
	DECLARE @Status NVARCHAR(50)
	SELECT @Status = Status FROM sales.Orders WHERE OrderId = @OrderId
	RETURN @Status
END
GO

/****** Object:  StoredProcedure [sales].[sp_PlaceOrder]    Script Date: 04/14/2026 ******/
CREATE PROCEDURE [sales].[sp_PlaceOrder]
	@UserId INT,
	@CurrencyCode NVARCHAR(3) = 'USD',
	@ShippingMethod NVARCHAR(100) = NULL,
	@Notes NVARCHAR(MAX) = NULL
AS
BEGIN
	SET NOCOUNT ON
	DECLARE @OrderId INT
	INSERT INTO sales.Orders (OrderNumber, UserId, OrderDate, Status, SubTotal, TaxAmount, ShippingAmount, DiscountAmount, GrandTotal, CurrencyCode, PaymentStatus, ShippingMethod, Notes, CreatedDate)
	VALUES ('ORD-' + FORMAT(GETDATE(), 'yyyyMMddHHmmss'), @UserId, GETDATE(), 'Pending', 0, 0, 0, 0, 0, @CurrencyCode, 'Pending', @ShippingMethod, @Notes, GETDATE())
	SET @OrderId = SCOPE_IDENTITY()
	SELECT @OrderId AS OrderId
END
GO

/****** Object:  StoredProcedure [sales].[sp_CancelOrder]    Script Date: 04/14/2026 ******/
CREATE PROCEDURE [sales].[sp_CancelOrder]
	@OrderId INT,
	@Reason NVARCHAR(500)
AS
BEGIN
	SET NOCOUNT ON
	UPDATE sales.Orders SET Status = 'Cancelled', CancelledDate = GETDATE(), Notes = @Reason WHERE OrderId = @OrderId
END
GO

/****** Object:  StoredProcedure [sales].[sp_ProcessRefund]    Script Date: 04/14/2026 ******/
CREATE PROCEDURE [sales].[sp_ProcessRefund]
	@ReturnId INT,
	@RefundAmount DECIMAL(18,2)
AS
BEGIN
	SET NOCOUNT ON
	UPDATE sales.Returns SET Status = 'Refunded', RefundAmount = @RefundAmount, ProcessedDate = GETDATE()
	WHERE ReturnId = @ReturnId
END
GO
