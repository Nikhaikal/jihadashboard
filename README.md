# Jiha Dashboard — Netlify deployment

This is a plain static website: there is no install or build step. The dashboard itself is in `dist/index.html` and its Netlify publish folder is `dist`.

## Deploy from Netlify Drop

1. Open the `dist` folder in Finder.
2. Go to [Netlify Drop](https://app.netlify.com/drop).
3. Drag the complete `dist` folder onto the page.

## Deploy from GitHub

1. Create a GitHub repository and upload the entire `jiha-dashboard` folder.
2. In Netlify, choose **Add new site** → **Import an existing project**.
3. Select the repository.
4. Use these settings:
   - Build command: leave blank
   - Publish directory: `dist`
5. Select **Deploy site**.

`netlify.toml` already provides these settings, so Netlify should detect them automatically.

## Firebase setup (required before Netlify deployment)

The dashboard uses the Firebase project `jihacowaydashboard` for Authentication and Cloud Firestore.

1. In Firebase Console, enable **Authentication → Email/Password**.
2. Create the first two Authentication users: `nikkhaikal@gmail.com` and `nealia.najihah@gmail.com`.
3. Create a Cloud Firestore database in Production mode.
4. Install the Firebase CLI, then run these commands from this folder:

   ```bash
   firebase login
   firebase use jihacowaydashboard
   firebase deploy --only firestore:rules
   cd functions && npm install && cd ..
   firebase deploy --only functions
   ```

The callable `createAccount` function is what allows only the admin and Jiha to add dashboard users. Viewers can read data; users created as Editors can edit the dashboard.

After these Firebase steps, deploy the static site to Netlify using the GitHub or Netlify Drop instructions above.
