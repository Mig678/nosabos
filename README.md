# No Sabo

A language learning app I'm building. Right now it works with Spanish/English/Nahuatl, but I'm planning to pivot this into a Chinese learning platform since I want to learn Chinese.

## What I'm Building

This is basically a working prototype to test out the tech stack. The Spanish stuff is just to make sure everything works before I switch it over to Chinese. The core features are:

- Real-time voice conversations with AI
- Language coaching and feedback
- Goal-based practice sessions
- Progress tracking

## Tech Stack

- **Frontend**: React + Vite + Chakra UI
- **Backend**: Firebase Cloud Functions (Node.js 22)
- **AI**: OpenAI GPT-4o Realtime API
- **Database**: Firebase Firestore
- **Hosting**: Firebase Hosting
- **Auth**: Nostr (decentralized identity)

Pretty standard modern web stack. The real-time AI stuff is what makes it interesting for language learning.

## Project Structure

```
nosabos/
├── src/                    # Frontend React app
│   ├── components/         # React components
│   ├── hooks/              # Custom React hooks
│   ├── firebaseResources/  # Firebase configuration
│   └── utils/              # Utility functions
├── public/                 # Static assets
├── dist/                   # Built frontend (auto-generated)
└── package.json           # Frontend dependencies

functions/                  # Firebase Cloud Functions
├── index.js               # Function implementations
├── package.json           # Backend dependencies
└── .env                   # Environment variables (not tracked)

firebase.json              # Firebase configuration
firestore.rules           # Database security rules
firestore.indexes.json    # Database indexes
.firebaserc               # Firebase project settings
```

## Setup

You'll need:
- Node.js 20+ 
- Firebase CLI (`npm install -g firebase-tools`)
- OpenAI API key with some credits
- Firebase project

```bash
git clone <your-repo-url>
cd nosabos
npm install
cd functions
npm install
```

Set up your environment files:

**Frontend (`nosabos/.env`):**
```env
VITE_FIREBASE_PUBLIC_API_KEY=your_firebase_public_api_key
VITE_PATREON_PASSCODE=dev-pass
VITE_RESPONSES_URL=https://your-sdp-function-url
VITE_REALTIME_URL=https://your-responses-function-url
```

**Backend (`functions/.env`):**
```env
OPENAI_API_KEY=sk-proj-your_openai_api_key
DEPLOYED_URL=https://your-app-url.web.app
```

Deploy:
```bash
firebase login
firebase use your-project-id
firebase deploy --only functions
cd nosabos && npm run build && cd ..
firebase deploy --only hosting
```

Get your OpenAI API key from [OpenAI Platform](https://platform.openai.com/api-keys) and add it to `functions/.env`. Make sure you have some credits.

## Development

```bash
cd nosabos && npm run dev
firebase emulators:start --only functions
```

## Security

The Firebase public API key is safe to expose (that's how it works). Everything else is properly hidden in environment variables and ignored by git.

## What's Next

Eventually I want to turn this into a Chinese learning app. The plan is to add:

- Chinese character recognition and stroke order
- Tone training with AI feedback  
- Cultural context through stories and idioms
- Pronunciation coaching
- HSK exam prep
- Cultural immersion stuff

Right now it's just a working prototype to make sure the tech stack is solid.

## License

MIT License

---

**Live URL**: https://nosabo-miguel.web.app
