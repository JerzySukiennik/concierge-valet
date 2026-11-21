# Concierge Valet

A personal, proactive agent that lives in one message thread, in the spirit of texting a person: you write, it answers, and it can write first. Longer work (research, PDFs, documents) runs in the background and comes back as a reply to the original request.

## Parts

- `index.html`, `app.js`, `style.css`, `avatar.js`, `sw.js`: the app (installable web app, no build step). Kreda look, reactive avatars (Orbita, Buźka, Piksel) with an in-app configurator.
- `cards.js`, `cards.css`: connector cards shared by the phone and Mac apps (YouTube videos, a film or series, a shelf of posters, a generated image with its lightbox).
- `worker/`: the cloud brain on Cloudflare Workers.
  - `Valet` Durable Object: the thread, chat turns, reminders, briefs, WebSocket, Web Push.
  - `Task` Durable Object: one background job each, stepped by alarms.
  - Claude models: Sonnet 5.5 for conversation, Haiku 5.5 for briefs, Opus 5.5 for documents (changeable in settings).
  - `calendar.mjs`: iCloud calendar over CalDAV (reads events with recurrences expanded by ical.js, adds and changes events, deletes only after a tap on a confirmation card), synced every 30 minutes for nudges before events and for the briefs.
  - `connectors.mjs`: YouTube Data API search, TMDB films and series with where to watch in Poland, image generation through OpenRouter. Generated images are stored in the thread's own SQLite blob table and served through the signed `/f/` links.
- `link/`: the WhatsApp link, a small Node service that holds a linked-device session (Baileys, pinned to the official package) and answers the agent over the bridge socket: chats, messages, sends approved on a card, new messages from watched chats. Installed as a LaunchAgent by `link/install.sh`; the session and the message store live in `~/.valet-link`, never in the repository.
- `macapp/`: the native Mac shell and the bridge inside it.
- `Niepotrzebne/`: design rounds, the avatar lab and dev helpers.

## Pilot for Claude Code

`pilot/` connects the agent to the Claude Code sessions open in the Claude desktop app on the owner's Mac. `pilot/mod` is a mod for the Claude app: it reports finished turns and takes prompts over a private Unix socket. `pilot/hub.mjs` is a small background service that keeps that socket and one bridge socket to the agent; `pilot/install.sh` installs it as a LaunchAgent. The agent can list sessions, read their latest messages and pass on a prompt, only in a turn the owner started.

## Local development

```bash
cd worker && npm install && npx wrangler dev --port 8790 --local --persist-to .wrangler/dev
node Niepotrzebne/devserver.mjs 2141
```

`worker/.dev.vars` holds `ANTHROPIC_API_KEYS`, `ACCESS_TOKEN`, `VAPID_PUBLIC` and `VAPID_PRIVATE` and is never committed. The connectors read `YOUTUBE_API_KEY`, `TMDB_API_KEY`, `OPENROUTER_API_KEY` and, for the calendar, `ICLOUD_USER` with `ICLOUD_PASSWORD` (an app-specific password) from the same file; a missing key only switches that connector off. Open `http://localhost:2141/#k=<ACCESS_TOKEN>` to pair.

## Deploy

Worker: `npx wrangler deploy` in `worker/`, with the same values set as secrets. App: static files from the repository root.

## Credits

Film and series data comes from TMDB; this product uses the TMDB API but is not endorsed or certified by TMDB. Streaming availability is provided by JustWatch.
