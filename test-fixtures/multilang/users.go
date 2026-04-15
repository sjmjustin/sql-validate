package repos

import "database/sql"

// GOOD
func GetUser(db *sql.DB, id int) (*sql.Row, error) {
	query := `SELECT u.UserId, u.Email, u.FirstName
	          FROM auth.Users u
	          WHERE u.UserId = $1`
	return db.QueryRow(query, id), nil
}

// BAD: hallucinated table
func GetApiKey(db *sql.DB, id int) (*sql.Row, error) {
	query := `SELECT ak.KeyId, ak.ApiKey, ak.ExpiresAt
	          FROM auth.ApiKeys ak
	          WHERE ak.UserId = $1`
	return db.QueryRow(query, id), nil
}

// BAD: fake column
func GetUserTimezone(db *sql.DB, id int) (*sql.Row, error) {
	query := `SELECT u.UserId, u.Timezone
	          FROM auth.Users u
	          WHERE u.UserId = $1`
	return db.QueryRow(query, id), nil
}
