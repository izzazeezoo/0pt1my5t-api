const db = require("../var/dbConfig");
const express = require("express");
const router = express.Router();
const authorization = require("../middleware/authorization");
const frontendUrl = process.env.FRONTEND_URL;

router.get("/", (req, res) => {
	console.log("OK");
	res.send("Response Success!");
});

//GET Dashboard (PM) Data
router.get("/dashboard/project_manager", authorization, (req, res) => {
	let gidUser = req.headers["x-google-id"];
	console.log("Google ID1:", gidUser);

	// Check for missing parameter
	if (!gidUser) {
		return res.status(400).send({ message: "Parameter missing (GID)." });
	}

	// Fetch user data and check if the user exists
	db.query(
		`SELECT id FROM users WHERE google_id = "${gidUser}"`,
		(err, results) => {
			if (err) {
				console.error(err);
				return res.status(500).json({ error: true, message: "Database error" });
			}

			if (results.length === 0) {
				return res.status(404).json({ error: true, message: "User not found" });
			}

			const { id: idUser } = results[0];

			// Fetch all projects where the user is a Project Manager
			db.query(
				`SELECT 
        p.id AS project_id, 
        p.project_name, 
        p.project_description, 
        p.contract_num, 
        p.contract_value, 
        p.status,
        t.team_name,
        GROUP_CONCAT(CONCAT(u.display_name, ' (', tm.role, ')') SEPARATOR ', ') AS team_members
    FROM 
        projects p
    JOIN 
        teams t ON p.id = t.project_id
    JOIN 
        team_members tm ON t.id = tm.team_id
    JOIN 
        users u ON tm.user_id = u.id
    WHERE 
        p.pm_id = ?
    GROUP BY 
        p.id, t.id;
    `,
				[idUser],
				(err, result) => {
					if (err) {
						console.error(err);
						return res.status(500).send({ message: "Database query error" });
					}
					if (!result.length) {
						return res
							.status(404)
							.send({ message: "No projects found for this user" });
					} else {
						return res.status(200).send({
							error: false,
							message: "Retrieve data success",
							projects: result, // Array of project cards
						});
					}
				}
			);
		}
	);
});

// POST Create New Project
router.post("/dashboard/project_manager/create", authorization, (req, res) => {
	let gidUser = req.headers["x-google-id"];
	console.log("Google ID:", gidUser);

	// Check for missing parameter
	if (!gidUser) {
		return res.status(400).send({ message: "Parameter missing (GID)." });
	}

	// Extract project details from the request body
	const {
		project_name,
		project_description,
		contract_num,
		contract_value,
		status,
		team_name,
		team_members, // Expected as an array of { user_id, role }
	} = req.body;

	// Validate required fields
	if (
		!project_name ||
		!contract_num ||
		!contract_value ||
		!status ||
		!team_name ||
		!Array.isArray(team_members)
	) {
		return res.status(400).send({ message: "Missing required fields." });
	}

	// Fetch user data and check if the user exists
	db.query(
		`SELECT id FROM users WHERE google_id = ?`,
		[gidUser],
		(err, results) => {
			if (err) {
				console.error(err);
				return res.status(500).json({ error: true, message: "Database error" });
			}

			if (results.length === 0) {
				return res.status(404).json({ error: true, message: "User not found" });
			}

			const { id: idUser } = results[0];

			// Insert new project
			db.query(
				`INSERT INTO projects (project_name, project_description, contract_num, contract_value, status, pm_id) 
                 VALUES (?, ?, ?, ?, ?, ?)`,
				[
					project_name,
					project_description,
					contract_num,
					contract_value,
					status,
					idUser,
				],
				(err, projectResult) => {
					if (err) {
						console.error(err);
						return res
							.status(500)
							.send({ message: "Error inserting project." });
					}

					const projectId = projectResult.insertId;

					// Insert the team
					db.query(
						`INSERT INTO teams (team_name, project_id) VALUES (?, ?)`,
						[team_name, projectId],
						(err, teamResult) => {
							if (err) {
								console.error(err);
								return res
									.status(500)
									.send({ message: "Error inserting team." });
							}

							const teamId = teamResult.insertId;

							// Insert team members
							const teamMemberValues = team_members.map((member) => [
								teamId,
								member.user_id,
								member.role,
							]);

							db.query(
								`INSERT INTO team_members (team_id, user_id, role) VALUES ?`,
								[teamMemberValues],
								(err) => {
									if (err) {
										console.error(err);
										return res
											.status(500)
											.send({ message: "Error inserting team members." });
									}

									return res.status(201).send({
										error: false,
										message: "Project created successfully.",
										project_id: projectId,
									});
								}
							);
						}
					);
				}
			);
		}
	);
});

module.exports = router;
