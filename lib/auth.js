import crypto from "crypto";
import cookie from "cookie";
import sql from "./db.js";

const SESSION_DAYS = 7;

export async function createSession(userId) {
  const token = crypto.randomBytes(48).toString("hex");
  const expiresAt = new Date(
    Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000
  );

  await sql`
    INSERT INTO user_sessions (user_id, token, expires_at)
    VALUES (${userId}, ${token}, ${expiresAt})
  `;

  return { token, expiresAt };
}

export async function getSessionUser(req) {
  const cookies = cookie.parse(req.headers.cookie || "");
  const token = cookies.session_token;

  if (!token) return null;

  const rows = await sql`
    SELECT u.id, u.name, u.email, u.avatar_url, r.name AS role
    FROM user_sessions s
    JOIN users u ON u.id = s.user_id
    LEFT JOIN user_roles ur ON ur.user_id = u.id
    LEFT JOIN roles r ON r.id = ur.role_id
    WHERE s.token = ${token}
      AND s.expires_at > NOW()
      AND u.is_active = true
    LIMIT 1
  `;

  if (rows.length === 0) return null;

  // Update last_login
  await sql`
    UPDATE users SET last_login = NOW() WHERE id = ${rows[0].id}
  `;

  return rows[0];
}

export function setSessionCookie(res, token, expiresAt) {
  const serialized = cookie.serialize("session_token", token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: new Date(expiresAt),
  });
  res.setHeader("Set-Cookie", serialized);
}

export function clearSessionCookie(res) {
  const serialized = cookie.serialize("session_token", "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
  res.setHeader("Set-Cookie", serialized);
}