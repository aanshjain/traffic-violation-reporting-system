const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bodyParser = require('body-parser');
const path = require('path');
const multer = require('multer');
const session = require('express-session');
const fs = require('fs');

const app = express();
const port = Number(process.env.PORT) || 3000;
const dbPath = path.join(__dirname, 'database.db');
const uploadDir = path.join(__dirname, 'uploads');

if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
    destination(req, file, cb) {
        cb(null, uploadDir);
    },
    filename(req, file, cb) {
        cb(null, `${Date.now()}_${file.originalname.replace(/\s+/g, '_')}`);
    }
});

const upload = multer({
    storage,
    fileFilter(req, file, cb) {
        if (!file.mimetype.startsWith('image/')) {
            return cb(new Error('Only image uploads are allowed.'));
        }
        cb(null, true);
    }
});

app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use('/uploads', express.static(uploadDir));
app.use(express.static(path.join(__dirname, 'public')));
app.use(session({
    secret: 'tvrs_secure_system_key',
    resave: false,
    saveUninitialized: false
}));

const db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
        console.error(`Error opening database: ${err.message}`);
        return;
    }

    console.log('Database connected successfully.');
});

// Small SQLite promise helpers keep the route code easy to read.
function run(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.run(sql, params, function onRun(err) {
            if (err) {
                reject(err);
                return;
            }
            resolve(this);
        });
    });
}

function get(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.get(sql, params, (err, row) => {
            if (err) {
                reject(err);
                return;
            }
            resolve(row);
        });
    });
}

function all(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.all(sql, params, (err, rows) => {
            if (err) {
                reject(err);
                return;
            }
            resolve(rows);
        });
    });
}

async function ensureColumn(tableName, columnName, columnDefinition) {
    const columns = await all(`PRAGMA table_info(${tableName})`);
    const hasColumn = columns.some((column) => column.name === columnName);

    if (!hasColumn) {
        await run(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${columnDefinition}`);
    }
}

function generateOfficerTag(userId) {
    return `#P-${String(8000 + Number(userId)).padStart(4, '0')}`;
}

function redirectUserHome(res, role) {
    if (role === 'citizen') {
        return res.redirect('/citizen_dashboard.html');
    }

    if (role === 'officer') {
        return res.redirect('/officer_dashboard.html');
    }

    return res.redirect('/admin_dashboard.html');
}

async function initializeDatabase() {
    // 1) Main login table
    await run(`CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        email TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL,
        role TEXT NOT NULL CHECK(role IN ('citizen', 'officer', 'admin'))
    )`);

    // 2) Citizen report table
    await run(`CREATE TABLE IF NOT EXISTS reports (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        citizen_name TEXT NOT NULL,
        vehicle_number TEXT NOT NULL,
        description TEXT NOT NULL,
        evidence_image TEXT,
        status TEXT NOT NULL DEFAULT 'pending',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    await ensureColumn('reports', 'created_at', 'DATETIME');
    await ensureColumn('reports', 'assigned_officer_name', 'TEXT');
    await run(`UPDATE reports SET created_at = CURRENT_TIMESTAMP WHERE created_at IS NULL`);

    // 3) Approved reports create challans here
    await run(`CREATE TABLE IF NOT EXISTS challans (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        report_id INTEGER NOT NULL,
        amount INTEGER NOT NULL DEFAULT 500,
        status TEXT NOT NULL DEFAULT 'unpaid',
        issue_date DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (report_id) REFERENCES reports (id)
    )`);

    // 4) Officer table for admin monitoring and rewards
    await run(`CREATE TABLE IF NOT EXISTS officers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        tag_id TEXT UNIQUE NOT NULL,
        challans_issued INTEGER DEFAULT 0,
        active_status TEXT DEFAULT 'Active'
    )`);
    await ensureColumn('officers', 'reward_points', 'INTEGER DEFAULT 0');

    await run(`DELETE FROM challans
        WHERE report_id NOT IN (SELECT id FROM reports)`);

    await run(`DELETE FROM challans
        WHERE id NOT IN (
            SELECT MIN(id)
            FROM challans
            GROUP BY report_id
        )`);

    await run(`CREATE UNIQUE INDEX IF NOT EXISTS idx_challans_report_id
        ON challans(report_id)`);

    const adminUser = await get(
        `SELECT id FROM users WHERE email = ?`,
        ['admin@tvrs.com']
    );

    if (!adminUser) {
        await run(
            `INSERT INTO users (name, email, password, role) VALUES (?, ?, ?, ?)`,
            ['Admin', 'admin@tvrs.com', 'admin123', 'admin']
        );
    }

    await run(`DELETE FROM officers
        WHERE name NOT IN (
            SELECT name FROM users WHERE role = 'officer'
        )`);

    const officerUsers = await all(
        `SELECT id, name FROM users WHERE role = 'officer'`
    );

    for (const officer of officerUsers) {
        const existingOfficer = await get(
            `SELECT id FROM officers WHERE name = ?`,
            [officer.name]
        );

        if (!existingOfficer) {
            await run(
                `INSERT INTO officers (name, tag_id, challans_issued, active_status)
                 VALUES (?, ?, 0, 'Active')`,
                [officer.name, generateOfficerTag(officer.id)]
            );
        }
    }

    await run(`
        UPDATE reports
        SET assigned_officer_name = (
            SELECT name
            FROM officers
            WHERE active_status = 'Active'
            ORDER BY RANDOM()
            LIMIT 1
        )
        WHERE assigned_officer_name IS NULL
    `);
}

async function getRandomActiveOfficer() {
    return get(
        `SELECT id, name, tag_id, reward_points
         FROM officers
         WHERE active_status = 'Active'
         ORDER BY RANDOM()
         LIMIT 1`
    );
}

async function getOfficerByName(name) {
    return get(
        `SELECT id, name, tag_id, challans_issued, active_status, reward_points
         FROM officers
         WHERE name = ?
         LIMIT 1`,
        [name]
    );
}

function buildOfficerReportFilter(req) {
    if (req.session.user.role === 'admin') {
        return { clause: '', params: [] };
    }

    return {
        clause: ` AND assigned_officer_name = ?`,
        params: [req.session.user.name]
    };
}

function escapeHtml(value) {
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function sendFormError(res, statusCode, message, redirectPath) {
    res.status(statusCode).send(`
        <html lang="en">
            <head>
                <meta charset="UTF-8" />
                <title>TVRS Error</title>
            </head>
            <body style="font-family: Arial, sans-serif; padding: 2rem; line-height: 1.5;">
                <h1>Something went wrong</h1>
                <p>${escapeHtml(message)}</p>
                <p><a href="${escapeHtml(redirectPath)}">Go back</a></p>
            </body>
        </html>
    `);
}

function requireRole(...roles) {
    return (req, res, next) => {
        const currentUser = req.session.user;

        if (!currentUser) {
            return sendFormError(res, 401, 'Please log in to continue.', '/login.html');
        }

        if (!roles.includes(currentUser.role)) {
            return sendFormError(res, 403, 'You do not have permission to perform this action.', '/login.html');
        }

        next();
    };
}

// Session and auth routes
app.get('/api/session', (req, res) => {
    res.json({
        authenticated: Boolean(req.session.user),
        user: req.session.user || null
    });
});

app.get('/logout', (req, res) => {
    req.session.destroy(() => {
        res.redirect('/login.html');
    });
});

app.post('/register', async (req, res) => {
    const name = req.body.name?.trim();
    const email = req.body.email?.trim().toLowerCase();
    const role = req.body.role;
    const password = req.body.password;

    if (!name || !email || !password || !['citizen', 'officer'].includes(role)) {
        return sendFormError(res, 400, 'Please fill in all required fields correctly.', '/signup.html');
    }

    try {
        const result = await run(
            `INSERT INTO users (name, email, password, role) VALUES (?, ?, ?, ?)`,
            [name, email, password, role]
        );

        if (role === 'officer') {
            await run(
                `INSERT INTO officers (name, tag_id, challans_issued, active_status, reward_points)
                 VALUES (?, ?, 0, 'Active', 0)`,
                [name, generateOfficerTag(result.lastID)]
            );
        }

        res.redirect('/login.html');
    } catch (err) {
        if (err.message.includes('UNIQUE constraint failed: users.email')) {
            return sendFormError(res, 409, 'An account with this email already exists.', '/signup.html');
        }

        console.error('Registration error:', err.message);
        sendFormError(res, 500, 'Unable to create the account right now.', '/signup.html');
    }
});

app.post('/login', async (req, res) => {
    const username = req.body.username?.trim();
    const password = req.body.password;
    const role = req.body.role;

    if (!username || !password || !role) {
        return sendFormError(res, 400, 'Please enter your username, password, and role.', '/login.html');
    }

    try {
        const user = await get(
            `SELECT * FROM users
             WHERE (LOWER(email) = LOWER(?) OR name = ?)
               AND password = ?
               AND role = ?`,
            [username, username, password, role]
        );

        if (!user) {
            return sendFormError(res, 401, 'Invalid credentials or role mismatch.', '/login.html');
        }

        req.session.user = {
            id: user.id,
            name: user.name,
            role: user.role
        };
        req.session.save(() => {
            redirectUserHome(res, user.role);
        });
    } catch (err) {
        console.error('Login error:', err.message);
        sendFormError(res, 500, 'Unable to log in right now.', '/login.html');
    }
});

// Citizen routes
app.post('/submit_report', requireRole('citizen'), (req, res, next) => {
    upload.single('evidence')(req, res, async (err) => {
        if (err) {
            return sendFormError(res, 400, err.message, '/citizen_submit.html');
        }

        try {
            const citizenName = req.session.user.name;
            const vehicleNumber = req.body.vehicle_number?.trim().toUpperCase();
            const description = req.body.description?.trim();
            const assignedOfficer = await getRandomActiveOfficer();

            if (!vehicleNumber || !description) {
                return sendFormError(res, 400, 'Vehicle number and description are required.', '/citizen_submit.html');
            }

            const evidenceImage = req.file ? `/uploads/${req.file.filename}` : null;

            await run(
                `INSERT INTO reports (citizen_name, vehicle_number, description, evidence_image, status, assigned_officer_name)
                 VALUES (?, ?, ?, ?, 'pending', ?)`,
                [citizenName, vehicleNumber, description, evidenceImage, assignedOfficer?.name || null]
            );

            res.redirect('/citizen_reports.html');
        } catch (submitErr) {
            console.error('Report submission error:', submitErr.message);
            next(submitErr);
        }
    });
});

// Officer action routes
app.get('/approve/:id', requireRole('officer', 'admin'), async (req, res) => {
    const reportId = Number(req.params.id);

    if (!Number.isInteger(reportId)) {
        return sendFormError(res, 400, 'Invalid report ID.', '/officer_pending.html');
    }

    try {
        const report = await get(`SELECT * FROM reports WHERE id = ?`, [reportId]);

        if (!report) {
            return sendFormError(res, 404, 'Report not found.', '/officer_pending.html');
        }

        if (req.session.user.role === 'officer' && report.assigned_officer_name !== req.session.user.name) {
            return sendFormError(res, 403, 'This report is assigned to another officer.', '/officer_pending.html');
        }

        if (report.status === 'approved') {
            return res.redirect('/officer_approved.html');
        }

        await run(`UPDATE reports SET status = 'approved' WHERE id = ?`, [reportId]);
        await run(
            `INSERT OR IGNORE INTO challans (report_id, amount, status, issue_date)
             VALUES (?, 500, 'unpaid', CURRENT_TIMESTAMP)`,
            [reportId]
        );

        const actingOfficer = await get(
            `SELECT id FROM officers WHERE name = ? LIMIT 1`,
            [req.session.user.name]
        );

        if (actingOfficer) {
            await run(
                `UPDATE officers
                 SET challans_issued = challans_issued + 1,
                     reward_points = reward_points + 100
                 WHERE id = ?`,
                [actingOfficer.id]
            );
        }

        res.redirect('/officer_pending.html');
    } catch (err) {
        console.error('Approval error:', err.message);
        sendFormError(res, 500, 'Unable to approve the report right now.', '/officer_pending.html');
    }
});

app.get('/reject/:id', requireRole('officer', 'admin'), async (req, res) => {
    const reportId = Number(req.params.id);

    if (!Number.isInteger(reportId)) {
        return sendFormError(res, 400, 'Invalid report ID.', '/officer_pending.html');
    }

    try {
        const report = await get(`SELECT * FROM reports WHERE id = ?`, [reportId]);

        if (!report) {
            return sendFormError(res, 404, 'Report not found.', '/officer_pending.html');
        }

        if (req.session.user.role === 'officer' && report.assigned_officer_name !== req.session.user.name) {
            return sendFormError(res, 403, 'This report is assigned to another officer.', '/officer_pending.html');
        }

        await run(`UPDATE reports SET status = 'rejected' WHERE id = ?`, [reportId]);
        res.redirect('/officer_pending.html');
    } catch (err) {
        console.error('Rejection error:', err.message);
        sendFormError(res, 500, 'Unable to reject the report right now.', '/officer_pending.html');
    }
});

// Officer/admin API routes
app.get('/api/reports/pending', requireRole('officer', 'admin'), async (req, res) => {
    try {
        const filter = buildOfficerReportFilter(req);
        const rows = await all(
            `SELECT * FROM reports
             WHERE status = 'pending'${filter.clause}
             ORDER BY created_at DESC, id DESC`,
            filter.params
        );
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: 'Unable to load pending reports.' });
    }
});

app.get('/api/reports/approved', requireRole('officer', 'admin'), async (req, res) => {
    try {
        const filter = buildOfficerReportFilter(req);
        const rows = await all(
            `SELECT * FROM reports
             WHERE status = 'approved'${filter.clause}
             ORDER BY created_at DESC, id DESC`,
            filter.params
        );
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: 'Unable to load approved reports.' });
    }
});

app.get('/api/reports/rejected', requireRole('officer', 'admin'), async (req, res) => {
    try {
        const filter = buildOfficerReportFilter(req);
        const rows = await all(
            `SELECT * FROM reports
             WHERE status = 'rejected'${filter.clause}
             ORDER BY created_at DESC, id DESC`,
            filter.params
        );
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: 'Unable to load rejected reports.' });
    }
});

// Citizen API routes
app.get('/api/reports/citizen', requireRole('citizen'), async (req, res) => {
    try {
        const rows = await all(
            `SELECT * FROM reports WHERE citizen_name = ? ORDER BY created_at DESC, id DESC`,
            [req.session.user.name]
        );
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: 'Unable to load your reports.' });
    }
});

app.get('/api/challans/citizen', requireRole('citizen'), async (req, res) => {
    const query = `
        SELECT challans.*
        FROM challans
        INNER JOIN reports ON reports.id = challans.report_id
        WHERE reports.citizen_name = ?
        ORDER BY challans.issue_date DESC, challans.id DESC
    `;

    try {
        const rows = await all(query, [req.session.user.name]);
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: 'Unable to load your challans.' });
    }
});

app.get('/api/stats/citizen', requireRole('citizen'), async (req, res) => {
    try {
        const citizenName = req.session.user.name;

        const [submittedRow, approvedRow, pendingChallanRow] = await Promise.all([
            get(
                `SELECT COUNT(*) AS total
                 FROM reports
                 WHERE citizen_name = ?`,
                [citizenName]
            ),
            get(
                `SELECT COUNT(*) AS total
                 FROM reports
                 WHERE citizen_name = ? AND status = 'approved'`,
                [citizenName]
            ),
            get(
                `SELECT COUNT(*) AS total
                 FROM challans
                 WHERE report_id IN (
                    SELECT id
                    FROM reports
                    WHERE citizen_name = ?
                 ) AND status = 'unpaid'`,
                [citizenName]
            )
        ]);

        const approvedReports = approvedRow?.total || 0;

        res.json({
            submitted: submittedRow?.total || 0,
            approved: approvedReports,
            pendingChallans: pendingChallanRow?.total || 0,
            rewardPoints: approvedReports * 100,
            rewardValue: approvedReports * 100
        });
    } catch (err) {
        res.status(500).json({ error: 'Unable to load citizen statistics.' });
    }
});

// Admin API routes
app.get('/api/reports', requireRole('admin'), async (req, res) => {
    try {
        const rows = await all(
            `SELECT reports.*,
                    challans.id AS challan_id,
                    challans.amount AS challan_amount,
                    challans.status AS challan_status
             FROM reports
             LEFT JOIN challans ON challans.report_id = reports.id
             ORDER BY reports.created_at DESC, reports.id DESC`
        );
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: 'Unable to load reports.' });
    }
});

app.get('/api/officers', requireRole('admin'), async (req, res) => {
    try {
        const rows = await all(
            `SELECT * FROM officers ORDER BY active_status = 'Active' DESC, name ASC`
        );
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: 'Unable to load officers.' });
    }
});

// Shared stats route
app.get('/api/stats', requireRole('citizen', 'officer', 'admin'), async (req, res) => {
    try {
        if (req.session.user.role === 'officer') {
            const officer = await getOfficerByName(req.session.user.name);
            const [pendingRow, approvedRow, rejectedRow] = await Promise.all([
                get(
                    `SELECT COUNT(*) AS total
                     FROM reports
                     WHERE status = 'pending' AND assigned_officer_name = ?`,
                    [req.session.user.name]
                ),
                get(
                    `SELECT COUNT(*) AS total
                     FROM reports
                     WHERE status = 'approved' AND assigned_officer_name = ?`,
                    [req.session.user.name]
                ),
                get(
                    `SELECT COUNT(*) AS total
                     FROM reports
                     WHERE status = 'rejected' AND assigned_officer_name = ?`,
                    [req.session.user.name]
                )
            ]);

            return res.json({
                pending: pendingRow?.total || 0,
                approved: approvedRow?.total || 0,
                rejected: rejectedRow?.total || 0,
                rewardPoints: officer?.reward_points || 0,
                rewardValue: officer?.reward_points || 0,
                officerTag: officer?.tag_id || 'Unassigned'
            });
        }

        const [pendingRow, approvedRow, rejectedRow, officerRow, challanRow] = await Promise.all([
            get(`SELECT COUNT(*) AS total FROM reports WHERE status = 'pending'`),
            get(`SELECT COUNT(*) AS total FROM reports WHERE status = 'approved'`),
            get(`SELECT COUNT(*) AS total FROM reports WHERE status = 'rejected'`),
            get(`SELECT COUNT(*) AS total FROM officers`),
            get(`SELECT COUNT(*) AS total FROM challans`)
        ]);

        res.json({
            pending: pendingRow?.total || 0,
            approved: approvedRow?.total || 0,
            rejected: rejectedRow?.total || 0,
            officers: officerRow?.total || 0,
            challans: challanRow?.total || 0
        });
    } catch (err) {
        res.status(500).json({ error: 'Unable to load statistics.' });
    }
});

app.use((err, req, res, next) => {
    console.error('Unexpected server error:', err.message);
    sendFormError(res, 500, 'An unexpected error occurred. Please try again.', '/');
});

initializeDatabase()
    .then(() => {
        app.listen(port, () => {
            console.log(`Server is running at http://localhost:${port}`);
        });
    })
    .catch((err) => {
        console.error('Failed to initialize database:', err.message);
        process.exit(1);
    });
