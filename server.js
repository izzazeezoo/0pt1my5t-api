require('dotenv').config()
const express = require('express');
const passport = require('passport');
const GoogleStrategy = require("passport-google-oauth20").Strategy;
const session = require('express-session');
const MySQLStore = require('express-mysql-session')(session);
const cors = require('cors');
const cookieParser = require('cookie-parser');
const bodyParser = require('body-parser');
const db = require('./var/dbConfig');
const authRouter = require('./routes/auth');


// intialize app and define the server port
const app = express();
const port = process.env.PORT || 3000;

// Connect to MySQL
db.connect((err) => {
    if (err) {
        console.error('Database connection failed: ', err.stack);
        return;
    }
    console.log('Connected to MySQL database.');
});


app.use(
	cors({
		origin: `${frontendUrl}`,
		credentials: true,
		// allowedHeaders: ["Content-Type", "Authorization"],
		// methods: ["GET", "POST", "OPTIONS"],
	})
);
app.use(cookieParser());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({extended: true}));

const sessionStore = new MySQLStore({}, db)
app.use(session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: true,
    store: sessionStore,
}));

app.use(passport.initialize())
app.use(passport.session())

passport.serializeUser((user, done) => {
    done(null, user.id);
});

passport.deserializeUser((id, done) => {
    db.query("SELECT * FROM users WHERE id = ?", [id], (err, results) => {
        if (err) throw done(err)

        if (results.length === 0) {
            return done(null, false) // no user found, return false
        }

        done(null, results[0]);
    })
});

//initialize 
const allowedDomains = process.env.ALLOWED_DOMAINS ? process.env.ALLOWED_DOMAINS.split(',') : [];
passport.use(
    new GoogleStrategy(
        {
            clientID: process.env.GOOGLE_CLIENT_ID, // google client id
            clientSecret: process.env.GOOGLE_CLIENT_SECRET, // google client secret
            callbackURL: process.env.GOOGLE_CALLBACK_URL,
            scope: ["profile", "email"]
        },
        (accessToken, refreshToken, profile, done) => {
            // Domain validation logic here
            console.log("Access Token:", accessToken);
            console.log("Profile:", profile);

            const emailDomain = profile.emails[0].value.split('@')[1];
            console.log(emailDomain)
            console.log(profile)

            if (allowedDomains.includes(emailDomain)) {
                // User from a valid domain, proceed with authentication
                db.query("SELECT * FROM users WHERE google_id = ?", [profile.id], (err, results) => {
                    if (err) return done(err)

                    if (results.length > 0) { //user exists in DB already
                        console.log(`user exist`)
                        console.log(results[0])
                        return done(null, results[0])
                    } else { //user doesn't exist in DB
                        console.log(`user doesn't exist`)
                        const newUser = {
                            google_id: profile.id,
                            display_name: profile.displayName,
                            email: profile.emails[0].value,
                            photo: profile.photos[0].value
                        }
                        console.log(newUser)
                        db.query("INSERT INTO users SET ?", newUser, (err, results) => {
                            if (err) return done(err);

                            newUser.id = results.insertId;
                            return done(null, newUser);
                        });
                    }
                })
            } else {
                // User from an unauthorized domain, handle appropriately
                console.log(`Unauthorized domain! Use your work email address instead.`)
                return done(null, false, { status: 401, message: 'Unauthorized domain' });
            }
        }));

app.use('/auth', authRouter)

app.get("/", (req, res) => {
    console.log("OK")
    res.send("Response Success!")
});

// a function to start the server  and listen to the port defined
const start = async () => {
    try {
        app.listen(port, () => console.log(`server is running on port ${port}`));
    } catch (error) {
        console.log(error);
    }
};

// call the function
start(); 