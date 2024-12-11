const db = require("../var/dbConfig");
const express = require("express");
const router = express.Router();
const authorization = require("../middleware/authorization");

router.get("/", (req, res) => {
	console.log("OK");
	res.send("Response Success!");
});

// ------------------------------------- DASHBOARD
//GET Profile Data
router.get("/profile", authorization, (req, res) => {
    let gidUser = req.headers["x-google-id"];
    console.log("Google ID :", gidUser);

    // Check for missing parameter
    if (!gidUser) {
        return res.status(400).send({ message: "Parameter missing (GID)." });
    }

    // Fetch user data and check `form_filled` status
    db.query(
        `SELECT id, form_filled FROM users WHERE google_id = ?`,
        [gidUser],
        (err, results) => {
            if (err) {
                console.error(err);
                return res.status(500).json({ error: true, message: "Database error" });
            }

            if (results.length === 0) {
                return res.status(404).json({ error: true, message: "User not found" });
            }

            const { id: idUser, form_filled } = results[0];

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
router.post("/form", authorization, (req, res) => {
	let gidUser = req.headers["x-google-id"]; 
	console.log("Google ID :", gidUser);

	//Check invalid parameter or parameter missing
	if (!gidUser) {
		return res.status(400).send({ message: "Parameter missing (GID)." });
	}

	console.log(req.body);

	const { employeeNumber, department, expLevel, role } = req.body;

	//Check parameter missing
	if (!employeeNumber || !department || !expLevel || !role) {
		return res.status(400).send({ message: "Parameter missing." });
	}

	db.query(
        `SELECT id, form_filled FROM users WHERE google_id = ?`,
        [gidUser],
        (err, results) => {
            if (err) {
                console.error(err);
                return res.status(500).json({ error: true, message: "Database error" });
            }
    
            if (results.length === 0) {
                return res.status(404).json({ error: true, message: "User not found" });
            }
    
            const { id: idUser, form_filled } = results[0]; // Extract idUser and form_filled
    
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
    
                    // Update the form_filled status to 1 after successful insertion
                    db.query(
                        `UPDATE users SET form_filled = 1 WHERE id = ?`,
                        [idUser],
                        (err) => {
                            if (err) {
                                console.error(err);
                                return res
                                    .status(500)
                                    .json({ error: true, message: "Failed to update form status" });
                            }
    
                            return res.status(201).json({
                                error: false,
                                message: "Profile data successfully created",
                            });
                        }
                    );
                }
            );
        }
    );    
});

module.exports = router;
