const db = require("../var/dbConfig");
const express = require("express");
const router = express.Router();
const {
	authorization,
	authorizePM,
	authorizeAdmin,
} = require("../middleware/authorization");
const frontendUrl = process.env.FRONTEND_URL;
const { verifyUserGID, verifyCoPMRole } = require("../middleware/verification");

//GET Dashboard (PM) Data
router.get("/dashboard", authorizePM, verifyUserGID, (req, res) => {
	const { id: idUser } = req.user;

	// Fetch all projects where the user is a Project Manager
	db.query(
		`
    SELECT 
        p.id AS project_id, p.project_name, p.project_description, p.pm_id, p.co_pm_id, p.contract_num, 
        p.contract_value, p.status, t.team_name, t.id AS team_id,
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
				return res.status(200).send({
					error: false,
					message: "Retrieve data success",
					projects: result,
				});
			}
		}
	);
});

// POST Route to Create a New Project
router.post("/project", authorizePM, verifyUserGID, async (req, res) => {
	const { id: pm_id } = req.user;
	const {
		project_name,
		project_description,
		co_pm_id,
		contract_num,
		contract_value,
	} = req.body;

	// Validate input fields
	if (
		!project_name ||
		!project_description ||
		!contract_num ||
		!contract_value
	) {
		return res.status(400).send({ message: "Missing required fields." });
	}

	try {
		// If co_pm_id is provided, verify their role
		if (co_pm_id) {
			const isCoPMAuthorized = await verifyCoPMRole(co_pm_id);

			if (!isCoPMAuthorized) {
				return res.status(403).send({
					message: "co_pm_id is not authorized as a project manager.",
				});
			}
		}

		// Proceed to create the project and team
		const { projectId, teamId } = await createProjectAndTeam(
			project_name,
			project_description,
			pm_id,
			co_pm_id,
			contract_num,
			contract_value
		);

		return res.status(201).send({
			message: "Project and Team created successfully.",
			redirect: `${frontendUrl}/dashboard/project/${projectId}`,
			project_id: projectId,
			team_id: teamId,
			team_name: `Team ${project_name}`,
		});
	} catch (err) {
		console.error(err);
		return res.status(500).send({ message: "Internal server error." });
	}
});

// Function to insert the project and create the team
async function createProjectAndTeam(
	project_name,
	project_description,
	pm_id,
	co_pm_id,
	contract_num,
	contract_value
) {
	return new Promise((resolve, reject) => {
		// Insert the project
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
					return reject(new Error("Database insertion error"));
				}

				const projectId = result.insertId; // Get the ID of the newly inserted project
				const team_name = `Team ${project_name}`;

				// Now insert the team for this project
				db.query(
					`INSERT INTO teams (team_name, project_id) VALUES (?, ?)`,
					[team_name, projectId],
					(err) => {
						if (err) {
							return reject(new Error("Database error while creating team"));
						}
						resolve({ projectId, team_name });
					}
				);
			}
		);
	});
}

// POST Route to Create a New Project
<<<<<<< HEAD
router.post("/project/edit", authorizePM, verifyUserGID, async (req, res) => {
	const { id: pm_id } = req.user;
	const {
		project_name,
		project_description,
		co_pm_id,
		contract_num,
		contract_value,
		project_status,
		project_id,
	} = req.body;

	// Validate input fields
	if (
		!project_name ||
		!project_description ||
		!contract_num ||
		!contract_value ||
		!typeof pm_id === String
	) {
		return res.status(400).send({ message: "Missing required fields." });
	}

	try {
		// If co_pm_id is provided, verify their role
		if (co_pm_id) {
			const isCoPMAuthorized = await verifyCoPMRole(co_pm_id);

			if (!isCoPMAuthorized) {
				return res.status(403).send({
					message: "co_pm_id is not authorized as a project manager.",
				});
			}
		}

		db.query(
			`UPDATE projects SET 
            project_name, 
            project_description, 
            pm_id, co_pm_id, 
            contract_num, 
            contract_value,
            status 
            VALUES (?, ?, ?, ?, ?, ?, ?)
            WHERE project_id = ?`,
			[
				project_name,
				project_description,
				pm_id,
				co_pm_id,
				contract_num,
				contract_value,
				project_status,
				project_id,
			]
		);

		return res.status(201).send({
			message: "Project updated successfully.",
			// redirect: `${frontendUrl}/dashboard/`,
			// redirect: `${frontendUrl}/dashboard/project/${project_id}`,
			// project_id: projectId,
			// team_id: teamId,
			// team_name: `Team ${project_name}`,
		});
	} catch (err) {
		console.error(err);
		return res.status(500).send({ message: "Internal server error." });
	}
});
=======
router.put("/project/:projectId", authorizePM, verifyUserGID, async (req, res) => {
    let project_id = parseInt(req.params.projectId); //ID Project
    const { id: pm_id } = req.user;
    const { project_name, project_description, co_pm_id, contract_num, contract_value, project_status} = req.body;

    // Validate input fields
    if (!project_name || !project_description || !contract_num || !contract_value || !project_status || !project_id) {
        return res.status(400).send({ message: "Missing required fields." });
    }

    try {
        // If co_pm_id is provided, verify their role
        if (co_pm_id) {
            const isCoPMAuthorized = await verifyCoPMRole(co_pm_id);

            if (!isCoPMAuthorized) {
                return res.status(403).send({ message: "co_pm_id is not authorized as a project manager." });
            }
        }

        db.query(
            `UPDATE projects 
             SET project_name = ?, project_description = ?, pm_id = ?, co_pm_id = ?, contract_num = ?, contract_value = ?, status = ? 
             WHERE id = ?`,
            [project_name, project_description, pm_id, co_pm_id, contract_num, contract_value, project_status, project_id],
            (err, result) => {
                if (err) {
                    console.error(err);
                    return res.status(500).send({ message: "Database update error" });
                }
    
                // Check if any rows were affected
                if (result.affectedRows === 0) {
                    return res.status(404).send({ message: "Project not found or no changes made." });
                }
    
                return res.status(200).send({ message: "Project updated successfully", project_id: project_id });
            }
        );
    } catch (err) {
        console.error(err);
        return res.status(500).send({ message: "Internal server error." });
    }
});

// PUT Route to Update an Existing Project
router.put("/project/:id", authorizePM, (req, res) => {
    const projectId = req.params.id;
    const { project_name, project_description, pm_id, co_pm_id, contract_num, contract_value, status } = req.body;

    // Validate input fields
    if (!project_name || !project_description || !contract_num || !contract_value || !pm_id) {
        return res.status(400).send({ message: "Missing required fields." });
    }

    // Query to update the project
    db.query(
        `UPDATE projects 
         SET project_name = ?, project_description = ?, pm_id = ?, co_pm_id = ?, contract_num = ?, contract_value = ?, status = ? 
         WHERE id = ?`,
        [project_name, project_description, pm_id, co_pm_id, contract_num, contract_value, status || 'Project Initiation', projectId],
        (err, result) => {
            if (err) {
                console.error(err);
                return res.status(500).send({ message: "Database update error" });
            }

            // Check if any rows were affected
            if (result.affectedRows === 0) {
                return res.status(404).send({ message: "Project not found or no changes made." });
            }

            res.status(200).send({ message: "Project updated successfully", project_id: projectId });
        }
    );
});

>>>>>>> c4969128bc5fa5826ac0dcf7ef9ae36cfc1a17fa

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
	console.log(values);
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

<<<<<<< HEAD
module.exports = router;
=======
router.post("/task", authorizePM, (req, res) => {
    const { task_name, task_description, attachments, due_date, project_id, team_members } = req.body;

    // Validate input
    if (!task_name || !due_date || !project_id || !Array.isArray(team_members) || team_members.length === 0) {
        return res.status(400).send({ message: "Task name, due date, project ID, and at least one team member are required." });
    }

    // Insert task into the database
    const attachmentLinks = attachments ? JSON.stringify(attachments) : null;

    console.log(attachmentLinks);
    console.log(project_id);

    db.query(
        `INSERT INTO tasks (task_name, task_description, attachments, due_date, project_id) VALUES (?, ?, ?, ?, ?)`,
        [task_name, task_description, attachmentLinks, due_date, project_id],
        (err, result) => {
            if (err) {
                console.error(err);
                return res.status(500).send({ message: "Database error while inserting task." });
            }

            const taskId = result.insertId;

            // Prepare values for task assignments
            const taskAssignments = team_members.map((userId) => [taskId, userId]);

            // Insert task assignments
            db.query(
                `INSERT INTO task_assignments (task_id, user_id) VALUES ?`,
                [taskAssignments],
                (err) => {
                    if (err) {
                        console.error(err);
                        return res.status(500).send({ message: "Database error while assigning task." });
                    }

                    res.status(201).send({
                        message: "Task assigned successfully.",
                        assigned_to: team_members,
                    });
                }
            );
        }
    );
});

module.exports = router;
>>>>>>> c4969128bc5fa5826ac0dcf7ef9ae36cfc1a17fa
