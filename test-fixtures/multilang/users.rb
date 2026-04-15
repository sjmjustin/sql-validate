class UserRepository
  # GOOD
  def find_user(id)
    sql = <<~SQL
      SELECT u.UserId, u.Email, u.FirstName
      FROM auth.Users u
      WHERE u.UserId = ?
    SQL
    execute(sql, id)
  end

  # BAD: fake table
  def find_certification(id)
    sql = <<~SQL
      SELECT c.CertId, c.CertName
      FROM hr.Certifications c
      WHERE c.EmployeeId = ?
    SQL
    execute(sql, id)
  end
end
