const db = require("../var/dbConfig");
const express = require("express");
const router = express.Router();
const {
	authorization,
	authorizePM,
	authorizeAdmin,
} = require("../middleware/authorization");
const frontendUrl = process.env.FRONTEND_URL;

router.get("/", authorization, (req, res) => {
	console.log("OK");
	res.send("Response Success!");
});

/*
// POST Route for Team Approval - WIP
router.post("/team/approve", authorizePM, (req, res) => {
    const { team_id } = req.body;

    if (!team_id) {
        return res.status(400).send({ message: "Team ID is required." });
    }

    // Verify user has portfolio_manager role
    let gidUser = req.headers["x-google-id"];
    db.query(
        `SELECT role_name 
        FROM users u
        JOIN 
        roles r ON r.id = u.role_id
        WHERE google_id = ?`,
        [gidUser],
        (err, results) => {
            if (err) {
                console.error(err);
                return res.status(500).send({ message: "Database error while verifying role" });
            }

            if (results[0].role !== "admin") { //admin or portfolio_manager
                return res.status(403).send({ message: "Unauthorized: Only portfolio managers can approve teams." });
            }

            // Update team status to "official"
            db.query(
                `UPDATE teams SET status = 'official' WHERE id = ?`,
                [team_id],
                (err) => {
                    if (err) {
                        console.error(err);
                        return res.status(500).send({ message: "Database error while updating team status" });
                    }

                    return res.status(200).send({ message: "Team approved successfully." });
                }
            );
        }
    );
});
*/

module.exports = router;
