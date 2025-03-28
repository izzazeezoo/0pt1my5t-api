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

        res.cookie('google_id', google_id, { secure: false });
        res.cookie('display_name', display_name, { secure: false });
        res.cookie('photo', encodeURIComponent(photo), { secure: false });

        // Query the database to check `form_filled` and `role_id`
        db.query(
            'SELECT form_filled, role_id FROM users WHERE google_id = ?',
            [google_id],
            (err, results) => {
                if (err) {
                    console.error('Error:', err);
                    return res.status(500).send({ error: true, msg: 'Internal server error' });
                }

                if (!results.length) {
                    return res.status(404).send({ error: true, msg: 'User not found' });
                }
                
                const { form_filled, role_id } = results[0]; 
                res.cookie('user_role', role_id, { secure: false });

                // Generate and save JWT token
                //const token = jwt.sign({ user: google_id }, process.env.JWT_SECRET || '', { expiresIn: '1h' });
                const token = jwt.sign(
                    { user: google_id, role: role_id }, // Add the role to the payload
                    process.env.JWT_SECRET || '',
                    { expiresIn: '1h' }
                );
                res.cookie('jwtToken', token, { secure: false });

                const responseData = {
                    error: false,
                    data: {
                        google_id,
                        display_name,
                        photo: encodeURIComponent(photo),
                        user_role: role_id,
                        token,
                    },
                };
                console.log(responseData);
                
                if (form_filled === 0) {  // If form_filled is 0, return 202 status
                    console.log('Form not filled. Returning HTTP 202.');
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
                    case 4:
                        return res.redirect(`${frontendUrl}/dashboard/project_admin`);
                    case 5:
                        return res.redirect(`${frontendUrl}/dashboard/dept_head`);
                    default:
                        return res.status(403).send({ error: true, msg: 'Invalid role' });
                }
            }
        );
    }
);

authRouter.get('/unauthorized', (req, res) => {
    res.redirect(`${frontendUrl}/unauthorized`);
});

authRouter.post('/logout', (req, res) => {
    res.clearCookie('jwtToken', { path: '/' });
    res.clearCookie('google_ID', { path: '/' });
    res.clearCookie('photo', { path: '/' });
    res.clearCookie('display_name', { path: '/' });
    res.status(200).send({ message: "Logged out successfully" });
});

module.exports = authRouter;