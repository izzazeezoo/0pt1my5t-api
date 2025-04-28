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
const fs = require("fs");
const path = require("path");
const PizZip = require("pizzip");
const Docxtemplater = require("docxtemplater");
const { google } = require('googleapis');

// Load service account credentials
const KEYFILEPATH = path.join(__dirname, process.env.SERVICE_ACCOUNT_CREDENTIAL); // adjust this
const SCOPES = ['https://www.googleapis.com/auth/drive.file'];

const auth = new google.auth.GoogleAuth({
    keyFile: KEYFILEPATH,
    scopes: SCOPES,
});

const drive = google.drive({ version: 'v3', auth });

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

// GET Route for Find All PMs
router.get("/team/find/allPM", authorizePA, verifyUserGID, (req, res) => {
    db.query(
        `
        SELECT 
            u.id AS user_id, u.display_name,
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
        JOIN 
            roles r ON u.role_id = r.id
        WHERE 
            p.role = 'Project Manager'
        ORDER BY 
            FIELD(p.experience_level, 'Senior', 'Middle', 'Junior') DESC, u.display_name ASC;
        `,
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

// POST Route to Generate Document
router.post("/generate-document/:projectId", authorizePA, checkTeamStatusSubmitted, async (req, res) => {
    const projectId = parseInt(req.params.projectId);
    const { start_date, end_date, document_number } = req.body;

    if (!start_date || !end_date || !document_number) {
        return res.status(400).json({
            error: true,
            message: "Missing required fields: start_date, end_date, document_number",
        });
    }

    try {
        // Fetch project data
        const result = await queryAsync(
            `SELECT DISTINCT p.id AS project_id, p.project_name, 
              c.contract_nums, p.pm_id, pm.display_name AS pm_name,
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
       WHERE p.id = ? LIMIT 1`,
            [projectId]
        );

        if (!result.length) {
            return res.status(404).json({ message: "Project not found" });
        }

        const project = result[0];

        const teamMembers = await queryAsync(
            `SELECT r.name AS rank_name, tm.role, u.display_name AS name, r.rank
       FROM team_members tm
       JOIN users u ON tm.user_id = u.id
       JOIN ranks r ON tm.rank = r.rank
       WHERE tm.team_id = ?
       ORDER BY r.rank ASC`,
            [project.team_id]
        );

        const tribeMembers = await queryAsync(
            `SELECT r.name AS rank_name, pr.job_group, pr.experience_level, u.display_name AS name, tm.role, r.rank
       FROM tribe_members tm
       JOIN users u ON tm.user_id = u.id
       JOIN ranks r ON tm.rank = r.rank
       JOIN profiles pr ON u.id = pr.user_id
       WHERE tm.tribe_id = ?
       ORDER BY r.rank ASC, pr.job_group ASC, FIELD(pr.experience_level, 'Senior', 'Middle', 'Junior'), u.display_name ASC`,
            [project.tribe_id]
        );

        console.log(teamMembers);
        console.log(tribeMembers);

        const groupedTribeMembers = groupTribeMembers(tribeMembers);
        console.log("groupedTribeMembers", groupedTribeMembers);

        const result11 = groupTribeMembers(tribeMembers);
        console.dir(result11, { depth: null });

        const outputFilename = generateOutputFilename(project.project_name);
        const templatePath = path.join(__dirname, '../var/template.docx');  // template is in ../var/
        const outputPath = path.join(__dirname, outputFilename);            // output will be in same folder as code

        const formattedContractNumber = formatContractNumbers(project.contract_nums);

        // Generate document
        await fillDocxTemplate(
            templatePath, outputPath,
            {
                contract_number: formattedContractNumber,
                start_date,
                end_date,
                document_number,
                team_structure: teamMembers,
                tribe_structure: groupedTribeMembers,
            }
        );

        // Upload to Drive
        const folderId = process.env.GOOGLE_DRIVE_FOLDER_ID;
        const uploadResult = await uploadFileToDrive(outputPath, outputFilename, folderId);

        console.log('Uploaded file info:', uploadResult);

        // Optional: Delete the file locally after upload
        fs.unlinkSync(outputPath);

        await queryAsync(
            `UPDATE projects SET document_link = ?
             WHERE id = ?`,
            [uploadResult.webViewLink, projectId]
        );

        // Return uploaded file link to client
        res.status(201).json({
            message: 'Document generated and uploaded successfully!',
            driveFile: {
                id: uploadResult.id,
                name: uploadResult.name,
                link: uploadResult.webViewLink,
            }
        })
    } catch (error) {
        console.error("API Error:", error);
        res.status(500).json({
            error: true,
            message: "Internal server error",
            details: error.message,
        });
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

function flattenTribeDataLeader(tribeGrouped) {
    const flatList = [];
    for (const rank in tribeGrouped) {
        if (rank.toUpperCase() !== "ANGGOTA") {
            (tribeGrouped[rank] || []).forEach((leader) => {
                flatList.push({
                    rank: rank || "",
                    role:
                        (leader.job_group || "") + (leader.role ? ` (${leader.role})` : ""),
                    name: leader.name || "",
                });
            });
        }
    }
    return flatList;
}

function formatTribeAnggotaTable(anggotaData) {
    if (!Array.isArray(anggotaData)) return [];

    const tableRows = [];

    anggotaData.forEach((group) => {
        // Add job group row
        tableRows.push({
            isJobGroup: true,
            job_group: group.job_group.toUpperCase(),
            level: "",
            names: ""
        });

        // Add each experience level row
        group.levels.forEach((levelStr) => {
            const [level, namesStr] = levelStr.split(":");
            const names = namesStr ? namesStr.trim().split(", ").join("\n") : "";



            tableRows.push({
                isLevel: true,
                job_group: "",
                level: level.trim(),
                names: names
            });
        });
    });

    return tableRows;
}

// Helper: Format Tribe Data
function groupTribeMembers(rows) {
    const result = {};
    const membersByJobGroup = {};

    rows.forEach((row) => {
        if (row.rank_name.toUpperCase() !== "ANGGOTA") {
            result[row.rank_name] = result[row.rank_name] || [];
            result[row.rank_name].push({
                name: row.name,
                job_group: row.job_group,
                role: row.role,
            });
        } else {
            if (!membersByJobGroup[row.job_group]) {
                membersByJobGroup[row.job_group] = {
                    Senior: [],
                    Middle: [],
                    Junior: [],
                };
            }
            if (!membersByJobGroup[row.job_group][row.experience_level]) {
                membersByJobGroup[row.job_group][row.experience_level] = [];
            }
            membersByJobGroup[row.job_group][row.experience_level].push(row.name);
        }
    });

    // Now format ANGGOTA the way you want
    result.ANGGOTA = Object.entries(membersByJobGroup).map(
        ([jobGroup, levels]) => {
            const levelStrings = [];

            Object.entries(levels).forEach(([levelName, names]) => {
                if (names.length > 0) {
                    const joinedNames = names.join(", ");
                    levelStrings.push(`${levelName} (${names.length}): ${joinedNames}`);
                }
            });

            return {
                job_group: jobGroup,
                levels: levelStrings,
            };
        }
    );

    return result;
}

// Utility function to generate dynamic output filename
function generateOutputFilename(projectName) {
    const today = new Date();
    const day = String(today.getDate()).padStart(2, '0');
    const month = String(today.getMonth() + 1).padStart(2, '0');
    const year = String(today.getFullYear()).slice(-2);
    const hours = String(today.getHours()).padStart(2, '0');
    const minutes = String(today.getMinutes()).padStart(2, '0');
    const seconds = String(today.getSeconds()).padStart(2, '0');

    const formattedDateTime = `${day}${month}${year} ${hours}${minutes}${seconds}`;

    const safeProjectName = projectName.replace(/[\\/:*?"<>|]/g, ''); // Remove forbidden filename characters
    return `[DRAFT] SK SATGAS - ${safeProjectName} - ${formattedDateTime}.docx`;
}

function formatContractNumbers(contractNums) {
    if (!contractNums) return '';

    const numbers = contractNums.split(',').map(num => num.trim()); // split by comma and clean spaces

    if (numbers.length === 1) {
        return numbers[0];
    } else if (numbers.length === 2) {
        return `${numbers[0]} dan ${numbers[1]}`;
    } else {
        const allButLast = numbers.slice(0, -1).join(', ');
        const last = numbers[numbers.length - 1];
        return `${allButLast}, dan ${last}`;
    }
}

const fillDocxTemplate = async (templatePath, outputPath, data) => {
    try {
        const content = fs.readFileSync(templatePath, "binary");
        const zip = new PizZip(content);
        const doc = new Docxtemplater(zip, {
            paragraphLoop: true,
            linebreaks: true,
        });

        console.dir(data, { depth: null });

        const templateData = {
            ...data,
            management_office: Array.isArray(data.team_structure)
                ? data.team_structure.map((member) => ({
                    rank: member.rank_name || "",
                    role: member.role || "",
                    name: member.name || "",
                }))
                : [],
            tribe_structure_leader: flattenTribeDataLeader(data.tribe_structure),
            tribe_structure_anggota: formatTribeAnggotaTable(data.tribe_structure.ANGGOTA || [])
        };

        console.dir(templateData, { depth: null });

        doc.render(templateData);

        const buffer = doc.getZip().generate({ type: "nodebuffer" });
        fs.writeFileSync(outputPath, buffer);

        return { success: true, outputPath };
    } catch (error) {
        console.error("Document generation error:", error);
        throw error;
    }
};

// Function to upload file
async function uploadFileToDrive(filePath, fileName, folderId) {
    const fileMetadata = {
        name: fileName,
        parents: [folderId], // Google Drive Folder ID where you want to upload
    };

    const media = {
        mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // DOCX mimetype
        body: fs.createReadStream(filePath),
    };

    const response = await drive.files.create({
        resource: fileMetadata,
        media: media,
        fields: 'id, name, webViewLink',
    });

    return response.data; // returns { id, name, webViewLink }
}

async function checkTeamStatusSubmitted(req, res, next) {
    const projectId = parseInt(req.params.projectId);

    try {
        const rows = await queryAsync('SELECT team_status FROM projects WHERE id = ?', [projectId]);
        if (rows.length === 0) {
            return res.status(404).json({ message: 'Project not found' });
        }

        const teamStatus = rows[0].team_status; 
        if (teamStatus !== 'Submitted') {
            return res.status(403).json({ message: 'Project is not allowed to generate document (team_status is not Submitted).' });
        }
        next();
    } catch (err) {
        console.error('Error checking team_status:', err);
        res.status(500).json({ message: 'Internal Server Error' });
    }
}

module.exports = router;