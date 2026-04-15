/****** Object:  Schema [catalog]    Script Date: 04/14/2026 ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO

/****** Object:  Table [catalog].[Categories]    Script Date: 04/14/2026 ******/
CREATE TABLE [catalog].[Categories](
	[CategoryId] [int] IDENTITY(1,1) NOT NULL,
	[CategoryName] [nvarchar](200) NOT NULL,
	[ParentCategoryId] [int] NULL,
	[Slug] [nvarchar](200) NOT NULL,
	[Description] [nvarchar](max) NULL,
	[ImageUrl] [nvarchar](500) NULL,
	[SortOrder] [int] NOT NULL,
	[IsActive] [bit] NOT NULL,
	[CreatedDate] [datetime2](7) NOT NULL,
 CONSTRAINT [PK_Categories] PRIMARY KEY CLUSTERED
(
	[CategoryId] ASC
)
) ON [PRIMARY]
GO

/****** Object:  Table [catalog].[Products]    Script Date: 04/14/2026 ******/
CREATE TABLE [catalog].[Products](
	[ProductId] [int] IDENTITY(1,1) NOT NULL,
	[SKU] [nvarchar](50) NOT NULL,
	[ProductName] [nvarchar](300) NOT NULL,
	[Description] [nvarchar](max) NULL,
	[ShortDescription] [nvarchar](500) NULL,
	[CategoryId] [int] NOT NULL,
	[BrandId] [int] NULL,
	[BasePrice] [decimal](18, 2) NOT NULL,
	[SalePrice] [decimal](18, 2) NULL,
	[CostPrice] [decimal](18, 2) NULL,
	[Weight] [decimal](10, 2) NULL,
	[Length] [decimal](10, 2) NULL,
	[Width] [decimal](10, 2) NULL,
	[Height] [decimal](10, 2) NULL,
	[ImageUrl] [nvarchar](500) NULL,
	[IsActive] [bit] NOT NULL,
	[IsFeatured] [bit] NOT NULL,
	[TaxCategoryId] [int] NULL,
	[CreatedDate] [datetime2](7) NOT NULL,
	[ModifiedDate] [datetime2](7) NULL,
 CONSTRAINT [PK_Products] PRIMARY KEY CLUSTERED
(
	[ProductId] ASC
)
) ON [PRIMARY]
GO

/****** Object:  Table [catalog].[Brands]    Script Date: 04/14/2026 ******/
CREATE TABLE [catalog].[Brands](
	[BrandId] [int] IDENTITY(1,1) NOT NULL,
	[BrandName] [nvarchar](200) NOT NULL,
	[LogoUrl] [nvarchar](500) NULL,
	[WebsiteUrl] [nvarchar](500) NULL,
	[IsActive] [bit] NOT NULL,
 CONSTRAINT [PK_Brands] PRIMARY KEY CLUSTERED
(
	[BrandId] ASC
)
) ON [PRIMARY]
GO

/****** Object:  Table [catalog].[ProductVariants]    Script Date: 04/14/2026 ******/
CREATE TABLE [catalog].[ProductVariants](
	[VariantId] [int] IDENTITY(1,1) NOT NULL,
	[ProductId] [int] NOT NULL,
	[VariantName] [nvarchar](200) NOT NULL,
	[SKU] [nvarchar](50) NOT NULL,
	[PriceAdjustment] [decimal](18, 2) NOT NULL,
	[StockQuantity] [int] NOT NULL,
	[IsActive] [bit] NOT NULL,
 CONSTRAINT [PK_ProductVariants] PRIMARY KEY CLUSTERED
(
	[VariantId] ASC
)
) ON [PRIMARY]
GO

/****** Object:  Table [catalog].[ProductImages]    Script Date: 04/14/2026 ******/
CREATE TABLE [catalog].[ProductImages](
	[ImageId] [int] IDENTITY(1,1) NOT NULL,
	[ProductId] [int] NOT NULL,
	[ImageUrl] [nvarchar](500) NOT NULL,
	[AltText] [nvarchar](200) NULL,
	[SortOrder] [int] NOT NULL,
	[IsPrimary] [bit] NOT NULL,
 CONSTRAINT [PK_ProductImages] PRIMARY KEY CLUSTERED
(
	[ImageId] ASC
)
) ON [PRIMARY]
GO

/****** Object:  Table [catalog].[ProductTags]    Script Date: 04/14/2026 ******/
CREATE TABLE [catalog].[ProductTags](
	[TagId] [int] IDENTITY(1,1) NOT NULL,
	[ProductId] [int] NOT NULL,
	[TagName] [nvarchar](100) NOT NULL,
 CONSTRAINT [PK_ProductTags] PRIMARY KEY CLUSTERED
(
	[TagId] ASC
)
) ON [PRIMARY]
GO

/****** Object:  Table [catalog].[ProductReviews]    Script Date: 04/14/2026 ******/
CREATE TABLE [catalog].[ProductReviews](
	[ReviewId] [int] IDENTITY(1,1) NOT NULL,
	[ProductId] [int] NOT NULL,
	[UserId] [int] NOT NULL,
	[Rating] [int] NOT NULL,
	[Title] [nvarchar](200) NULL,
	[ReviewText] [nvarchar](max) NULL,
	[IsVerified] [bit] NOT NULL,
	[IsApproved] [bit] NOT NULL,
	[CreatedDate] [datetime2](7) NOT NULL,
 CONSTRAINT [PK_ProductReviews] PRIMARY KEY CLUSTERED
(
	[ReviewId] ASC
)
) ON [PRIMARY]
GO

/****** Object:  Table [catalog].[Inventory]    Script Date: 04/14/2026 ******/
CREATE TABLE [catalog].[Inventory](
	[InventoryId] [int] IDENTITY(1,1) NOT NULL,
	[ProductId] [int] NOT NULL,
	[VariantId] [int] NULL,
	[WarehouseId] [int] NOT NULL,
	[QuantityOnHand] [int] NOT NULL,
	[QuantityReserved] [int] NOT NULL,
	[ReorderLevel] [int] NOT NULL,
	[ReorderQuantity] [int] NOT NULL,
	[LastRestockedDate] [datetime2](7) NULL,
 CONSTRAINT [PK_Inventory] PRIMARY KEY CLUSTERED
(
	[InventoryId] ASC
)
) ON [PRIMARY]
GO

/****** Object:  Table [catalog].[Warehouses]    Script Date: 04/14/2026 ******/
CREATE TABLE [catalog].[Warehouses](
	[WarehouseId] [int] IDENTITY(1,1) NOT NULL,
	[WarehouseName] [nvarchar](200) NOT NULL,
	[Address] [nvarchar](500) NOT NULL,
	[City] [nvarchar](100) NOT NULL,
	[State] [nvarchar](50) NOT NULL,
	[ZipCode] [nvarchar](20) NOT NULL,
	[IsActive] [bit] NOT NULL,
 CONSTRAINT [PK_Warehouses] PRIMARY KEY CLUSTERED
(
	[WarehouseId] ASC
)
) ON [PRIMARY]
GO

/****** Object:  Index [IX_Products_SKU]    Script Date: 04/14/2026 ******/
CREATE UNIQUE NONCLUSTERED INDEX [IX_Products_SKU] ON [catalog].[Products]
(
	[SKU] ASC
)
GO

/****** Object:  Index [IX_Products_CategoryId]    Script Date: 04/14/2026 ******/
CREATE NONCLUSTERED INDEX [IX_Products_CategoryId] ON [catalog].[Products]
(
	[CategoryId] ASC
)
GO

/****** Object:  Index [IX_Products_BrandId]    Script Date: 04/14/2026 ******/
CREATE NONCLUSTERED INDEX [IX_Products_BrandId] ON [catalog].[Products]
(
	[BrandId] ASC
)
GO

/****** Object:  Index [IX_ProductVariants_ProductId]    Script Date: 04/14/2026 ******/
CREATE NONCLUSTERED INDEX [IX_ProductVariants_ProductId] ON [catalog].[ProductVariants]
(
	[ProductId] ASC
)
GO

/****** Object:  Index [IX_Inventory_ProductId_WarehouseId]    Script Date: 04/14/2026 ******/
CREATE UNIQUE NONCLUSTERED INDEX [IX_Inventory_ProductId_WarehouseId] ON [catalog].[Inventory]
(
	[ProductId] ASC,
	[WarehouseId] ASC
)
GO

/****** Object:  Index [IX_ProductReviews_ProductId]    Script Date: 04/14/2026 ******/
CREATE NONCLUSTERED INDEX [IX_ProductReviews_ProductId] ON [catalog].[ProductReviews]
(
	[ProductId] ASC
)
GO

/****** Object:  View [catalog].[vw_ProductCatalog]    Script Date: 04/14/2026 ******/
CREATE VIEW [catalog].[vw_ProductCatalog] AS
SELECT p.ProductId, p.SKU, p.ProductName, p.ShortDescription,
       p.BasePrice, p.SalePrice, p.ImageUrl, p.IsFeatured,
       c.CategoryName, b.BrandName,
       (SELECT AVG(CAST(r.Rating AS DECIMAL(3,1))) FROM catalog.ProductReviews r WHERE r.ProductId = p.ProductId AND r.IsApproved = 1) AS AvgRating,
       (SELECT COUNT(*) FROM catalog.ProductReviews r WHERE r.ProductId = p.ProductId AND r.IsApproved = 1) AS ReviewCount
FROM catalog.Products p
INNER JOIN catalog.Categories c ON p.CategoryId = c.CategoryId
LEFT JOIN catalog.Brands b ON p.BrandId = b.BrandId
WHERE p.IsActive = 1
GO

/****** Object:  View [catalog].[vw_LowStock]    Script Date: 04/14/2026 ******/
CREATE VIEW [catalog].[vw_LowStock] AS
SELECT i.InventoryId, p.ProductName, p.SKU, w.WarehouseName,
       i.QuantityOnHand, i.ReorderLevel, i.ReorderQuantity
FROM catalog.Inventory i
INNER JOIN catalog.Products p ON i.ProductId = p.ProductId
INNER JOIN catalog.Warehouses w ON i.WarehouseId = w.WarehouseId
WHERE i.QuantityOnHand <= i.ReorderLevel
GO

/****** Object:  UserDefinedFunction [catalog].[fn_GetProductPrice]    Script Date: 04/14/2026 ******/
CREATE FUNCTION [catalog].[fn_GetProductPrice]
(
	@ProductId INT
)
RETURNS DECIMAL(18,2)
AS
BEGIN
	DECLARE @Price DECIMAL(18,2)
	SELECT @Price = ISNULL(SalePrice, BasePrice) FROM catalog.Products WHERE ProductId = @ProductId
	RETURN @Price
END
GO

/****** Object:  UserDefinedFunction [catalog].[fn_GetAvailableStock]    Script Date: 04/14/2026 ******/
CREATE FUNCTION [catalog].[fn_GetAvailableStock]
(
	@ProductId INT,
	@WarehouseId INT
)
RETURNS INT
AS
BEGIN
	DECLARE @Stock INT
	SELECT @Stock = QuantityOnHand - QuantityReserved
	FROM catalog.Inventory
	WHERE ProductId = @ProductId AND WarehouseId = @WarehouseId
	RETURN ISNULL(@Stock, 0)
END
GO

/****** Object:  StoredProcedure [catalog].[sp_SearchProducts]    Script Date: 04/14/2026 ******/
CREATE PROCEDURE [catalog].[sp_SearchProducts]
	@SearchTerm NVARCHAR(200),
	@CategoryId INT = NULL,
	@MinPrice DECIMAL(18,2) = NULL,
	@MaxPrice DECIMAL(18,2) = NULL,
	@PageSize INT = 20,
	@PageNumber INT = 1
AS
BEGIN
	SET NOCOUNT ON
	SELECT p.ProductId, p.ProductName, p.SKU, p.BasePrice, p.SalePrice, p.ImageUrl
	FROM catalog.Products p
	WHERE p.IsActive = 1
	  AND (p.ProductName LIKE '%' + @SearchTerm + '%' OR p.SKU LIKE '%' + @SearchTerm + '%')
	  AND (@CategoryId IS NULL OR p.CategoryId = @CategoryId)
	  AND (@MinPrice IS NULL OR ISNULL(p.SalePrice, p.BasePrice) >= @MinPrice)
	  AND (@MaxPrice IS NULL OR ISNULL(p.SalePrice, p.BasePrice) <= @MaxPrice)
	ORDER BY p.ProductName
	OFFSET (@PageNumber - 1) * @PageSize ROWS
	FETCH NEXT @PageSize ROWS ONLY
END
GO

/****** Object:  StoredProcedure [catalog].[sp_UpdateInventory]    Script Date: 04/14/2026 ******/
CREATE PROCEDURE [catalog].[sp_UpdateInventory]
	@ProductId INT,
	@WarehouseId INT,
	@QuantityChange INT
AS
BEGIN
	SET NOCOUNT ON
	UPDATE catalog.Inventory
	SET QuantityOnHand = QuantityOnHand + @QuantityChange,
	    LastRestockedDate = CASE WHEN @QuantityChange > 0 THEN GETDATE() ELSE LastRestockedDate END
	WHERE ProductId = @ProductId AND WarehouseId = @WarehouseId
END
GO
