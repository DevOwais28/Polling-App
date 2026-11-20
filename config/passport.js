import passport from "passport";
import { Strategy as GoogleStrategy } from "passport-google-oauth20";
import { User } from "../models/user.js";

let isInitialized = false;

export function initPassport() {
  if (isInitialized) return;
  isInitialized = true;

  passport.use(
    new GoogleStrategy(
      {
        clientID: process.env.GOOGLE_CLIENT_ID || process.env.GOOGLE_CLIENT_ID,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET || process.env.GOOGLE_CLIENT_SECRET,
        callbackURL:
          env.GOOGLE_CALLBACK_URL ||
          process.env.GOOGLE_CALLBACK_URL ||
          "https://polling-app.<YOUR-SUBDOMAIN>.workers.dev/api/auth/google/callback",
      },
      async (accessToken, refreshToken, profile, done) => {
        try {
          const googleId = profile.id;
          const name = profile.displayName;
          const email = profile.emails?.[0]?.value;

          // ✅ Check if user already exists
          let user = await User.findOne({ googleId });
          let isNewUser = false;
          if (!user) {
            // ✅ Create new user
            user = await User.create({
              googleId,
              name,
              email,
            });
            isNewUser = true;
          }
          return done(null, { user, isNewUser }); // this goes to req.user
        } catch (err) {
          return done(err, null);
        }
      }
    )
  );
}

export default passport;
