const db = require("../var/dbConfig");
const express = require("express");
const router = express.Router();
const { authorization } = require("../middleware/authorization");
const { verifyUserGID } = require("../middleware/verification");
const jwt = require('jsonwebtoken');

router.get("/", (req, res) => {
    console.log("OK");
    res.send("Response Success!");
});

// ------------------------------------- DASHBOARD
//GET Profile Data
router.get("/profile", authorization, verifyUserGID, (req, res) => {
    const { id: idUser } = req.user;

    // Fetch user data and check `form_filled` status
    db.query(
        `SELECT form_filled FROM users WHERE id = ?`,
        [idUser],
        (err, results) => {
            if (err) {
                console.error(err);
                return res.status(500).json({ error: true, message: "Database error" });
            }

            if (results.length === 0) {
                return res.status(404).json({ error: true, message: "User not found" });
            }

            const { form_filled } = results[0];

            // Check if the form has been filled
            if (form_filled === 0) {
                return res.status(400).send({
                    error: true,
                    message: "Profile form not filled. Please complete your profile.",
                });
            }

            // Fetch profile data if form is filled
            db.query(
                `SELECT A.np, A.department, A.role, A.experience_level, B.display_name
                FROM profiles AS A
                JOIN users AS B ON A.user_id = B.id
                WHERE B.id = ?`,
                [idUser],
                (err, result) => {
                    if (err) {
                        return res.status(500).send({ message: err.sqlMessage });
                    }
                    if (!result.length) {
                        return res.status(404).send({ message: "No such data exists" });
                    } else {
                        return res.status(200).send({
                            error: false,
                            message: "Retrieve data success",
                            dashboardResult: result[0],
                        });
                    }
                }
            );
        }
    );
});

//Post profile form
router.post("/form", authorization, verifyUserGID, (req, res) => {
    const { id: idUser } = req.user;

    console.log(req.body);

    const { employeeNumber, department, expLevel, role, userRoleID } = req.body;

    //Check parameter missing
    if (!employeeNumber || !department || !expLevel || !role || !userRoleID) {
        return res.status(400).send({ message: "Parameter missing." });
    }

    db.query(
        `SELECT form_filled, google_id FROM users WHERE id = ?`,
        [idUser],
        (err, results) => {
            if (err) {
                console.error(err);
                return res.status(500).json({ error: true, message: "Database error" });
            }

            if (results.length === 0) {
                return res.status(404).json({ error: true, message: "User not found" });
            }

            const { form_filled, google_id } = results[0]; // Extract form_filled

            // Check if the form has already been filled
            if (form_filled === 1) {
                return res.status(400).json({
                    error: true,
                    message: "You have already filled out this form",
                });
            }

            // Proceed to insert the profile data if the form is not filled
            db.query(
                `INSERT INTO profiles (user_id, department, role, experience_level, np) VALUES (?, ?, ?, ?, ?)`,
                [idUser, department, role, expLevel, employeeNumber],
                (err) => {
                    if (err) {
                        console.error(err);
                        return res
                            .status(500)
                            .json({ error: true, message: "Failed to insert profile data" });
                    }

                    // Update the form_filled status to 1 and set role_id based on userRole
                    db.query(
                        `UPDATE users SET form_filled = 1, role_id = ? WHERE id = ?`,
                        [userRoleID, idUser],
                        (err) => {
                            if (err) {
                                console.error(err);
                                return res
                                    .status(500)
                                    .json({
                                        error: true,
                                        message: "Failed to update user role and form status",
                                    });
                            }

                            // Generate a new JWT token with the updated role_id
                            const newToken = jwt.sign(
                                { user: google_id, role: userRoleID }, // Use the updated role_id
                                process.env.JWT_SECRET || '',
                                { expiresIn: '1h' } // Set the expiration time
                            );

                            return res.status(201).json({
                                error: false,
                                message:
                                    "Profile data successfully created and user role updated",
                                token: newToken,
                            });
                        }
                    );
                }
            );
        }
    );
});

module.exports = router;
