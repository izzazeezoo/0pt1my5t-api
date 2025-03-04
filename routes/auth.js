const passport = require('passport');
const jwt = require('jsonwebtoken');
const express = require('express');
const db = require('../var/dbConfig');
const frontendUrl = process.env.FRONTEND_URL;

const authRouter = express.Router();

authRouter.get('/google', passport.authenticate("google", {
    scope: ["profile", "email"],
    prompt: "consent"
}))

authRouter.get(
    '/google/callback',
    passport.authenticate('google', { failureRedirect: '/auth/unauthorized' }),
    (req, res) => {
        const { google_id, display_name, photo } = req.user;
        // Save google_id in a cookie
        //res.cookie('google_id', google_id, { httpOnly: true, secure: false }); // Set secure to true in production
        res.cookie('google_id', google_id, { secure: false });
        // Save display_name in a cookie
        res.cookie('display_name', display_name, { secure: false });
        // Save photo in a cookie
        res.cookie('photo', encodeURIComponent(photo), { secure: false });
        console.log("Cookies: google_id", google_id, "display_name: ",display_name, "photo: ",  photo);

        // Query the database to check `form_filled` and `role_id`
        db.query(
            'SELECT form_filled, role_id FROM users WHERE google_id = ?',
            [google_id],
            (err, results) => {
                if (err) {
                    console.error('Error:', err);
                    alert('Error 500: Internal Server Error');
                    //return res.status(500).send({ error: true, msg: 'Internal server error' });
                }

                if (!results.length) {
                    return res.status(404).send({ error: true, msg: 'User not found' });
                }
                
                const { form_filled, role_id } = results[0]; 
                res.cookie('user_role', role_id, { secure: false });
                console.log("Saved user role in cookie:", role_id);

                // Generate and save JWT token
                //const token = jwt.sign({ user: google_id }, process.env.JWT_SECRET || '', { expiresIn: '1h' });
                const token = jwt.sign(
                    { user: google_id, role: role_id }, // Add the role to the payload
                    process.env.JWT_SECRET || '',
                    { expiresIn: '1h' }
                );
                res.cookie('jwtToken', token, { secure: false });
                console.log("generated token in cookie:", token);
                
                if (form_filled === 0) {  // If form_filled is 0, return 202 status
                    console.log('Form not filled. Returning HTTP 202.');
                    /*return res.status(202).send({
                        error: false,
                        msg: 'Authentication successful, but form needs to be filled.',
                    });*/
                    res.redirect(`${frontendUrl}/form`);
                } 

                // Role-based redirection
                switch (role_id) {
                    case 1: // Admin
                        return res.redirect(`${frontendUrl}/dashboard/admin`);
                    case 2: // Team Member
                        return res.redirect(`${frontendUrl}/dashboard/team_member`);
                    case 3: // Project Manager
                        return res.redirect(`${frontendUrl}/dashboard/project_manager`);
                    default:
                        return res.status(403).send({ error: true, msg: 'Invalid role' });
                }


            }
        );
    }
);

authRouter.get('/unauthorized', (req, res) => {
    res.redirect(`${frontendUrl}/unauthorized`);
    /*return res.status(401).json({
        error: true,
        message: 'Unauthorized: Please use your work email address.',
    });*/
});

authRouter.post('/logout', (req, res) => {
    res.clearCookie('jwtToken', { path: '/' });
    res.clearCookie('google_ID', { path: '/' });
    res.clearCookie('photo', { path: '/' });
    res.clearCookie('display_name', { path: '/' });
    res.status(200).send({ message: "Logged out successfully" });
});

module.exports = authRouter;