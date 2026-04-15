Imports System.Data.SqlClient

Public Class UserRepository
    ' GOOD
    Public Function GetUser(userId As Integer) As DataTable
        Dim sql As String = "SELECT u.UserId, u.Email, u.FirstName FROM auth.Users u WHERE u.UserId = @UserId"
        Return Execute(sql)
    End Function

    ' BAD: fake column
    Public Function GetUserGender(userId As Integer) As DataTable
        Dim sql As String = "SELECT u.UserId, u.Gender FROM auth.Users u WHERE u.UserId = @UserId"
        Return Execute(sql)
    End Function
End Class
