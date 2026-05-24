Firebase setup for ProResize

1. Go to Firebase Console and create a project.
2. In that project, add a Web App.
3. Copy the Firebase config object and paste the values into `firebase-config.js`.
4. In Firebase Console, enable Authentication:
   - Sign-in method: `Email/Password`
5. In Firebase Console, create a Firestore database:
   - Start in production mode or test mode for development
6. Add Firestore rules like these for per-user history:

```txt
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /users/{userId} {
      allow read, write: if request.auth != null && request.auth.uid == userId;
      match /history/{historyId} {
        allow read, write: if request.auth != null && request.auth.uid == userId;
      }
    }
  }
}
```

7. If your `firebase-config.js` includes a `databaseURL`, this project will try Firebase Realtime Database first and fall back to Firestore if needed. Add Realtime Database rules like these too:

```json
{
  "rules": {
    "users": {
      "$userId": {
        ".read": "auth != null && auth.uid === $userId",
        ".write": "auth != null && auth.uid === $userId"
      }
    }
  }
}
```

8. Serve the site from a web server while testing:
   - example: VS Code Live Server
   - or Firebase Hosting

Notes

- Accounts and history are now intended to sync across devices through Firebase.
- Actual image files are still processed locally in the browser.
- Only history metadata is stored in Firestore.
