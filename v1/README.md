# Concierge Valet

A personal, proactive agent that lives in one message thread, in the spirit of texting a person: you write, it answers, and it can write first. Longer work (research, PDFs, documents) runs in the background and comes back as a reply to the original request.

## Parts

- `index.html`, `app.js`, `style.css`, `avatar.js`, `sw.js`: the app (installable web app, no build step). Kreda look, reactive avatars (Orbita, Buźka, Piksel) with an in-app configurator.
- `worker/`: the cloud brain on Cloudflare Workers.
  - `Valet` Durable Object: the thread, chat turns, reminders, briefs, WebSocket, Web Push.
  - `Task` Durable Object: one background job each, stepped by alarms.
  - Claude models: Sonnet 5.5 for conversation, Haiku 5.5 for briefs, Opus 5.5 for documents (changeable in settings).
- `Niepotrzebne/`: design rounds, the avatar lab and dev helpers.

## Local development

```bash
cd worker && npm install && npx wrangler dev --port 8790 --local --persist-to .wrangler/dev
node Niepotrzebne/devserver.mjs 2141
```

`worker/.dev.vars` holds `ANTHROPIC_API_KEYS`, `ACCESS_TOKEN`, `VAPID_PUBLIC` and `VAPID_PRIVATE` and is never committed. Open `http://localhost:2141/#k=<ACCESS_TOKEN>` to pair.

## Deploy

Worker: `npx wrangler deploy` in `worker/`, with the same four values set as secrets. App: static files from the repository root.
