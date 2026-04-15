/****** Object:  Schema [hr]    Script Date: 04/14/2026 ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO

/****** Object:  Table [hr].[Departments]    Script Date: 04/14/2026 ******/
CREATE TABLE [hr].[Departments](
	[DepartmentId] [int] IDENTITY(1,1) NOT NULL,
	[DepartmentName] [nvarchar](200) NOT NULL,
	[DepartmentCode] [nvarchar](20) NOT NULL,
	[ManagerId] [int] NULL,
	[ParentDepartmentId] [int] NULL,
	[Budget] [decimal](18, 2) NULL,
	[IsActive] [bit] NOT NULL,
	[CreatedDate] [datetime2](7) NOT NULL,
 CONSTRAINT [PK_Departments] PRIMARY KEY CLUSTERED
(
	[DepartmentId] ASC
)
) ON [PRIMARY]
GO

/****** Object:  Table [hr].[Employees]    Script Date: 04/14/2026 ******/
CREATE TABLE [hr].[Employees](
	[EmployeeId] [int] IDENTITY(1,1) NOT NULL,
	[UserId] [int] NULL,
	[EmployeeNumber] [nvarchar](20) NOT NULL,
	[FirstName] [nvarchar](100) NOT NULL,
	[LastName] [nvarchar](100) NOT NULL,
	[Email] [nvarchar](255) NOT NULL,
	[PhoneNumber] [nvarchar](20) NULL,
	[DepartmentId] [int] NOT NULL,
	[ManagerId] [int] NULL,
	[JobTitle] [nvarchar](200) NOT NULL,
	[HireDate] [date] NOT NULL,
	[TerminationDate] [date] NULL,
	[Salary] [decimal](18, 2) NOT NULL,
	[EmploymentType] [nvarchar](50) NOT NULL,
	[IsActive] [bit] NOT NULL,
	[CreatedDate] [datetime2](7) NOT NULL,
	[ModifiedDate] [datetime2](7) NULL,
 CONSTRAINT [PK_Employees] PRIMARY KEY CLUSTERED
(
	[EmployeeId] ASC
)
) ON [PRIMARY]
GO

/****** Object:  Table [hr].[TimeEntries]    Script Date: 04/14/2026 ******/
CREATE TABLE [hr].[TimeEntries](
	[TimeEntryId] [int] IDENTITY(1,1) NOT NULL,
	[EmployeeId] [int] NOT NULL,
	[EntryDate] [date] NOT NULL,
	[HoursWorked] [decimal](5, 2) NOT NULL,
	[ProjectCode] [nvarchar](50) NULL,
	[Description] [nvarchar](500) NULL,
	[IsApproved] [bit] NOT NULL,
	[ApprovedBy] [int] NULL,
	[CreatedDate] [datetime2](7) NOT NULL,
 CONSTRAINT [PK_TimeEntries] PRIMARY KEY CLUSTERED
(
	[TimeEntryId] ASC
)
) ON [PRIMARY]
GO

/****** Object:  Table [hr].[LeaveRequests]    Script Date: 04/14/2026 ******/
CREATE TABLE [hr].[LeaveRequests](
	[LeaveRequestId] [int] IDENTITY(1,1) NOT NULL,
	[EmployeeId] [int] NOT NULL,
	[LeaveType] [nvarchar](50) NOT NULL,
	[StartDate] [date] NOT NULL,
	[EndDate] [date] NOT NULL,
	[TotalDays] [decimal](5, 1) NOT NULL,
	[Reason] [nvarchar](500) NULL,
	[Status] [nvarchar](50) NOT NULL,
	[ApprovedBy] [int] NULL,
	[CreatedDate] [datetime2](7) NOT NULL,
 CONSTRAINT [PK_LeaveRequests] PRIMARY KEY CLUSTERED
(
	[LeaveRequestId] ASC
)
) ON [PRIMARY]
GO

/****** Object:  Table [hr].[PerformanceReviews]    Script Date: 04/14/2026 ******/
CREATE TABLE [hr].[PerformanceReviews](
	[ReviewId] [int] IDENTITY(1,1) NOT NULL,
	[EmployeeId] [int] NOT NULL,
	[ReviewerId] [int] NOT NULL,
	[ReviewPeriod] [nvarchar](50) NOT NULL,
	[OverallRating] [int] NOT NULL,
	[Strengths] [nvarchar](max) NULL,
	[AreasForImprovement] [nvarchar](max) NULL,
	[Goals] [nvarchar](max) NULL,
	[ReviewDate] [date] NOT NULL,
	[Status] [nvarchar](50) NOT NULL,
 CONSTRAINT [PK_PerformanceReviews] PRIMARY KEY CLUSTERED
(
	[ReviewId] ASC
)
) ON [PRIMARY]
GO

/****** Object:  Index [IX_Employees_DepartmentId]    Script Date: 04/14/2026 ******/
CREATE NONCLUSTERED INDEX [IX_Employees_DepartmentId] ON [hr].[Employees]
(
	[DepartmentId] ASC
)
GO

/****** Object:  Index [IX_Employees_EmployeeNumber]    Script Date: 04/14/2026 ******/
CREATE UNIQUE NONCLUSTERED INDEX [IX_Employees_EmployeeNumber] ON [hr].[Employees]
(
	[EmployeeNumber] ASC
)
GO

/****** Object:  Index [IX_TimeEntries_EmployeeId]    Script Date: 04/14/2026 ******/
CREATE NONCLUSTERED INDEX [IX_TimeEntries_EmployeeId] ON [hr].[TimeEntries]
(
	[EmployeeId] ASC
)
GO

/****** Object:  View [hr].[vw_EmployeeDirectory]    Script Date: 04/14/2026 ******/
CREATE VIEW [hr].[vw_EmployeeDirectory] AS
SELECT e.EmployeeId, e.EmployeeNumber, e.FirstName, e.LastName, e.Email,
       e.PhoneNumber, e.JobTitle, d.DepartmentName,
       m.FirstName + ' ' + m.LastName AS ManagerName
FROM hr.Employees e
INNER JOIN hr.Departments d ON e.DepartmentId = d.DepartmentId
LEFT JOIN hr.Employees m ON e.ManagerId = m.EmployeeId
WHERE e.IsActive = 1
GO

/****** Object:  UserDefinedFunction [hr].[fn_GetEmployeeTenure]    Script Date: 04/14/2026 ******/
CREATE FUNCTION [hr].[fn_GetEmployeeTenure]
(
	@EmployeeId INT
)
RETURNS INT
AS
BEGIN
	DECLARE @Years INT
	SELECT @Years = DATEDIFF(YEAR, HireDate, ISNULL(TerminationDate, GETDATE()))
	FROM hr.Employees WHERE EmployeeId = @EmployeeId
	RETURN ISNULL(@Years, 0)
END
GO

/****** Object:  StoredProcedure [hr].[sp_GetDepartmentHeadcount]    Script Date: 04/14/2026 ******/
CREATE PROCEDURE [hr].[sp_GetDepartmentHeadcount]
	@DepartmentId INT = NULL
AS
BEGIN
	SET NOCOUNT ON
	SELECT d.DepartmentId, d.DepartmentName, COUNT(e.EmployeeId) AS Headcount
	FROM hr.Departments d
	LEFT JOIN hr.Employees e ON d.DepartmentId = e.DepartmentId AND e.IsActive = 1
	WHERE (@DepartmentId IS NULL OR d.DepartmentId = @DepartmentId)
	GROUP BY d.DepartmentId, d.DepartmentName
END
GO

/****** Object:  StoredProcedure [hr].[sp_ApproveLeaveRequest]    Script Date: 04/14/2026 ******/
CREATE PROCEDURE [hr].[sp_ApproveLeaveRequest]
	@LeaveRequestId INT,
	@ApprovedBy INT
AS
BEGIN
	SET NOCOUNT ON
	UPDATE hr.LeaveRequests SET Status = 'Approved', ApprovedBy = @ApprovedBy
	WHERE LeaveRequestId = @LeaveRequestId AND Status = 'Pending'
END
GO
