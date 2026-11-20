import passport from "passport";
import { Strategy as GoogleStrategy } from "passport-google-oauth20";
import {User} from "../models/user.js";
import { env } from "cloudflare:workers";

passport.use(
  new GoogleStrategy(
    {
      clientID: env.GOOGLE_CLIENT_ID,
      clientSecret: env.GOOGLE_CLIENT_SECRET,
      callbackURL: "https://polling-app-production-a6f5.up.railway.app/api/auth/google/callback"
    },
    async (accessToken, refreshToken, profile, done) => {

      const googleId = profile.id;
      const name = profile.displayName;
      const email = profile.emails?.[0]?.value;
    //   const picture = profile.photos?.[0]?.value;

      // ✅ Check if user already exists
      let user = await User.findOne({ googleId });
      let isNewUser = false
      if (!user) {
        // ✅ Create new user
        user = await User.create({
          googleId,
          name,
          email,
        });
        isNewUser = true
      }
      return done(null, {user,isNewUser}); // this goes to req.user
    }
  )
);

export default passport;




