using System;
using System.Data.SqlClient;

namespace MyApp.Repositories
{
    public class UserRepository
    {
        // GOOD: all refs are valid
        public void GetActiveUsers()
        {
            var query = @"SELECT u.Id, u.Email, u.UserName, u.FirstName, u.LastName
                          FROM dbo.Users u
                          WHERE u.IsActive = 1";
        }

        // BAD: "usr_email" does not exist on Users, "UserStatus" does not exist
        public void GetUserDetails(int userId)
        {
            var query = @"SELECT u.Id,
                                 u.usr_email,
                                 u.FirstName,
                                 u.UserStatus,
                                 u.CreatedDate
                          FROM dbo.Users u
                          WHERE u.Id = @UserId";
        }

        // BAD: table "dbo.UserProfiles" does not exist
        public void GetUserProfile(int userId)
        {
            var query = @"SELECT up.Id, up.Bio, up.AvatarUrl
                          FROM dbo.UserProfiles up
                          WHERE up.UserId = @UserId";
        }

        // BAD: function "dbo.fn_GetUserEmail" does not exist (should be fn_GetUserFullName)
        public void GetUserDisplayName(int userId)
        {
            var query = @"SELECT dbo.fn_GetUserEmail(@UserId) AS DisplayName";
        }

        // BAD: wrong index name in hint
        public void SearchUsersByEmail(string email)
        {
            var query = @"SELECT u.Id, u.Email
                          FROM dbo.Users u WITH (INDEX(IX_Users_EmailAddress))
                          WHERE u.Email LIKE @Email";
        }

        // GOOD: all refs valid
        public void GetUserOrders(int userId)
        {
            var query = @"SELECT o.Id, o.OrderDate, o.TotalAmount, o.Status
                          FROM dbo.Orders o
                          INNER JOIN dbo.Users u ON o.UserId = u.Id
                          WHERE u.Id = @UserId
                          ORDER BY o.OrderDate DESC";
        }

        // BAD: "dbo.Customers" table does not exist
        public void GetCustomerOrders()
        {
            var query = @"SELECT c.Id, c.Name, o.OrderDate
                          FROM dbo.Customers c
                          INNER JOIN dbo.Orders o ON o.UserId = c.Id";
        }

        // BAD: exec a procedure that doesn't exist
        public void RunReport()
        {
            var query = @"EXEC dbo.sp_GenerateMonthlyReport @Year = 2024";
        }
    }
}
