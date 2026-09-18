# AI StudyMate — Online Deployment Ready

AI StudyMate is a full-stack student study companion with authentication, a personal dashboard, subjects, user-created tasks, flashcards, quizzes, progress tracking, a focus timer, and an OpenAI-powered AI Tutor.

## Run locally

Requirements: Node.js 20+

```bash
npm install
cp .env.example .env
```

Add your OpenAI API key to `.env` if you want live AI:

```env
OPENAI_API_KEY=your_key_here
OPENAI_MODEL=gpt-5.6-luna
JWT_SECRET=use-a-long-random-secret
PORT=7700
```

Then:

```bash
npm start
```

Open `http://localhost:7700`.

## Deploy online with Render

This repository includes `render.yaml` for a Render web service + PostgreSQL database.

1. Push this project to GitHub.
2. In Render, choose **New → Blueprint** and select the GitHub repository.
3. Render will create the `ai-studymate` web service and `ai-studymate-db` PostgreSQL database from `render.yaml`.
4. In the web service's **Environment** settings, add `OPENAI_API_KEY` with your secret API key. `JWT_SECRET` is generated automatically by the Blueprint and `DATABASE_URL` is connected to the Postgres database.
5. Deploy. Render will run `npm install` and `npm start` and expose the app at a public `onrender.com` URL.

### Important security notes

- Never commit `.env` or a real API key to GitHub.
- Keep the OpenAI key on the server only; browser users do not need their own keys.
- The online version uses PostgreSQL when `DATABASE_URL` is present. The local JSON file remains as a fallback for local development.

## AI Tutor

The backend uses the OpenAI Responses API. The model can be changed with `OPENAI_MODEL` without changing frontend code.

## Data

Each account has its own subjects, tasks, flashcards, quiz history, and study sessions. The production deployment stores the application state in PostgreSQL.
