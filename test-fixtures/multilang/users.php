<?php
class UserRepository {
    // GOOD
    public function getUser($id) {
        $sql = "SELECT u.UserId, u.Email FROM auth.Users u WHERE u.UserId = ?";
        return $this->db->query($sql, [$id]);
    }

    // BAD: fake table
    public function getProfile($id) {
        $sql = <<<SQL
            SELECT up.UserId, up.Bio
            FROM auth.UserProfiles up
            WHERE up.UserId = ?
        SQL;
        return $this->db->query($sql, [$id]);
    }

    // BAD: fake column
    public function getUserAddress($id) {
        $sql = "SELECT u.UserId, u.Address FROM auth.Users u WHERE u.UserId = ?";
        return $this->db->query($sql, [$id]);
    }
}
