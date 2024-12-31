const db = require("../var/dbConfig");
const express = require("express");
const router = express.Router();
const {
	authorization,
	authorizePM,
	authorizeAdmin,
} = require("../middleware/authorization");
const frontendUrl = process.env.FRONTEND_URL;

//GET Dashboard (PM) Data
router.get("/dashboard", authorizePM, (req, res) => {
	let gidUser = req.headers["x-google-id"];

	// Check for missing parameter
	if (!gidUser) {
		return res.status(400).send({ message: "Parameter missing (GID)." });
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

			// Fetch all projects where the user is a Project Manager
			db.query(
				`
    SELECT 
        p.id AS project_id, p.project_name, p.project_description, p.contract_num, 
        p.contract_value, p.status, t.team_name,
        GROUP_CONCAT(CONCAT(u.display_name, ' (', tm.role, ')') SEPARATOR ', ') AS team_members
    FROM 
        projects p
    LEFT JOIN 
        teams t ON p.id = t.project_id
    LEFT JOIN 
        team_members tm ON t.id = tm.team_id
    LEFT JOIN 
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
						return res.status(500).send({ message: "Database error" });
					}
					if (!result.length) {
						return res
							.status(404)
							.send({ message: "No projects found for this user" });
					} else {
						console.log(result); //console log result
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

// POST Route to Create a New Project
router.post("/project", authorizePM, (req, res) => {
	const gidUser = req.headers["x-google-id"];
	const {
		project_name,
		project_description,
		co_pm_id,
		contract_num,
		contract_value,
	} = req.body;

	// Check for missing parameter
	if (!gidUser) {
		return res.status(400).send({ message: "Parameter missing (GID)." });
	}

	// Validate input fields
	if (
		!project_name ||
		!project_description ||
		!contract_num ||
		!contract_value
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

			const { id: pm_id } = results[0];

			// If co_pm_id is provided, verify their role
			if (co_pm_id) {
				db.query(
					`SELECT role_id FROM users WHERE id = ?`,
					[co_pm_id],
					(err, coPmResults) => {
						if (err) {
							console.error(err);
							return res
								.status(500)
								.send({ message: "Database error while verifying co_pm_id" });
						}

						if (coPmResults.length === 0 || coPmResults[0].role_id !== 3) {
							//project manager
							return res.status(403).send({
								message: "co_pm_id is not authorized as a project manager.",
							});
						}

						// Proceed to create the project
						insertProject(pm_id);
					}
				);
			} else {
				// Proceed to create the project if no co_pm_id is provided
				insertProject(pm_id);
			}

			// Function to insert the project
			function insertProject(pm_id) {
				db.query(
					`INSERT INTO projects (project_name, project_description, pm_id, co_pm_id, contract_num, contract_value, status) 
                    VALUES (?, ?, ?, ?, ?, ?, 'Project Initiation')`,
					[
						project_name,
						project_description,
						pm_id,
						co_pm_id,
						contract_num,
						contract_value,
					],
					(err, result) => {
						if (err) {
							console.error(err);
							return res
								.status(500)
								.send({ message: "Database insertion error" });
						}

						// Redirect to the created project's page
						const projectId = result.insertId; // Get the ID of the newly inserted project
						return res.status(201).send({
							message: "Project created successfully.",
							redirect: `${frontendUrl}/dashboard/project/${projectId}`,
							project_id: projectId,
						});
					}
				);
			}
		}
	);
});

// POST Route for Team Member Recommendation
router.post("/team/find", authorizePM, (req, res) => {
	const { role, required_count } = req.body;

	if (!role || !required_count) {
		return res
			.status(400)
			.send({ message: "Role and required count are required." });
	}

	console.log("BUTUH", role, required_count);

	// Query the database to fetch 2n + 1 matching profiles
	db.query(
		`
    SELECT 
        u.id,  u.display_name, p.role, p.np, p.experience_level, COUNT(tm.user_id) AS project_count
    FROM 
        users u
    JOIN 
        profiles p ON u.id = p.user_id
    LEFT JOIN 
        team_members tm ON u.id = tm.user_id
    WHERE 
        p.role = ?
    GROUP BY 
        u.id, p.role, p.np, p.experience_level
    ORDER BY 
        project_count ASC, FIELD(p.experience_level, 'Senior', 'Middle', 'Junior') DESC
    LIMIT ?
        `,
		[role, required_count * 2 + 1],
		(err, results) => {
			console.log(results);
			if (err) {
				console.error(err);
				return res.status(500).send({ message: "Database error" });
			}

			if (results.length === 0) {
				return res
					.status(404)
					.send({ message: "No profiles found matching the role." });
			}

			return res.status(200).send({
				message: "Profiles retrieved successfully.",
				profiles: results,
			});
		}
	);
});

// POST Route for Assigning Team Members
router.post("/team/assign", authorizePM, (req, res) => {
	const { team_id, members } = req.body;

	if (!team_id || !members || !Array.isArray(members)) {
		return res
			.status(400)
			.send({ message: "Team ID and members are required." });
	}

	// Insert each member into the team_members table
	const values = members.map((member) => [
		team_id,
		member.user_id,
		member.role,
	]);
	db.query(
		`INSERT INTO team_members (team_id, user_id, role) VALUES ?`,
		[values],
		(err) => {
			if (err) {
				console.error(err);
				return res.status(500).send({ message: "Database error" });
			}

			return res.status(201).send({
				message:
					"Members assigned successfully. Current Status: Waiting for Approval.",
			});
		}
	);
});

module.exports = router;
