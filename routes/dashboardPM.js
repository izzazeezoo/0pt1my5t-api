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

// GET Route for Find All in PMO
router.get(
	"/team/find/allPMO/:teamId",
	authorizePM,
	verifyUserGID,
	(req, res) => {
		const { id: pm_id } = req.user; // Current user's PM ID
		const team_id = parseInt(req.params.teamId);

		db.query(
			`
        SELECT 
            u.id AS user_id, u.display_name, p.role
        FROM 
            users u
        JOIN 
            profiles p ON u.id = p.user_id
        JOIN roles r ON u.role_id = r.id
        WHERE 
			p.job_group = 'PMO'
            AND u.id != ?
			AND u.id NOT IN (
                SELECT user_id 
                FROM team_members 
                WHERE team_id  = ?
            ) 
        ORDER BY 
            u.display_name ASC;
        `,
			[pm_id, team_id], // Exclude the current user
			(err, results) => {
				if (err) {
					console.error(err);
					return res.status(500).send({ message: "Database error" });
				}

				if (results.length === 0) {
					return res.status(404).send({
						message: "No Project Managers or Program Managers found.",
					});
				}

				return res.status(200).send({
					message: "Project Managers retrieved successfully.",
					profiles: results,
				});
			}
		);
	}
);

// POST Route for Assigning Team Members with Rank - Management Office
router.post("/team/assign", authorizePM, async (req, res) => {
	const { team_id, members } = req.body;

	if (!team_id || !members || !Array.isArray(members)) {
		return res
			.status(400)
			.send({ message: "Team ID and members are required." });
	}

	try {
		// 1. Check if there's already a Program Manager in the team
		const existingPMs = await queryAsync(
			`SELECT * FROM team_members WHERE team_id = ? AND role = 'Program Manager'`,
			[team_id]
		);

		// 2. Check if any member being assigned is a PM
		const incomingPMs = members.filter((m) => m.role === "Program Manager");
		if (existingPMs.length > 0 && incomingPMs.length > 0) {
			return res.status(400).send({
				message: "This team already has a Program Manager assigned.",
			});
		}

		// 3. Get existing members to avoid reassigning
		const existingMembers = await queryAsync(
			`SELECT user_id FROM team_members WHERE team_id = ?`,
			[team_id]
		);
		const existingUserIds = new Set(existingMembers.map((m) => m.user_id));

		// 4. Filter out members already in the team
		const newMembers = members.filter((m) => !existingUserIds.has(m.user_id));

		// 5. If nothing to insert
		if (newMembers.length === 0) {
			return res.status(400).send({
				message: "Selected users are already assigned to the team.",
			});
		}

		// 6. Prepare insert values with rank logic
		const values = newMembers.map((member) => {
			const rank = member.role === "Program Manager" ? 1 : 99;
			return [team_id, member.user_id, member.role, rank];
		});

		// 7. Insert new members
		await queryAsync(
			`INSERT INTO team_members (team_id, user_id, role, rank) VALUES ?`,
			[values]
		);

		return res.status(201).send({
			message:
				"Members assigned successfully. Current Status: Waiting for Approval.",
			assigned: newMembers.map((m) => m.user_id),
		});
	} catch (err) {
		console.error(err);
		return res.status(500).send({ message: "Database error." });
	}
});

// POST Route for Tribe Member Recommendation
router.post("/tribe/find/:tribeId", authorizePM, verifyUserGID, (req, res) => {
	const tribe_id = parseInt(req.params.tribeId);
	const { id: pm_id } = req.user;
	const { job_group, experience_level, required_count, role } = req.body;

	console.log(req.body);
	if (!job_group || !experience_level || !required_count || !tribe_id) {
		return res.status(400).send({
			message:
				"Job group, experience level, required count, and team ID are required.",
		});
	}

	// Base query with workload calculation
	let query = `
        SELECT 
            u.id, 
            u.display_name, 
            p.role, 
            p.np, 
            p.experience_level,
            COALESCE(SUM(
                CASE 
                    WHEN prj.size = 'Small' THEN 1
                    WHEN prj.size = 'Medium' THEN 1.5
                    WHEN prj.size = 'Big' THEN 2
                    ELSE 1
                END
            ), 0) AS workload_score
        FROM 
            users u
        JOIN 
            profiles p ON u.id = p.user_id
        LEFT JOIN 
            tribe_members tm ON u.id = tm.user_id
        LEFT JOIN
            tribes t ON tm.tribe_id = t.id
        LEFT JOIN
            projects prj ON t.project_id = prj.id
        WHERE 
            p.job_group = ?
            AND p.experience_level = ?
            ${role ? "AND p.role = ?" : ""}
            AND u.id NOT IN (
                SELECT user_id 
                FROM tribe_members 
                WHERE tribe_id  = ?
            ) 
            AND u.id != ?
        GROUP BY 
            u.id, p.role, p.np, p.experience_level
        ORDER BY 
            workload_score ASC
        LIMIT ?
    `;

	// Prepare parameters based on whether role is provided
	const params = [
		job_group,
		experience_level,
		...(role ? [role] : []),
		tribe_id,
		pm_id,
		required_count * 2 + 1,
	];

	console.log(params);
	db.query(query, params, (err, results) => {
		if (err) {
			console.error(err);
			return res.status(500).send({ message: "Database error" });
		}

		if (results.length === 0) {
			console.log("masa 0");
			return res.status(404).send({
				message: "No profiles found matching the criteria.",
			});
		}

		return res.status(200).send({
			message: "Profiles retrieved successfully.",
			profiles: results,
		});
	});
});

// POST Route for Assigning Tribe Members with Rank
router.post("/tribe/assign", authorizePM, async (req, res) => {
	try {
		const { tribe_id, members } = req.body;
		console.log("Member info: ", members);

		// Input validation
		if (!tribe_id || !Array.isArray(members) || members.length === 0) {
			return res.status(400).json({
				message: "Tribe ID and at least one member are required.",
			});
		}

		// Get all ranks from database
		const ranks = await queryAsync("SELECT rank, name FROM ranks");
		const rankMap = new Map(ranks.map((r) => [r.name.toUpperCase(), r.rank]));

		// Validate and prepare members data
		const validMembers = [];
		const errors = [];

		for (const member of members) {
			// Required field checks
			if (
				!member.user_id ||
				!member.role ||
				!member.job_group ||
				!member.rank
			) {
				errors.push(`Member ${member.user_id} is missing required fields`);
				continue;
			}

			// Convert rank name to rank value
			const rankName = member.rank.toUpperCase();
			const rankValue = rankMap.get(rankName);

			if (!rankValue) {
				errors.push(`Invalid rank '${member.rank}' for user ${member.user_id}`);
				continue;
			}

			// Senior Management validation
			if (
				rankName !== "ANGGOTA" &&
				member.job_group.toUpperCase() !== "SENIOR MANAGEMENT"
			) {
				errors.push(
					`User ${member.user_id} must be Senior Management for rank ${member.rank}`
				);
				continue;
			}

			validMembers.push({
				tribe_id,
				user_id: member.user_id,
				role: member.role,
				job_group: member.job_group,
				rank: rankValue,
			});
		}

		if (errors.length > 0) {
			return res.status(400).json({
				message: "Some members failed validation",
				errors,
			});
		}

		// Prepare batch insert
		const values = validMembers.map((m) => [
			m.tribe_id,
			m.user_id,
			m.role,
			m.job_group,
			m.rank,
		]);

		// Execute insert
		await queryAsync(
			`INSERT INTO tribe_members (tribe_id, user_id, role, job_group, rank) VALUES ?`,
			[values]
		);

		return res.status(201).json({
			message:
				"Tribe members assigned successfully. Current Status: Waiting for Approval.",
			members_assigned: validMembers.length,
		});
	} catch (error) {
		console.error("Assignment error:", error);
		return res.status(500).json({
			message: "Internal server error",
			error: error.message,
		});
	}
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
