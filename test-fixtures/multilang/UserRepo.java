package com.myapp.repos;

import java.sql.*;

public class UserRepo {
    // GOOD: valid query
    public ResultSet getUser(int id) throws SQLException {
        String sql = "SELECT u.UserId, u.Email, u.FirstName FROM auth.Users u WHERE u.UserId = ?";
        return null;
    }

    // BAD: hallucinated column
    public ResultSet getUserProfile(int id) throws SQLException {
        String sql = """
            SELECT u.UserId, u.Email, u.DisplayName
            FROM auth.Users u
            WHERE u.UserId = ?
            """;
        return null;
    }
}
