import bcrypt from "bcryptjs";
import sql from "../../lib/db.js";
import { createSession, setSessionCookie } from "../../lib/auth.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: "Email and password are required" });
    }

    // Find user
    const users = await sql`
      SELECT id, name, email, password_hash, is_active
      FROM users
      WHERE email = ${email.toLowerCase()}
      LIMIT 1
    `;

    if (users.length === 0) {
      return res.status(401).json({ error: "Invalid email or password" });
    }

    const user = users[0];

    if (!user.is_active) {
      return res.status(403).json({ error: "Account is deactivated" });
    }

    // Verify password
    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      return res.status(401).json({ error: "Invalid email or password" });
    }

    // Create session
    const { token, expiresAt } = await createSession(user.id);
    setSessionCookie(res, token, expiresAt);

    return res.status(200).json({
      user: { id: user.id, name: user.name, email: user.email },
    });
  } catch (err) {
    console.error("Login error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
}