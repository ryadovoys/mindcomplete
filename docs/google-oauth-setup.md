# Google OAuth Setup Guide

## What's Already Done

### Backend (Supabase)
- Supabase Auth is configured and working for email/password authentication
- The database schema supports user accounts
- Valleys (saved documents) are linked to user accounts

### Frontend
- Auth modal with email/password sign in/up
- AuthManager class in `app.js` handles authentication state
- Google sign-in button code exists but is hidden (removed from HTML, styles remain in CSS)

## What's Needed

### 1. Google Cloud Console Setup

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project (or select existing)
3. Navigate to **APIs & Services** → **Credentials**
4. Click **Create Credentials** → **OAuth client ID**
5. If prompted, configure the OAuth consent screen:
   - Choose "External" user type
   - Fill in app name: "Mindcomplete"
   - Add your email as developer contact
   - Add scopes: `email`, `profile`, `openid`
   - Add test users if in testing mode
6. Create OAuth client ID:
   - Application type: **Web application**
   - Name: "Mindcomplete Web"
   - Authorized JavaScript origins:
     - `http://localhost:3000` (development)
     - `https://your-domain.com` (production)
   - Authorized redirect URIs:
     - Get this URL from Supabase (see step 2)
7. Copy the **Client ID** and **Client Secret**

### 2. Supabase Configuration

1. Go to [Supabase Dashboard](https://supabase.com/dashboard)
2. Select your project
3. Navigate to **Authentication** → **Providers**
4. Find **Google** and enable it
5. Paste your **Client ID** and **Client Secret** from Google
6. Copy the **Redirect URL** shown - add this to Google Cloud Console's authorized redirect URIs
7. Save

### 3. Re-enable Frontend Button

In `public/index.html`, add back the Google sign-in button inside the auth form section (after the submit button's section-buttons div):

```html
<!-- Divider -->
<div class="auth-divider">
  <span>or</span>
</div>

<!-- Social Login -->
<button class="btn-social" id="google-signin-btn">
  <svg width="18" height="18" viewBox="0 0 18 18" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M17.64 9.205c0-.639-.057-1.252-.164-1.841H9v3.481h4.844a4.14 4.14 0 0 1-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615Z" fill="#4285F4"/>
    <path d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18Z" fill="#34A853"/>
    <path d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332Z" fill="#FBBC05"/>
    <path d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58Z" fill="#EA4335"/>
  </svg>
  Continue with Google
</button>
```

### 4. Add Click Handler (if not present)

In `public/app.js`, inside the `AuthManager` class `bindEvents()` method, ensure this exists:

```javascript
const googleBtn = document.getElementById('google-signin-btn');
if (googleBtn) {
  googleBtn.addEventListener('click', async () => {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: window.location.origin
      }
    });
    if (error) {
      this.showError(error.message);
    }
  });
}
```

## Testing

1. Run the app locally: `npm run dev`
2. Click "Sign In" → "Continue with Google"
3. Complete Google sign-in flow
4. You should be redirected back and logged in

## Troubleshooting

- **Redirect URI mismatch**: Ensure the exact redirect URL from Supabase is added to Google Cloud Console
- **App not verified**: During development, add test users in Google Console or click "Continue" on the warning
- **CORS errors**: Check that your domain is in the authorized JavaScript origins

## Production Checklist

- [ ] Add production domain to Google Cloud Console origins
- [ ] Add production redirect URI to Google Cloud Console
- [ ] Verify app in Google Console (removes "unverified app" warning)
- [ ] Test full flow on production domain
