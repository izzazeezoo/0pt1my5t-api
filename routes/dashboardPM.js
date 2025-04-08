const db = require("../var/dbConfig");
const express = require("express");
const router = express.Router();
const {
	authorization,
	authorizePM,
	authorizeAdmin,
} = require("../middleware/authorization");
const frontendUrl = process.env.FRONTEND_URL;
const {
	verifyUserGID,
	verifyPMRole,
	verifyPrimaryPM,
} = require("../middleware/verification");

//GET Dashboard (PM) Data
// Route: GET /dashboard (PM View)
router.get("/dashboard", authorizePM, verifyUserGID, async (req, res) => {
	const { id: idUser } = req.user;

	try {
		// Step 1: Fetch all projects where the user is either primary PM or part of the team with PM role
		const [projects] = await db.promise().query(
			`
		SELECT DISTINCT p.id AS project_id, p.project_name, p.project_description, 
						c.contract_nums, p.contract_value, p.status, p.size,
						p.pm_id, pm.display_name AS pm_name,
						t.id AS team_id, tr.id AS tribe_id
		FROM projects p
		LEFT JOIN teams t ON p.id = t.project_id
		LEFT JOIN team_members tm ON t.id = tm.team_id
		LEFT JOIN users pm ON p.pm_id = pm.id
		LEFT JOIN (
			SELECT project_id, GROUP_CONCAT(contract_num) AS contract_nums
			FROM contracts
			GROUP BY project_id
		) c ON p.id = c.project_id
		LEFT JOIN tribes tr ON p.id = tr.project_id
		WHERE p.pm_id = ? OR (tm.user_id = ?)
		GROUP BY 
        p.id;
	  `,
			[idUser, idUser]
		);

		const detailedProjects = await Promise.all(
			projects.map(async (proj) => {
				// Step 2: Get ordered team members by rank
				const [teamMembers] = await db.promise().query(
					`
		  SELECT r.name AS rank_name,
				 GROUP_CONCAT(CONCAT(u.display_name, ' (', tm.role, ')') ORDER BY tm.role, u.display_name SEPARATOR ', ') AS members
		  FROM team_members tm
		  JOIN users u ON tm.user_id = u.id
		  JOIN ranks r ON tm.rank = r.rank
		  WHERE tm.team_id = ?
		  GROUP BY r.name
		  ORDER BY r.rank ASC
		`,
					[proj.team_id]
				);

				// Step 3: Get ordered tribe members by job group and experience level
				const [tribeMembers] = await db.promise().query(
					`
		  SELECT r.name AS rank_name, pr.job_group, pr.experience_level, 
		  GROUP_CONCAT(CONCAT(u.display_name, 
            CASE 
                WHEN r.name != 'ANGGOTA' AND tm.role IS NOT NULL 
                THEN CONCAT(' (', tm.role, ')') 
                ELSE '' 
            END
        ) ORDER BY u.display_name SEPARATOR ', ') AS members,
		 COUNT(*) AS count
		  FROM tribe_members tm
		  JOIN users u ON tm.user_id = u.id
		  JOIN ranks r ON tm.rank = r.rank
		  JOIN profiles pr ON u.id = pr.user_id
		  WHERE tm.tribe_id = ?
		  GROUP BY r.name, pr.job_group, pr.experience_level
		  ORDER BY r.rank ASC, pr.job_group ASC,
				   FIELD(pr.experience_level, 'Senior', 'Middle', 'Junior')
		`,
					[proj.tribe_id]
				);

				return {
					...proj,
					team_structure: teamMembers.map(
						(t) => `${t.rank_name} : ${t.members}`
					),
					tribe_structure: groupTribeMembers(tribeMembers),
				};
			})
		);

		return res.status(200).send({
			error: false,
			message: "Retrieve data success",
			projects: detailedProjects,
		});
	} catch (err) {
		console.error(err);
		return res.status(500).send({ message: "Server error" });
	}
});

// Helper function to group tribe members by job group and experience level
function groupTribeMembers(rows) {
	const result = {};

	// Process leadership roles (non-MEMBER)
	rows.forEach((row) => {
		if (row.rank_name.toUpperCase() !== "ANGGOTA") {
			if (!result[row.rank_name]) {
				result[row.rank_name] = [];
			}
			result[row.rank_name].push({
				name: row.members,
				job_group: row.job_group,
				role: row.role,
			});
		}
	});

	// Process MEMBER roles (grouped by job_group and experience_level)
	const memberGroups = {};
	rows.forEach((row) => {
		if (row.rank_name.toUpperCase() === "ANGGOTA") {
			if (!memberGroups[row.job_group]) memberGroups[row.job_group] = [];
			memberGroups[row.job_group].push(
				`${row.experience_level} (${row.count}): ${row.members}`
			);
		}
	});

	// Structure the member section
	if (Object.keys(memberGroups).length > 0) {
		result.ANGGOTA = Object.entries(memberGroups).map(([jobGroup, details]) => {
			return { job_group: jobGroup, levels: details };
		});
	}

	return result;
}

// Helper function to promisify queries
function queryAsync(query, values) {
	return new Promise((resolve, reject) => {
		db.query(query, values, (err, result) => {
			if (err) return reject(err);
			resolve(result);
		});
	});
}

// PUT Route to Update a Project
router.put(
	"/project/:projectId",
	authorizePM,
	verifyUserGID,
	verifyPrimaryPM,
	async (req, res) => {
		let project_id = parseInt(req.params.projectId); // ID Project
		const { id: pm_id } = req.user;
		const {
			project_name,
			project_description,
			contract_num,
			contract_value,
			status,
			size,
		} = req.body;

		// Validate input fields
		if (
			!project_name ||
			!project_description ||
			!contract_num ||
			!contract_value ||
			!status ||
			!size ||
			!project_id
		) {
			return res.status(400).send({ message: "Missing required fields." });
		}

		// Convert contract_num to array if needed
		let contractNums = [];
		if (Array.isArray(contract_num)) {
			contractNums = contract_num;
		} else if (typeof contract_num === "string") {
			contractNums = contract_num
				.split(",")
				.map((cn) => cn.trim())
				.filter(Boolean);
		}

		try {
			// Update the project
			const updateResult = await queryAsync(
				`UPDATE projects 
                 SET project_name = ?, project_description = ?, contract_value = ?, status = ?, size = ?
                 WHERE id = ?`,
				[
					project_name,
					project_description,
					contract_value,
					status,
					size,
					project_id,
				]
			);

			if (updateResult.affectedRows === 0) {
				return res
					.status(404)
					.send({ message: "Project not found or no changes made." });
			}

			// Update contracts: delete old ones, insert new ones
			await queryAsync(`DELETE FROM contracts WHERE project_id = ?`, [
				project_id,
			]);

			if (contractNums.length > 0) {
				const contractValues = contractNums.map((cn) => [project_id, cn]);
				await queryAsync(
					`INSERT INTO contracts (project_id, contract_num) VALUES ?`,
					[contractValues]
				);
			}

			return res.status(200).send({
				message: "Project and contracts updated successfully",
				project_id: project_id,
			});
		} catch (err) {
			console.error(err);
			return res.status(500).send({ message: "Internal server error." });
		}
	}
);

// POST Route for Team Member Recommendation
router.post("/team/find/:teamId", authorizePM, verifyUserGID, (req, res) => {
	let team_id = parseInt(req.params.teamId); //ID Team
	const { id: pm_id } = req.user; // Current user's PM ID
	const { role, required_count, co_pm_id } = req.body;

	if (!role || !required_count || !team_id) {
		return res
			.status(400)
			.send({ message: "Role, required count, and team ID are required." });
	}

	// To fetch 2n + 1 matching profiles
	db.query(
		`
        SELECT 
            u.id, u.display_name, p.role, p.np, p.experience_level, COUNT(tm.user_id) AS project_count
        FROM 
            users u
        JOIN 
            profiles p ON u.id = p.user_id
        LEFT JOIN 
            team_members tm ON u.id = tm.user_id
        WHERE 
            p.role = ? 
            AND u.id NOT IN (
                SELECT user_id 
                FROM team_members 
                WHERE team_id = ?
            ) AND u.id != ?
			 AND u.id NOT IN (
                SELECT user_id 
                FROM team_members 
                WHERE team_id = ?
            ) AND u.id != ?
        GROUP BY 
            u.id, p.role, p.np, p.experience_level
        ORDER BY 
            project_count ASC, FIELD(p.experience_level, 'Senior', 'Middle', 'Junior') ASC
        LIMIT ?
        `,
		[role, team_id, pm_id, team_id, co_pm_id, required_count * 2 + 1],
		(err, results) => {
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

// GET Route for Find All PMs
router.get("/team/find/allPM", authorizePM, verifyUserGID, (req, res) => {
	const { id: pm_id } = req.user; // Current user's PM ID

	db.query(
		`
        SELECT 
            u.id AS user_id, u.display_name
        FROM 
            users u
        JOIN 
            profiles p ON u.id = p.user_id
        JOIN roles r ON u.role_id = r.id
        WHERE 
            r.role_name IN ('project manager', 'program manager') 
            AND u.id != ?
        ORDER BY 
            u.display_name ASC;
        `,
		[pm_id], // Exclude the current user
		(err, results) => {
			if (err) {
				console.error(err);
				return res.status(500).send({ message: "Database error" });
			}

			if (results.length === 0) {
				return res
					.status(404)
					.send({ message: "No Project Managers or Program Managers found." });
			}

			return res.status(200).send({
				message: "Project Managers retrieved successfully.",
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

router.post("/task", authorizePM, (req, res) => {
	const {
		task_name,
		task_description,
		attachments,
		due_date,
		project_id,
		team_members,
	} = req.body;

	// Validate input
	if (
		!task_name ||
		!due_date ||
		!project_id ||
		!Array.isArray(team_members) ||
		team_members.length === 0
	) {
		return res.status(400).send({
			message:
				"Task name, due date, project ID, and at least one team member are required.",
		});
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
				return res
					.status(500)
					.send({ message: "Database error while inserting task." });
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
						return res
							.status(500)
							.send({ message: "Database error while assigning task." });
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
