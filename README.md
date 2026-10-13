# DVOZON — AI Coding Agent (Starter)

Mobile-friendly full-stack starter for Android users. Includes:
- Responsive coding-agent interface
- Email/password signup and login
- Password hashing with bcrypt
- HTTP-only JWT cookie
- SQLite user storage
- Server-side AI endpoint (OpenAI-compatible API)
- Rate limiting and basic security headers

## Important
This is a functional starter, not a finished autonomous agent. It does not execute arbitrary code or deploy projects. AI responses require your own API key and may incur provider charges. Never share your API key or commit `.env`.

## Run on Android (Termux)
1. Install Termux from its official F-Droid/GitHub source.
2. Open Termux and run:
   ```sh
   pkg update && pkg upgrade
   pkg install nodejs-lts unzip
   ```
3. Extract this ZIP into a folder you can access.
4. In Termux, `cd` into the extracted `DVOZON` folder.
5. Run:
   ```sh
   cp .env.example .env
   nano .env
   ```
6. Set `JWT_SECRET` to a long random value. Add your AI provider key to `AI_API_KEY` if you want AI responses. Save in nano with Ctrl+O, Enter, Ctrl+X.
7. Install and start:
   ```sh
   npm install
   npm start
   ```
8. Open Chrome and visit `http://127.0.0.1:3000`.

## Deploy online
Use a Node.js host that supports persistent disk storage. Set environment variables in the host dashboard; do not upload `.env`. SQLite needs persistent storage. For multi-instance production deployments, replace SQLite with PostgreSQL and use a managed session/auth solution.

## AI provider setup
The server sends requests to `AI_BASE_URL/chat/completions` using `AI_API_KEY` and `AI_MODEL`. Use an API provider/account you control. A ChatGPT subscription is not automatically an API key. Check your provider's pricing and usage limits.

## Security before public launch
- Set `COOKIE_SECURE=true` behind HTTPS.
- Use a strong random `JWT_SECRET`.
- Add email verification, password reset, CAPTCHA, audit logging and account deletion.
- Configure backups, privacy policy and terms.
- Never run model-generated code on the server without an isolated sandbox.
