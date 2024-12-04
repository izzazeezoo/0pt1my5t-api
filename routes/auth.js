const passport = require('passport');
const jwt = require('jsonwebtoken');
const express = require('express');
const db  = require('../var/dbConfig');

const authRouter = express.Router();

authRouter.get('/google', passport.authenticate("google", {
    scope: ["profile", "email"] ,
    prompt: "consent"
}))

authRouter.get(
    '/google/callback',
    passport.authenticate('google', { failureRedirect: '/auth/unauthorized' }),
    (req, res) => {
        // Save google_id in a cookie
        res.cookie('google_id', req.user.google_id, { httpOnly: true, secure: false }); // Set secure to true in production
        res.cookie('google_id', req.user.google_id, { httpOnly: true, secure: false });
        console.log("Saved google_id in cookie:", req.user.google_id);

        // Generate and save the JWT token in cookie
        const token = jwt.sign({ user: req.user.google_id }, process.env.JWT_SECRET || '', { expiresIn: '1h' });
        res.cookie('jwtToken', token, { httpOnly: true, secure: false });
        console.log("Saved generated token in cookies: => " + token);

        // Query the database to check `form_filled`
        db.query(
            'SELECT form_filled FROM users WHERE google_id = ?',
            [req.user.google_id],
            (err, results) => {
                if (err) {
                    console.error('Database query failed:', err);
                    return res.status(500).send({ error: true, msg: 'Internal server error' });
                }

                if (results.length > 0 && results[0].form_filled === 0) {
                    // If form_filled is 0, return 202 status
                    console.log('Form not filled. Returning HTTP 202.');
                    return res.status(202).send({
                        error: false,
                        msg: 'Authentication successful, but form needs to be filled.',
                    });
                } else {
                    // If form_filled is not 0, return 200 status
                    console.log('Form already filled. Returning HTTP 200.');
                    return res.status(200).send({
                        error: false,
                        msg: 'Authentication via Google OAuth success',
                    });
                }
            }
        );
    }
);

authRouter.get('/unauthorized', (req, res) => {
    return res.status(401).json({
        error: true,
        message: 'Unauthorized: Please use your work email address.',
    });
});

module.exports = authRouter;