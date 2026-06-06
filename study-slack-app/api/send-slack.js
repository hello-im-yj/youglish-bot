export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();

  const webhookUrl = process.env.SLACK_WEBHOOK_URL;
  const { text, payload } = req.body;

  if (!webhookUrl) {
    return res.status(500).json({ ok: false, error: "SLACK_WEBHOOK_URL environment variable is missing" });
  }

  try {
    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload || { text }),
    });

    if (!response.ok) throw new Error("Slack error");
    res.status(200).json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
}
