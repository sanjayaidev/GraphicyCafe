import { getSessionUser } from "../../lib/auth.js";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const user = await getSessionUser(req);

    if (!user) {
      return res.status(401).json({ error: "Not authenticated" });
    }

    return res.status(200).json({
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        avatar_url: user.avatar_url,
        role: user.role,
      },
    });
  } catch (err) {
    console.error("Me error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
}