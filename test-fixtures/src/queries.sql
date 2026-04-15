-- Test SQL file with some valid and invalid queries

-- GOOD: valid query
SELECT u.Id, u.Email, u.FirstName, u.LastName
FROM dbo.Users u
INNER JOIN dbo.Departments d ON u.DepartmentId = d.Id
WHERE d.IsActive = 1
GO

-- BAD: "PhoneNumber" column does not exist on Users
SELECT u.Id, u.Email, u.PhoneNumber
FROM dbo.Users u
WHERE u.IsActive = 1
GO

-- BAD: "dbo.AuditLog" table does not exist
INSERT INTO dbo.AuditLog (UserId, Action, Timestamp)
VALUES (@UserId, 'LOGIN', GETDATE())
GO

-- GOOD: valid procedure call
EXEC dbo.sp_GetUserOrders @UserId = 1, @Status = 'Pending'
GO

-- BAD: "TotalPrice" does not exist on OrderItems (should be UnitPrice)
SELECT oi.OrderId, oi.ProductId, oi.Quantity, oi.TotalPrice
FROM dbo.OrderItems oi
WHERE oi.OrderId = @OrderId
GO
