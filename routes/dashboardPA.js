const db = require("../var/dbConfig");
const express = require("express");
const router = express.Router();
const {
    authorization,
    authorizePM,
    authorizePA,
} = require("../middleware/authorization");
const frontendUrl = process.env.FRONTEND_URL;
const { verifyUserGID, verifyPMRole } = require("../middleware/verification");
const nodemailer = require("nodemailer");

//GET Dashboard (PA) Data
router.get("/dashboard", authorizePA, verifyUserGID, (req, res) => {
    const { id: idUser } = req.user;

    // Fetch all projects
    db.query(
        `
SELECT 
        p.id AS project_id, p.project_name, p.project_description, GROUP_CONCAT(c.contract_num) AS contract_nums, p.contract_value, p.status, p.pm_id, pm.display_name AS pm_name
FROM 
        projects p
LEFT JOIN 
        users pm ON p.pm_id = pm.id  -- Join to get the PM's display name
LEFT JOIN 
        contracts c ON p.id = c.project_id
GROUP BY 
        p.id;
    `,
        (err, result) => {
            if (err) {
                console.error(err);
                return res.status(500).send({ message: "Database error" });
            }
            if (!result.length) {
                return res.status(404).send({ message: "No projects found for this user" });
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
router.post("/project", authorizePA, verifyUserGID, async (req, res) => {
    const { id: idUser } = req.user;
    const {
        project_name,
        project_description,
        pm_id,
        contract_num, // can be string (comma-separated) or array
        contract_value,
    } = req.body;

    // Validate input fields
    if (
        !project_name || !project_description || !contract_num || !contract_value || !pm_id) {
        return res.status(400).send({ message: "Missing required fields." });
    }

    try {
        // Verify PM role
        const isPMAuthorized = await verifyPMRole(pm_id);
        if (!isPMAuthorized) {
            return res.status(403).send({
                message: "The assigned user is not authorized as a project manager.",
            });
        }

        // Proceed to create the project and team
        const { projectId, teamId, tribeId } = await createProjectAndTeam(
            project_name,
            project_description,
            pm_id,
            contract_num,
            contract_value
        );

        return res.status(201).send({
            message: "Project and Team created successfully.",
            redirect: `${frontendUrl}/dashboard/project/${projectId}`,
            project_id: projectId,
            team_id: teamId,
            tribe_id: tribeId,
        });
    } catch (err) {
        console.error(err);
        return res.status(500).send({ message: "Internal server error." });
    }
});

// Function to insert the project and create team & tribe
async function createProjectAndTeam(project_name, project_description, pm_id, contract_num, contract_value) {
    try {
        // Insert the project
        const projectResult = await queryAsync(
            `INSERT INTO projects (project_name, project_description, pm_id, contract_value, status) 
            VALUES (?, ?, ?, ?, 'Initiation')`,
            [project_name, project_description, pm_id, contract_value]
        );

        const projectId = projectResult.insertId;

        let contractNums = [];
        if (Array.isArray(contract_num)) {
            contractNums = contract_num;
        } else if (typeof contract_num === "string") {
            contractNums = contract_num.split(",").map(cn => cn.trim()).filter(Boolean);
        }

        // Insert contract numbers into contracts table
        for (const cn of contractNums) {
            await db.promise().query(` INSERT INTO contracts (project_id, contract_num) VALUES (?, ?)`, [projectId, cn]);
        }

        // Insert the team
        const teamResult = await queryAsync(`INSERT INTO teams (project_id) VALUES (?)`, [projectId]);
        const teamId = teamResult.insertId;

        // Insert the tribe
        const tribeResult = await queryAsync(`INSERT INTO tribes (project_id) VALUES (?)`, [projectId]);
        const tribeId = tribeResult.insertId;

        // Insert the tribe
        const teamMemberResult = await queryAsync(`INSERT INTO team_members (team_id, user_id, role, is_primary) 
            VALUES (?, ?, 'Project Manager', 1)`, [teamId, pm_id]
        );

        // Send email notification
        await sendProjectAssignmentEmail(pm_id, project_name);

        return { projectId, teamId, tribeId };
    } catch (err) {
        console.error(err);
        throw new Error("Database insertion error");
    }
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

// Function to send email notification
async function sendProjectAssignmentEmail(pm_id, project_name) {
    try {
        // Fetch PM email
        const { email: pmEmail, pmName } = await getPMDetails(pm_id);
        if (!pmEmail) throw new Error("PM email not found");

        // Configure email
        const transporter = nodemailer.createTransport({
            service: "Gmail",
            host: process.env.EMAIL_HOST,
            port: process.env.EMAIL_PORT,
            auth: {
                user: process.env.EMAIL_USER,
                pass: process.env.EMAIL_PASS,
            },
        });

        const tomorrow = new Date();
        const day = tomorrow.getDay(); // 0 (Sun) to 6 (Sat)

        if (day === 5) {
            // Friday → add 3 days to get to Monday
            tomorrow.setDate(tomorrow.getDate() + 3);
        } else if (day === 6) {
            // Saturday → add 2 days to get to Monday
            tomorrow.setDate(tomorrow.getDate() + 2);
        } else {
            // Any other day → add 1 day
            tomorrow.setDate(tomorrow.getDate() + 1);
        }

        const formattedDate = tomorrow.toLocaleDateString("id-ID",
            { year: "numeric", month: "long", day: "numeric", });

        const mailOptions = {
            from: process.env.EMAIL_USER,
            to: pmEmail,
            subject: `Penunjukkan sebagai Project Manager untuk Proyek ${project_name}`,
            html: `
            <p>Dear ${pmName},</p>

            <p>Dengan email ini, kami mengumumkan penunjukkan Anda sebagai Project Manager untuk proyek <strong>${project_name}</strong>, efektif mulai tanggal <strong>${formattedDate}</strong>. </p>

            <h4>Tanggung Jawab Utama:</h4>
            <ul>
                <li>Memimpin dan mengkoordinasikan seluruh aspek proyek hingga penyelesaian tepat waktu.</li>
                <li>Menjadi penghubung utama antara tim, stakeholder, dan pihak terkait lainnya.</li>
                <li>Melaporkan perkembangan proyek secara berkala serta mengelola risiko dan perubahan.</li>
            </ul>

            <h4>Tindakan Selanjutnya:</h4>
            <ul>
                <li>Segera mengupdate detail proyek di platform <strong>OPTIMYST</strong>.</li>
                <li>Jadwal kick-off meeting akan disampaikan dalam komunikasi terpisah.</li>
            </ul>

            <p>Selamat menjalankan tugas dan semoga hasilnya memenuhi harapan semua pihak.</p>

            <p>Best regards,</p>
            <p>Team TO</p>
        `,
        };

        // Send email
        await transporter.sendMail(mailOptions);
        console.log("Email sent successfully to:", pmEmail);
    } catch (err) {
        console.error("Failed to send email:", err);
    }
}

// Function to fetch PM email
async function getPMDetails(pm_id) {
    return new Promise((resolve, reject) => {
        db.query(
            `SELECT email, display_name AS pmName FROM users WHERE id = ?`,
            [pm_id],
            (err, result) => {
                if (err) return reject(err);
                if (result.length) {
                    resolve({ email: result[0].email, pmName: result[0].pmName });
                } else {
                    resolve(null);
                }
            }
        );
    });
}

module.exports = router;