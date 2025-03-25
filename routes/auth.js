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

        // Query the database to check `form_filled` and `role_id`
        db.query(
            'SELECT form_filled, role_id FROM users WHERE google_id = ?',
            [google_id],
            (err, results) => {
                if (err) {
                    console.error('Error:', err);
                    return res.status(500).json({ error: true, message: 'Internal Server Error' });
                }

                if (!results.length) {
                    return res.status(404).json({ error: true, message: 'User not found' });
                }

                const { form_filled, role_id } = results[0];

                // Generate JWT token
                const token = jwt.sign(
                    { user: google_id, role: role_id }, // Add the role to the payload
                    process.env.JWT_SECRET || '',
                    { expiresIn: '1h' }
                );

                // Prepare the response data
                const responseData = {
                    error: false,
                    message: 'Login successful',
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
                    responseData.redirect = `${frontendUrl}/form`;
                } else {
                    // Role-based redirection
                    switch (role_id) {
                        case 1: // Admin
                            responseData.redirect = `${frontendUrl}/dashboard/admin`;
                            break;
                        case 2: // Team Member
                            responseData.redirect = `${frontendUrl}/dashboard/team_member`;
                            break;
                        case 3: // Project Manager
                            responseData.redirect = `${frontendUrl}/dashboard/project_manager`;
                            break;
                        case 4: // Project Admin
                            responseData.redirect = `${frontendUrl}/dashboard/project_admin`;
                            break;
                        case 5: // Department Head
                            responseData.redirect = `${frontendUrl}/dashboard/dept_head`;
                            break;
                        default:
                            return res.status(403).json({ error: true, message: 'Invalid role' });
                    }
                }

                // Send the response
                return res.status(200).json(responseData);
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