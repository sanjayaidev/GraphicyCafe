import cookie from "cookie";
import sql from "../../lib/db.js";
import { clearSessionCookie } from "../../lib/auth.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const cookies = cookie.parse(req.headers.cookie || "");
    const token = cookies.session_token;

    if (token) {
      await sql`DELETE FROM user_sessions WHERE token = ${token}`;
    }

    clearSessionCookie(res);
    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error("Logout error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
}