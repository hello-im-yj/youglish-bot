# youglish-bot

Fireflies.ai 스터디 전사본을 분석해 Slack 메시지로 정리하는 Vite + React 앱입니다.

![youglish-bot preview](images.jpeg)

## Local

```bash
cd study-slack-app
npm install
npm run dev
```

`.env`에는 아래 값을 설정합니다.

```env
GEMINI_API_KEY=...
GEMINI_MODEL=gemini-2.5-flash-lite
SLACK_WEBHOOK_URL=<your-slack-webhook-url>
```
