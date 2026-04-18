import { initializeApp } from "https://www.gstatic.com/firebasejs/12.12.0/firebase-app.js";
import { getAuth, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.12.0/firebase-auth.js";
import { getFirestore, doc, deleteDoc, setDoc, updateDoc, onSnapshot, collection, getDocs, getDoc, query, where, arrayUnion, arrayRemove, addDoc } from "https://www.gstatic.com/firebasejs/12.12.0/firebase-firestore.js";
import firebaseConfig from "./firebaseConfig.js";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const useFirestore = firebaseConfig.apiKey && !firebaseConfig.apiKey.includes("YOUR_API_KEY") && !firebaseConfig.apiKey.includes("XXXX");
const adminStateDoc = doc(db, 'admin', 'state');
let hasResolvedAuth = false;
let realtimeInitialized = false;
const ACTIVE_TAB_KEY = 'growsauyouAdminActiveTab';

const ROLE_CACHE_KEY = 'growsauyouRoleCache';

const defaultImage = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='500' height='280' viewBox='0 0 500 280'%3E%3Crect width='500' height='280' fill='%23546B41'/%3E%3Ctext x='50%25' y='50%25' dominant-baseline='middle' text-anchor='middle' font-family='Segoe UI, sans-serif' font-size='24' fill='%23FFF8EC'%3EImage unavailable%3C/text%3E%3C/svg%3E";

function normalizeRole(role) {
    return String(role || '').toLowerCase().trim();
}

function normalizeStatus(status) {
    return String(status || 'pending').toLowerCase().trim();
}

function isAdminEmail(email) {
    const val = String(email || '').toLowerCase();
    return val.includes('admin');
}

function revealApp() {
    document.body.classList.remove('auth-pending');
}

function redirectOnce(path) {
    if (hasResolvedAuth) return;
    hasResolvedAuth = true;
    window.location.href = path;
}

function cacheRole(uid, role) {
    try {
        localStorage.setItem(ROLE_CACHE_KEY, JSON.stringify({ uid, role: normalizeRole(role) }));
    } catch {
        // ignore cache errors
    }
}

function getCachedRole(uid) {
    try {
        const raw = localStorage.getItem(ROLE_CACHE_KEY);
        if (!raw) return null;
        const cached = JSON.parse(raw);
        if (!cached || cached.uid !== uid) return null;
        return normalizeRole(cached.role);
    } catch {
        return null;
    }
}

function renderAdminShell() {
    updateDashboard();
    updateAnalytics();
    updateVolunteers();
    loadRestrictionsUI();
    updateSkills();
    updateTasks();
    updateBadges();
    updateCertifications();
    updateNotifications();
}

// Data structures
let users = JSON.parse(localStorage.getItem('itanimUsers') || '[]');
let programs = JSON.parse(localStorage.getItem('itanimPrograms') || '[]');
let certifications = JSON.parse(localStorage.getItem('itanimCerts') || '[]');
let skills = JSON.parse(localStorage.getItem('itanimSkills') || '[]');
let restrictions = JSON.parse(localStorage.getItem('itanimRestrictions') || '{"minAge":18,"validBarangays":"All"}');
let badgeThresholds = JSON.parse(localStorage.getItem('itanimBadges') || '{"bronze":10,"silver":25,"gold":50,"platinum":100}');
let notifications = JSON.parse(localStorage.getItem('itanimNotifications') || '[]');
const programsKey = "itanimPrograms";

function refreshLocalAdminCache() {
    try {
        const localUsers = JSON.parse(localStorage.getItem('itanimUsers') || '[]');
        const localPrograms = JSON.parse(localStorage.getItem('itanimPrograms') || '[]');
        if (Array.isArray(localUsers)) users = localUsers;
        if (Array.isArray(localPrograms)) programs = localPrograms;
    } catch {
        // ignore parse issues, keep current in-memory values
    }
}


// Save functions
async function saveAdminStateToFirestore() {
    if (!useFirestore) return;
    try {
        await setDoc(adminStateDoc, {
            users,
            programs,
            certifications,
            skills,
            restrictions,
            badgeThresholds,
            notifications
        }, { merge: true });
    } catch (err) {
        console.warn('Could not save admin state to Firestore', err);
    }
}

function saveUsers() {
    localStorage.setItem('itanimUsers', JSON.stringify(users));
    saveAdminStateToFirestore();
}
function savePrograms() {
    localStorage.setItem('itanimPrograms', JSON.stringify(programs));
    if (useFirestore) {
        (async () => {
            try {
                // Delete all existing docs in programs_empty
                const snap = await getDocs(collection(db, 'programs_empty'));
                const deletePromises = snap.docs.map(d => deleteDoc(d.ref));
                await Promise.all(deletePromises);
                // Add new ones
                const addPromises = programs.map(p => setDoc(doc(db, 'programs_empty', p.id), p));
                await Promise.all(addPromises);
            } catch (err) {
                console.warn('Could not save programs to Firestore', err);
            }
        })();
    }
    saveAdminStateToFirestore();
    // Always sync to homepage programs after saving
    syncProgramsFromPrograms();
}
function updateTasks() {
    // Placeholder for task list updates in admin dashboard.
    // If task management is later added, populate or refresh task UI here.
    const taskList = document.getElementById('taskList');
    if (taskList) {
        taskList.innerHTML = '<p>Task list refresh complete.</p>';
    }
}

function syncProgramsFromTasks() {
    // Placeholder mapping for task-sync workflows.
    // This function exists to prevent errors when admin loads and is not currently using task sync.
    return;
}
function saveCerts() {
    localStorage.setItem('itanimCerts', JSON.stringify(certifications));
    saveAdminStateToFirestore();
}
function saveSkills() {
    localStorage.setItem('itanimSkills', JSON.stringify(skills));
    saveAdminStateToFirestore();
}
function saveRestrictions() {
    localStorage.setItem('itanimRestrictions', JSON.stringify(restrictions));
    saveAdminStateToFirestore();
}
function saveBadges() {
    localStorage.setItem('itanimBadges', JSON.stringify(badgeThresholds));
    saveAdminStateToFirestore();
}
function saveNotifications() {
    localStorage.setItem('itanimNotifications', JSON.stringify(notifications));
    saveAdminStateToFirestore();
}

async function initFirestoreAdminState() {
    if (!useFirestore) {
        console.warn('Firestore is not configured for admin panel. Using local demo data only.');
        return;
    }

    try {
        onSnapshot(adminStateDoc, (snapshot) => {
            if (!snapshot.exists()) {
                console.warn('Firestore admin state document not found. Local data will be used.');
                return;
            }
            const data = snapshot.data();
            if (!data) return;
            users = Array.isArray(data.users) ? data.users : users;
            programs = Array.isArray(data.programs) ? data.programs : programs;
            certifications = Array.isArray(data.certifications) ? data.certifications : certifications;
            skills = Array.isArray(data.skills) ? data.skills : skills;
            restrictions = data.restrictions || restrictions;
            badgeThresholds = data.badgeThresholds || badgeThresholds;
            notifications = Array.isArray(data.notifications) ? data.notifications : notifications;

            // Merge Firestore programs with local cache so newly added local programs
            // are not lost when changing tabs or when snapshots arrive late.
            let localPrograms = [];
            try {
                localPrograms = JSON.parse(localStorage.getItem('itanimPrograms') || '[]');
            } catch {
                localPrograms = [];
            }
            const firestorePrograms = Array.isArray(data.programs) ? data.programs : [];
            const mergedProgramsById = new Map();
            firestorePrograms.forEach((p) => mergedProgramsById.set(p.id, p));
            localPrograms.forEach((p) => mergedProgramsById.set(p.id, p));
            programs = Array.from(mergedProgramsById.values()).map(program => ({
                ...program,
                name: program.name || program.title || 'Untitled Program',
                assigned: Array.isArray(program.assigned) ? program.assigned : Array.isArray(program.joined) ? program.joined : [],
                joined: Array.isArray(program.joined) ? program.joined : Array.isArray(program.assigned) ? program.assigned : [],
                maxVolunteers: program.maxVolunteers ?? 0,
                status: program.status || 'active'
            }));
            updateDashboard();
            updateAnalytics();
            updateVolunteers();
            loadRestrictionsUI();
            updateSkills();
            updatePrograms();
            updateBadges();
            updateCertifications();
            updateNotifications();
            syncProgramsFromPrograms();
        });

        // Live-sync volunteers so hours are always reflected in dashboard analytics.
        onSnapshot(collection(db, 'volunteers'), (volunteersSnap) => {
            users = [];
            volunteersSnap.forEach((volunteerDoc) => {
                const data = volunteerDoc.data();
                users.push({
                    id: volunteerDoc.id,
                    name: data.name || `${data.firstName || ''} ${data.lastName || ''}`.trim() || data.email || 'Volunteer',
                    email: data.email || '',
                    age: data.age || '',
                    barangay: data.barangay || data.address || '',
                    skills: data.skills || [],
                    status: normalizeStatus(data.status),
                    hours: Number(data.hours || 0),
                    badge: data.badge || 'None',
                    enrolledPrograms: data.enrolledPrograms || [],
                    completedPrograms: data.completedPrograms || [],
                    createdAt: data.createdAt || data.registeredAt || null
                });
            });
            updateVolunteers();
            updateDashboard();
            updateAnalytics();
            updateVolunteerProgramParticipants();
        });
    } catch (err) {
        console.warn('Firestore admin state listener failed', err);
    }
}

function readFileAsDataUrl(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ''));
        reader.onerror = () => reject(new Error('Could not read file'));
        reader.readAsDataURL(file);
    });
}

function renderProgramAttachmentPreview(attachments) {
    const container = document.getElementById('programAttachmentPreview');
    if (!container) return;
    if (!Array.isArray(attachments) || attachments.length === 0) {
        container.innerHTML = '';
        return;
    }
    container.innerHTML = attachments.map(att => `
        <div style="border:1px solid rgba(255,255,255,0.18); border-radius:12px; overflow:hidden; background:rgba(255,255,255,0.06);">
            <img src="${att.dataUrl}" alt="${att.name}" style="width:100%; height:86px; object-fit:cover; display:block;">
            <div style="padding:6px 8px; font-size:12px; opacity:0.85; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${att.name}</div>
        </div>
    `).join('');
}

function renderTaskAttachmentPreview(attachments) {
    // Alias for compatibility with task attachment handling
    renderProgramAttachmentPreview(attachments);
}

async function getAttachmentsFromInput() {
    const input = document.getElementById('programAttachments');
    if (!input || !input.files || input.files.length === 0) return [];
    const files = Array.from(input.files);
    const results = [];
    for (const file of files) {
        const dataUrl = await readFileAsDataUrl(file);
        results.push({ name: file.name, type: file.type, size: file.size, dataUrl });
    }
    return results;
}

function clearAttachmentInput() {
    const input = document.getElementById('programAttachments');
    if (input) input.value = '';
    renderProgramAttachmentPreview([]);
}

async function syncProgramsFromPrograms() {
    // Mirror programs -> public "Available Programs" list (index.js reads this key in offline mode)
    const programDocs = programs.map(p => ({
        id: p.id,
        title: p.name,
        hours: String(p.hours ?? ''),
        requirement: p.requirement || 'None',
        desc: p.desc || '',
        image: (p.attachments && p.attachments[0] && p.attachments[0].dataUrl) ? p.attachments[0].dataUrl : defaultImage,
        joined: p.joined || [],
        skills: p.skills || [],
        _source: 'program'
    }));
    localStorage.setItem(programsKey, JSON.stringify(programs));

    if (!useFirestore) return;

    try {
        // First, delete all existing programs in Firestore
        const snap = await getDocs(collection(db, 'programs_empty'));
        const deletePromises = snap.docs.map(d => deleteDoc(d.ref));
        await Promise.all(deletePromises);

        // Then add all current programs
        const addPromises = programs.map(async (program) => {
            const firestoreData = {
                title: program.name,  // Fix: use program.name instead of program.title
                hours: program.hours,
                requirement: program.requirement || 'None',
                desc: program.desc || '',
                image: (program.attachments && program.attachments[0] && program.attachments[0].dataUrl) ? program.attachments[0].dataUrl : defaultImage,
                joined: program.joined || [],
                skills: program.skills || []
            };
            return setDoc(doc(db, 'programs_empty', program.id), firestoreData, { merge: true });
        });
        await Promise.all(addPromises);
        console.log('Successfully synced', programs.length, 'programs to Firestore');
    } catch (err) {
        console.warn('Could not sync programs to Firestore', err);
    }
}

// Tab switching
function showTab(tabName) {
    document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(content => content.classList.remove('active'));
    document.querySelector(`button[onclick="showTab('${tabName}')"]`).classList.add('active');
    document.getElementById(tabName).classList.add('active');
    try {
        localStorage.setItem(ACTIVE_TAB_KEY, tabName);
    } catch {
        // ignore storage errors
    }
    updateTab(tabName);
}

function getCurrentActiveTab() {
    const active = document.querySelector('.tab-content.active');
    return active ? active.id : 'dashboard';
}

function restoreActiveTab() {
    let tab = 'dashboard';
    try {
        tab = localStorage.getItem(ACTIVE_TAB_KEY) || 'dashboard';
    } catch {
        tab = 'dashboard';
    }
    if (!document.getElementById(tab)) {
        tab = 'dashboard';
    }
    showTab(tab);
}

// Update tab content
function updateTab(tabName) {
    switch(tabName) {
        case 'dashboard': updateDashboard(); break;
        case 'analytics': updateAnalytics(); break;
        case 'volunteers': updateVolunteers(); break;
        case 'restrictions': updateRestrictions(); break;
        case 'skills': updateSkills(); break;
        case 'programs': updatePrograms(); break;
        case 'badges': updateBadges(); break;
        case 'certifications': updateCertifications(); break;
        case 'notifications': updateNotifications(); break;
    }
}

// Dashboard
function updateDashboard() {
    const totalVolunteers = users.filter(u => normalizeStatus(u.status) === 'approved').length;
    const pendingApps = users.filter(u => normalizeStatus(u.status) === 'pending').length;
    const approvedUsers = users.filter(u => normalizeStatus(u.status) === 'approved').length;
    const rejectedUsers = users.filter(u => normalizeStatus(u.status) === 'rejected').length;
    const activePrograms = programs.filter(p => p.status === 'active').length;
    const completedPrograms = programs.filter(p => p.status === 'completed').length;

    document.getElementById('totalVolunteers').textContent = totalVolunteers;
    document.getElementById('pendingApps').textContent = pendingApps;
    document.getElementById('approvedUsers').textContent = approvedUsers;
    document.getElementById('rejectedUsers').textContent = rejectedUsers;
    document.getElementById('activePrograms').textContent = activePrograms;
    document.getElementById('completedPrograms').textContent = completedPrograms;
}

// Analytics
function updateAnalytics() {
    const totalHours = users.reduce((sum, u) => sum + (u.hours || 0), 0);
    const activeVolunteers = users.filter(u => normalizeStatus(u.status) === 'approved' && u.hours > 0).length;
    const inactiveVolunteers = users.filter(u => normalizeStatus(u.status) === 'approved' && u.hours === 0).length;
    const completedProgramsCount = programs.filter(p => p.status === 'completed').length;
    const totalPrograms = programs.length;
    const completionRate = totalPrograms > 0 ? Math.round((completedProgramsCount / totalPrograms) * 100) : 0;

    document.getElementById('totalHours').textContent = `${totalHours} hours`;
    document.getElementById('activeInactive').textContent = `${activeVolunteers} active, ${inactiveVolunteers} inactive`;
    document.getElementById('completionRate').textContent = `${completionRate}%`;

    // Top programs
    const programCounts = {};
    programs.forEach(p => {
        if (p.status === 'completed') {
            programCounts[p.name] = (programCounts[p.name] || 0) + 1;
        }
    });
    const topPrograms = Object.entries(programCounts).sort((a,b) => b[1] - a[1]).slice(0, 3);
    document.getElementById('topPrograms').innerHTML = topPrograms.length > 0
        ? topPrograms.map(([name, count]) => `<li>${name}: ${count} completions</li>`).join('')
        : '<li>No completed programs yet.</li>';

    // Badge distribution
    const badges = { Bronze: 0, Silver: 0, Gold: 0, Platinum: 0, None: 0 };
    users.forEach(u => {
        badges[u.badge || 'None']++;
    });
    document.getElementById('badgeChart').innerHTML = Object.entries(badges).map(([badge, count]) => `<div>${badge}: ${count}</div>`).join('');

    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const newThisMonth = users.filter((u) => {
        if (!u.createdAt) return false;
        const createdDate = new Date(u.createdAt);
        return !Number.isNaN(createdDate.getTime()) && createdDate >= monthStart;
    }).length;
    document.getElementById('volunteerGrowth').textContent = `Growth over time: +${newThisMonth} this month`;
}

// Volunteers
function updateVolunteers() {
    // Keep volunteers/programs in sync with latest Program Management changes.
    refreshLocalAdminCache();

    const list = document.getElementById('volunteerList');
    const statusFilter = document.getElementById('volunteerStatusFilter')?.value || 'approved';
    const filteredUsers = statusFilter === 'all'
        ? users
        : users.filter((u) => normalizeStatus(u.status) === statusFilter);
    list.innerHTML = `
        <div class="volunteer-section">
            <div class="volunteer-card">
                <strong>${statusFilter === 'pending' ? 'Pending Volunteers' : `Volunteers (${statusFilter})`}</strong>
                ${filteredUsers.map(u => `
                    <div class="volunteer-item">
                        <div>
                            <strong>${u.name}</strong><br>
                            Email: ${u.email}<br>
                            Age: ${u.age}, Barangay: ${u.barangay}<br>
                            Skills: ${Array.isArray(u.skills) ? u.skills.join(', ') : ''}<br>
                            Enrolled: ${Array.isArray(u.enrolledPrograms) ? u.enrolledPrograms.join(', ') : 'None'}<br>
                            Completed: ${Array.isArray(u.completedPrograms) ? u.completedPrograms.join(', ') : 'None'}<br>
                            Status: ${normalizeStatus(u.status)}, Hours: ${u.hours || 0}, Badge: ${u.badge || 'None'}
                        </div>
                        <div>
                            ${normalizeStatus(u.status) === 'pending' ? `
                                <button class="approve-btn" onclick="approveUser('${u.id}')">Approve</button>
                                <button class="reject-btn" onclick="rejectUser('${u.id}')">Reject</button>
                            ` : ''}
                        </div>
                    </div>
                `).join('')}
            </div>
        `;

    updateVolunteerProgramFilter();
    updateVolunteerProgramParticipants();
    updateAttendanceProgramOptions();
}

function updateVolunteerProgramFilter() {
    // Always pull latest program list from local cache source.
    refreshLocalAdminCache();

    const filter = document.getElementById('volunteerProgramFilter');
    if (!filter) return;
    filter.innerHTML = programs.map(program => `
        <option value="${program.id}">${program.name || program.title || 'Untitled Program'}</option>
    `).join('');
    if (!filter.value && programs.length > 0) {
        filter.value = programs[0].id;
    }
}

function updateAttendanceProgramOptions() {
    const select = document.getElementById('attendanceProgramSelect');
    if (!select) return;
    select.innerHTML = programs.map((program) => `
        <option value="${program.id}">${program.name || program.title || 'Untitled Program'}</option>
    `).join('');
    if (!select.value && programs.length > 0) {
        select.value = programs[0].id;
    }
    updateAttendanceVolunteerOptions();
}

function updateAttendanceVolunteerOptions() {
    const programSelect = document.getElementById('attendanceProgramSelect');
    const volunteerSelect = document.getElementById('attendanceVolunteerSelect');
    if (!programSelect || !volunteerSelect) return;
    const programId = programSelect.value;
    const official = getOfficialParticipantsForProgram(programId);
    volunteerSelect.innerHTML = official.map((u) => `
        <option value="${u.id}">${u.name} (${u.email || 'no email'})</option>
    `).join('');
}

function getOfficialParticipantsForProgram(programId) {
    // Officially joined means: program.joined contains userId AND volunteer is approved
    const program = programs.find(p => p.id === programId) || {};
    const joined = Array.isArray(program.joined) ? program.joined : [];
    return users.filter((u) =>
        normalizeStatus(u.status) === 'approved' &&
        joined.includes(u.id)
    );
}

function getPendingParticipantsForProgram(programId) {
    const program = programs.find(p => p.id === programId) || {};
    const pending = Array.isArray(program.pendingJoins) ? program.pendingJoins : [];
    return users.filter((u) =>
        normalizeStatus(u.status) === 'approved' &&
        pending.includes(u.id)
    );
}

function isFinishedForProgram(user, programId) {
    return Array.isArray(user.completedPrograms) && user.completedPrograms.includes(programId);
}

function updateVolunteerProgramParticipants() {
    refreshLocalAdminCache();

    const filter = document.getElementById('volunteerProgramFilter');
    const joinStatusFilter = 'all';
    const participantContainer = document.getElementById('programParticipantList');
    if (!filter || !participantContainer) return;

    const programId = filter.value;
    const program = programs.find(p => p.id === programId) || {};
    const official = getOfficialParticipantsForProgram(programId);
    const pending = getPendingParticipantsForProgram(programId);

    const finishedOfficial = official.filter((u) => isFinishedForProgram(u, programId));
    const notFinishedOfficial = official.filter((u) => !isFinishedForProgram(u, programId));

    let shown = official;
    if (joinStatusFilter === 'pending') shown = pending;
    if (joinStatusFilter === 'finished') shown = finishedOfficial;
    if (joinStatusFilter === 'not_finished') shown = notFinishedOfficial;
    if (joinStatusFilter === 'all') shown = [...official, ...pending];

    participantContainer.innerHTML = `
        <div style="padding: 16px; border-radius: 14px; background: rgba(255,255,255,0.08); margin-bottom: 18px;">
            <strong>Participants for:</strong> ${program.name || program.title || 'Selected Program'}<br>
            <small>
                Official: ${official.length} • Pending: ${pending.length} • Finished: ${finishedOfficial.length}
            </small>
        </div>
        ${shown.length > 0 ? shown.map(user => {
            const inPending = Array.isArray(program.pendingJoins) && program.pendingJoins.includes(user.id);
            const inOfficial = Array.isArray(program.joined) && program.joined.includes(user.id);
            const finished = isFinishedForProgram(user, programId);
            return `
            <div class="volunteer-item">
                <div>
                    <strong>${user.name}</strong><br>
                    Email: ${user.email || 'N/A'}<br>
                    Hours: ${user.hours || 0}<br>
                    Completed Programs: ${Array.isArray(user.completedPrograms) ? user.completedPrograms.join(', ') : 'None'}
                </div>
                <div>
                    ${inPending ? `
                        <button class="approve-btn" onclick="approveJoinRequest('${programId}','${user.id}')">Approve join</button>
                        <button class="reject-btn" onclick="rejectJoinRequest('${programId}','${user.id}')">Reject</button>
                    ` : finished ? `
                        <span style="display:inline-block;padding:8px 12px;border-radius:12px;background:#5cb85c;color:#fff;">Finished</span>
                    ` : inOfficial ? `
                        <button class="approve-btn" onclick="markVolunteerCompleted('${programId}','${user.id}')">Mark finished</button>
                    ` : `
                        <span style="display:inline-block;padding:8px 12px;border-radius:12px;background:#6c757d;color:#fff;">Not official</span>
                    `}
                </div>
            </div>
        `;
        }).join('') : '<div>No participants in this view yet.</div>'}
    `;
}

function onVolunteerProgramFilterChange() {
    updateVolunteerProgramParticipants();
    updateAttendanceProgramOptions();
}

function onVolunteerStatusFilterChange() {
    updateVolunteers();
    updateVolunteerProgramParticipants();
}

window.forceSyncData = () => {
    const activeTab = getCurrentActiveTab();
    try {
        users = JSON.parse(localStorage.getItem('itanimUsers') || '[]');
        programs = JSON.parse(localStorage.getItem('itanimPrograms') || '[]');
    } catch {
        users = [];
        programs = [];
    }
    updateDashboard();
    updateAnalytics();
    updatePrograms();
    updateVolunteers();
    updateVolunteerProgramFilter();
    updateVolunteerProgramParticipants();
    updateAttendanceProgramOptions();
    showTab(activeTab);
    alert('Manual sync complete.');
};

async function approveJoinRequest(programId, userId) {
    const program = programs.find(p => p.id === programId);
    const user = users.find(u => u.id === userId);
    if (!program || !user) {
        alert('Program or user not found.');
        return;
    }
    if (normalizeStatus(user.status) !== 'approved') {
        alert('User must be approved before joining programs.');
        return;
    }

    program.pendingJoins = Array.isArray(program.pendingJoins) ? program.pendingJoins : [];
    program.joined = Array.isArray(program.joined) ? program.joined : [];

    program.pendingJoins = program.pendingJoins.filter((id) => id !== userId);
    if (!program.joined.includes(userId)) {
        program.joined.push(userId);
    }

    user.enrolledPrograms = Array.isArray(user.enrolledPrograms) ? user.enrolledPrograms : [];
    if (!user.enrolledPrograms.includes(programId)) {
        user.enrolledPrograms.push(programId);
    }

    savePrograms();
    saveUsers();

    if (useFirestore) {
        try {
            await setDoc(doc(db, 'programs_empty', programId), {
                joined: program.joined,
                pendingJoins: program.pendingJoins
            }, { merge: true });
            await setDoc(doc(db, 'volunteers', userId), {
                enrolledPrograms: arrayUnion(programId)
            }, { merge: true });
        } catch (err) {
            console.warn('Could not sync join approval to Firestore', err);
        }
    }

    updateVolunteerProgramParticipants();
    alert(`${user.name} is now officially joined to ${program.name || program.title}.`);
}

async function rejectJoinRequest(programId, userId) {
    const program = programs.find(p => p.id === programId);
    const user = users.find(u => u.id === userId);
    if (!program || !user) {
        alert('Program or user not found.');
        return;
    }

    program.pendingJoins = Array.isArray(program.pendingJoins) ? program.pendingJoins : [];
    program.pendingJoins = program.pendingJoins.filter((id) => id !== userId);

    savePrograms();

    if (useFirestore) {
        try {
            await setDoc(doc(db, 'programs_empty', programId), {
                pendingJoins: program.pendingJoins
            }, { merge: true });
        } catch (err) {
            console.warn('Could not sync join rejection to Firestore', err);
        }
    }

    updateVolunteerProgramParticipants();
    alert(`Join request removed for ${user.name}.`);
}

async function markVolunteerCompleted(programId, userId) {
    const program = programs.find(p => p.id === programId);
    const user = users.find(u => u.id === userId);
    if (!program || !user) {
        alert('Program or user not found.');
        return;
    }
    program.joined = Array.isArray(program.joined) ? program.joined : [];
    if (!program.joined.includes(userId)) {
        alert('Only officially joined volunteers can be marked finished.');
        return;
    }
    user.enrolledPrograms = Array.isArray(user.enrolledPrograms) ? user.enrolledPrograms : [];
    user.completedPrograms = Array.isArray(user.completedPrograms) ? user.completedPrograms : [];
    if (user.completedPrograms.includes(programId)) {
        alert('This participant is already marked finished.');
        return;
    }
    user.completedPrograms.push(programId);
    user.hours = (user.hours || 0) + (program.hours || 0);
    updateBadge(user);
    saveUsers();

    if (useFirestore) {
        try {
            await setDoc(doc(db, 'volunteers', userId), {
                hours: user.hours,
                enrolledPrograms: arrayUnion(programId),
                completedPrograms: arrayUnion(programId)
            }, { merge: true });
        } catch (err) {
            console.warn('Could not update volunteer completion in Firestore', err);
        }
    }

    updateVolunteerProgramParticipants();
    updateVolunteers();
    updateDashboard();
    updateAnalytics();
    alert(`${user.name} has been marked finished for ${program.name || program.title}. Hours updated.`);
}

window.markVolunteerCompleted = markVolunteerCompleted;
window.approveJoinRequest = approveJoinRequest;
window.rejectJoinRequest = rejectJoinRequest;
window.updateAttendanceVolunteerOptions = updateAttendanceVolunteerOptions;
window.onVolunteerProgramFilterChange = onVolunteerProgramFilterChange;
window.onVolunteerStatusFilterChange = onVolunteerStatusFilterChange;

async function markVolunteerAbsent(programId, userId) {
    const program = programs.find(p => p.id === programId);
    const user = users.find(u => u.id === userId);
    if (!program || !user) {
        alert('Program or user not found.');
        return;
    }

    program.joined = Array.isArray(program.joined) ? program.joined : [];
    if (!program.joined.includes(userId)) {
        alert('Only officially joined volunteers can be marked absent.');
        return;
    }

    program.joined = program.joined.filter((id) => id !== userId);
    program.absent = Array.isArray(program.absent) ? program.absent : [];
    if (!program.absent.includes(userId)) {
        program.absent.push(userId);
    }

    user.enrolledPrograms = Array.isArray(user.enrolledPrograms) ? user.enrolledPrograms : [];
    user.enrolledPrograms = user.enrolledPrograms.filter((id) => id !== programId);
    user.absentPrograms = Array.isArray(user.absentPrograms) ? user.absentPrograms : [];
    if (!user.absentPrograms.includes(programId)) {
        user.absentPrograms.push(programId);
    }

    savePrograms();
    saveUsers();

    if (useFirestore) {
        try {
            await setDoc(doc(db, 'programs_empty', programId), {
                joined: program.joined,
                absent: program.absent
            }, { merge: true });
            await setDoc(doc(db, 'volunteers', userId), {
                enrolledPrograms: arrayRemove(programId),
                absentPrograms: arrayUnion(programId)
            }, { merge: true });
        } catch (err) {
            console.warn('Could not sync absent update to Firestore', err);
        }
    }

    updateVolunteerProgramParticipants();
    updateAttendanceVolunteerOptions();
    alert(`${user.name} was marked absent for ${program.name || program.title}.`);
}

async function markVolunteerFinishedFromSelection() {
    const programId = document.getElementById('attendanceProgramSelect')?.value;
    const userId = document.getElementById('attendanceVolunteerSelect')?.value;
    if (!programId || !userId) {
        alert('Please select a program and volunteer.');
        return;
    }
    await markVolunteerCompleted(programId, userId);
    updateAttendanceVolunteerOptions();
}

async function markVolunteerAbsentFromSelection() {
    const programId = document.getElementById('attendanceProgramSelect')?.value;
    const userId = document.getElementById('attendanceVolunteerSelect')?.value;
    if (!programId || !userId) {
        alert('Please select a program and volunteer.');
        return;
    }
    await markVolunteerAbsent(programId, userId);
}

window.markVolunteerFinishedFromSelection = markVolunteerFinishedFromSelection;
window.markVolunteerAbsentFromSelection = markVolunteerAbsentFromSelection;

function hasCompletedProgram(user, programId) {
    return Array.isArray(user.completedPrograms) && user.completedPrograms.includes(programId);
}

function approveUser(id) {
    const user = users.find(u => u.id === id);
    if (user) {
        user.status = 'approved';
        saveUsers();
        updateVolunteers();
        sendNotification(`Your application has been approved!`, 'application', user.email);
        logAction('volunteer_approve', `Approved volunteer: ${user.name} (${user.email})`, { userId: id, userEmail: user.email });
        // Update Firestore
        if (useFirestore) {
            updateDoc(doc(db, 'volunteers', id), { status: 'approved' }).catch(err => console.warn('Could not update Firestore', err));
        }
    }
}

function rejectUser(id) {
    const user = users.find(u => u.id === id);
    if (user) {
        user.status = 'rejected';
        saveUsers();
        updateVolunteers();
        sendNotification(`Your application has been rejected.`, 'application', user.email);
        logAction('volunteer_reject', `Rejected volunteer: ${user.name} (${user.email})`, { userId: id, userEmail: user.email });
        // Update Firestore
        if (useFirestore) {
            updateDoc(doc(db, 'volunteers', id), { status: 'rejected' }).catch(err => console.warn('Could not update Firestore', err));
        }
    }
}

// Restrictions
function loadRestrictionsUI() {
    document.getElementById('minAge').value = restrictions.minAge;
    document.getElementById('validBarangays').value = restrictions.validBarangays;
}

function updateRestrictions() {
    loadRestrictionsUI();
}

function saveRestrictionsFromUI() {
    restrictions.minAge = parseInt(document.getElementById('minAge').value);
    restrictions.validBarangays = document.getElementById('validBarangays').value;
    saveRestrictions();
    alert('Restrictions updated!');
}

// Skills
function updateSkills() {
    document.getElementById('skillList').innerHTML = skills.map(skill => `
        <li>${skill} <button class="edit-btn" onclick="editSkill('${skill.replace(/'/g, "\\'")}')">Edit</button> <button class="delete-btn" onclick="deleteSkill('${skill.replace(/'/g, "\\'")}')">Delete</button></li>
    `).join('');
}

function addSkill() {
    const newSkill = document.getElementById('newSkill').value.trim();
    if (newSkill && !skills.includes(newSkill)) {
        skills.push(newSkill);
        saveSkills();
        updateSkills();
        document.getElementById('newSkill').value = '';
    }
}

function deleteSkill(skill) {
    skills = skills.filter(s => s !== skill);
    saveSkills();
    updateSkills();
}

function editSkill(skill) {
    const updated = prompt('Edit skill category:', skill);
    if (!updated) return;
    const normalized = updated.trim();
    if (!normalized) return;
    if (skills.includes(normalized) && normalized !== skill) {
        alert('Skill already exists.');
        return;
    }
    skills = skills.map((s) => s === skill ? normalized : s);
    saveSkills();
    updateSkills();
}

// Programs
function updatePrograms() {
    // Always pull latest programs from local cache source.
    refreshLocalAdminCache();

    const list = document.getElementById('programList');
    list.innerHTML = programs.map(p => {
        const assignedCount = Array.isArray(p.assigned) ? p.assigned.length : 0;
        const maxVolunteers = p.maxVolunteers ?? 0;
        return `
        <div class="program-item">
            <div>
                <strong>${p.name || p.title || 'Untitled Program'}</strong><br>
                ${p.desc || ''}<br>
                Hours: ${p.hours ?? 0}, Requirement: ${p.requirement || 'None'}<br>
                Max Volunteers: ${maxVolunteers}, Assigned: ${assignedCount}/${maxVolunteers}<br>
                Status: ${assignedCount >= maxVolunteers && maxVolunteers > 0 ? 'unavailable (full)' : (p.status || 'active')}
            </div>
            <div>
                <button class="edit-btn" onclick="editProgram('${p.id}')">Edit</button>
                ${p.status === 'active' ? `<button class="archive-btn" onclick="archiveProgram('${p.id}')">Archive</button>` : ''}
                <button class="delete-btn" onclick="deleteProgram('${p.id}')">Delete</button>
            </div>
        </div>
    `;
    }).join('');
}

function showProgramModal(programId = null) {
    const modal = document.getElementById('programModal');
    const title = document.getElementById('programModalTitle');
    const name = document.getElementById('programName');
    const desc = document.getElementById('programDesc');
    const hours = document.getElementById('programHours');
    const maxVol = document.getElementById('programMaxVolunteers');

    if (programId) {
        const program = programs.find(p => p.id === programId);
        title.textContent = 'Edit Program';
        name.value = program.name;
        desc.value = program.desc;
        hours.value = program.hours;
        maxVol.value = program.maxVolunteers;
        document.getElementById('programRequirement').value = program.requirement || 'None';
        // show existing attachments
        renderProgramAttachmentPreview(program.attachments || []);
        // do not auto-populate file input for security reasons
        const input = document.getElementById('programAttachments');
        if (input) input.value = '';
        modal.dataset.editId = programId;
    } else {
        title.textContent = 'Create Program';
        name.value = '';
        desc.value = '';
        hours.value = '';
        document.getElementById('programRequirement').value = 'None';
        maxVol.value = '';
        clearAttachmentInput();
        delete modal.dataset.editId;
    }
    modal.style.display = 'flex';
}

function closeProgramModal() {
    document.getElementById('programModal').style.display = 'none';
}

async function saveProgram() {
    console.log("Admin saveProgram called");
    console.log("useFirestore:", useFirestore);
    console.log("auth.currentUser:", auth.currentUser);

    const name = document.getElementById('programName').value.trim();
    const desc = document.getElementById('programDesc').value.trim();
    const hours = parseInt(document.getElementById('programHours').value);
    const requirement = document.getElementById('programRequirement').value || 'None';
    let maxVol = parseInt(document.getElementById('programMaxVolunteers').value);
    if (Number.isNaN(maxVol) || maxVol <= 0) {
        // Allow saving without explicitly filling max volunteers (common on localhost demos)
        maxVol = 10;
    }

    console.log("Form values:", { name, desc, hours, requirement, maxVol });

    if (!name || !desc || Number.isNaN(hours) || hours <= 0) {
        alert('Please fill all required fields (name, description, hours).');
        return;
    }

    const modal = document.getElementById('programModal');
    const editId = modal.dataset.editId;
    const newAttachments = await getAttachmentsFromInput();

    console.log("editId:", editId);

    if (editId) {
        const program = programs.find(p => p.id === editId);
        program.name = name;
        program.desc = desc;
        program.hours = hours;
        program.requirement = requirement;
        program.maxVolunteers = maxVol;
        // Only replace attachments if user selected new ones; otherwise keep existing.
        if (newAttachments.length > 0) {
            program.attachments = newAttachments;
        } else {
            program.attachments = program.attachments || [];
        }
        logAction('program_update', `Updated program: "${name}"`, { programId: editId });
    } else {
        const newProgram = {
            id: `program${Date.now()}`,
            name,
            desc,
            hours,
            requirement,
            maxVolunteers: maxVol,
            assigned: [],
            status: 'active',
            attachments: newAttachments
        };
        console.log("New program to add:", newProgram);
        programs.push(newProgram);
        logAction('program_add', `Created program: "${name}" (${hours} hours)`, { programId: newProgram.id, hours });
    }

    savePrograms();
    syncProgramsFromPrograms();
    updatePrograms();
    closeProgramModal();
}

function editProgram(id) {
    showProgramModal(id);
}

function archiveProgram(id) {
    const program = programs.find(p => p.id === id);
    if (program) {
        program.status = 'completed';
        savePrograms();
        syncProgramsFromPrograms();
        updatePrograms();
    }
}

async function deleteProgram(id) {
    const programName = programs.find(p => p.id === id)?.name || 'Unknown';
    programs = programs.filter(p => p.id !== id);
    savePrograms();
    await syncProgramsFromPrograms();
    if (useFirestore) {
        try {
            await deleteDoc(doc(db, 'programs_empty', id));
        } catch (err) {
            console.warn('Could not delete program document from Firestore', err);
        }
    }
    logAction('program_delete', `Deleted program: "${programName}"`, { programId: id });
    updatePrograms();
}

// Validation
function updateValidation() {
    const submitted = programs.filter(p => p.status === 'completed' && !p.validated);
    document.getElementById('submittedPrograms').innerHTML = submitted.map(p => `
        <div class="program-item">
            <div>
                <strong>${p.name}</strong><br>
                Completed by: ${p.assigned.join(', ')}<br>
                Hours: ${p.hours}
            </div>
            <div>
                <button class="approve-btn" onclick="approveProgram('${p.id}')">Approve</button>
                <button class="reject-btn" onclick="rejectProgram('${p.id}')">Reject</button>
            </div>
        </div>
    `).join('');
}

async function approveProgram(id) {
    const program = programs.find(p => p.id === id);
    if (program) {
        program.validated = true;
        const participants = Array.isArray(program.assigned) && program.assigned.length > 0 ? program.assigned : Array.isArray(program.joined) ? program.joined : [];
        for (const userId of participants) {
            const user = users.find(u => u.id === userId);
            if (user) {
                user.hours = (user.hours || 0) + (program.hours || 0);
                user.enrolledPrograms = Array.isArray(user.enrolledPrograms) ? user.enrolledPrograms : [];
                if (!user.enrolledPrograms.includes(id)) {
                    user.enrolledPrograms.push(id);
                }
                user.completedPrograms = Array.isArray(user.completedPrograms) ? user.completedPrograms : [];
                if (!user.completedPrograms.includes(id)) {
                    user.completedPrograms.push(id);
                }
                updateBadge(user);

                if (useFirestore) {
                    try {
                        await setDoc(doc(db, 'volunteers', user.id), {
                            hours: user.hours,
                            enrolledPrograms: arrayUnion(id),
                            completedPrograms: arrayUnion(id)
                        }, { merge: true });
                    } catch (err) {
                        console.warn('Could not update volunteer completion in Firestore', err);
                    }
                }
            }
        }
        saveUsers();
        savePrograms();
        updateValidation();
        updateDashboard();
        updateAnalytics();
        sendNotification(`Program "${program.name}" has been approved! You earned ${program.hours} hours.`, 'program', participants.map(uid => users.find(u => u.id === uid)?.email).filter(Boolean));
    }
}

function rejectProgram(id) {
    const program = programs.find(p => p.id === id);
    if (program) {
        program.status = 'active';
        program.validated = false;
        savePrograms();
        updateValidation();
        const participants = Array.isArray(program.assigned) ? program.assigned : Array.isArray(program.joined) ? program.joined : [];
        sendNotification(`Program "${program.name}" has been rejected and returned to In Progress.`, 'program', participants.map(uid => users.find(u => u.id === uid)?.email).filter(Boolean));
    }
}

function updateBadge(user) {
    const hours = user.hours || 0;
    if (hours >= badgeThresholds.platinum) user.badge = 'Platinum';
    else if (hours >= badgeThresholds.gold) user.badge = 'Gold';
    else if (hours >= badgeThresholds.silver) user.badge = 'Silver';
    else if (hours >= badgeThresholds.bronze) user.badge = 'Bronze';
    else user.badge = 'None';
}

// Badges
function updateBadges() {
    document.getElementById('bronzeThreshold').value = badgeThresholds.bronze;
    document.getElementById('silverThreshold').value = badgeThresholds.silver;
    document.getElementById('goldThreshold').value = badgeThresholds.gold;
    document.getElementById('platinumThreshold').value = badgeThresholds.platinum;
}

function updateBadgeThresholds() {
    badgeThresholds.bronze = parseInt(document.getElementById('bronzeThreshold').value);
    badgeThresholds.silver = parseInt(document.getElementById('silverThreshold').value);
    badgeThresholds.gold = parseInt(document.getElementById('goldThreshold').value);
    badgeThresholds.platinum = parseInt(document.getElementById('platinumThreshold').value);
    saveBadges();
    // Update all user badges
    users.forEach(updateBadge);
    saveUsers();
    alert('Badge thresholds updated!');
}

// Certifications
function getUserCertificationEligibility(user) {
    const hours = Number(user?.hours || 0);
    const completedCount = Array.isArray(user?.completedPrograms) ? user.completedPrograms.length : 0;
    return {
        eligible: hours > 0 && completedCount > 0,
        hours,
        completedCount
    };
}

function getCertificationStatusBadge(status) {
    const normalized = String(status || '').toLowerCase().trim();
    const colorMap = {
        requested: { bg: '#f0ad4e', text: '#1f1f1f', label: 'Requested' },
        approved: { bg: '#5cb85c', text: '#ffffff', label: 'Approved' },
        rejected: { bg: '#d9534f', text: '#ffffff', label: 'Rejected' },
        cancelled: { bg: '#6c757d', text: '#ffffff', label: 'Cancelled' },
        pending: { bg: '#f0ad4e', text: '#1f1f1f', label: 'Pending' }
    };
    const style = colorMap[normalized] || { bg: '#6c757d', text: '#ffffff', label: normalized || 'Unknown' };
    return `<span style="display:inline-block;padding:4px 10px;border-radius:999px;background:${style.bg};color:${style.text};font-size:12px;font-weight:700;">${style.label}</span>`;
}

function updateCertifications() {
    const list = document.getElementById('certRequests');
    const eligibleUsers = users.filter((u) => {
        const eligibility = getUserCertificationEligibility(u);
        const hasActiveOrApproved = certifications.some((c) => c.userId === u.id && ['requested', 'approved'].includes(c.status));
        return eligibility.eligible && !hasActiveOrApproved;
    });

    const requested = certifications.filter((c) => c.status === 'requested');
    const reviewed = certifications.filter((c) => ['approved', 'rejected', 'cancelled'].includes(c.status));

    const eligibleMarkup = eligibleUsers.length > 0
        ? eligibleUsers.map((u) => {
            const e = getUserCertificationEligibility(u);
            return `<li>${u.name} (${u.email}) - ${e.hours} hrs, ${e.completedCount} completed programs</li>`;
        }).join('')
        : '<li>No additional eligible users right now.</li>';

    const certMarkup = [...requested, ...reviewed].map(c => {
        const user = users.find(u => u.id === c.userId);
        const eligibility = getUserCertificationEligibility(user || {});
        const program = c.programId ? programs.find(p => p.id === c.programId) : null;
        const programLabel = c.programTitle || program?.name || program?.title || '';
        return `
            <div class="cert-item">
                <div>
                    <strong>${user?.name || 'Unknown'}</strong><br>
                    Email: ${user?.email || 'N/A'}<br>
                    Hours: ${eligibility.hours}, Badge: ${user?.badge || 'None'}<br>
                    Completed Programs: ${eligibility.completedCount}<br>
                    ${programLabel ? `Program: ${programLabel}<br>` : ''}
                    Status: ${getCertificationStatusBadge(c.status)}<br>
                    Requested: ${c.requestedAt ? new Date(c.requestedAt).toLocaleString() : 'N/A'}<br>
                    Proof: ${c.proofDetails || 'Not provided'}<br>
                    ${c.adminNote ? `Admin Note: ${c.adminNote}<br>` : ''}
                </div>
                <div>
                    ${c.status === 'pending' ? `
                        <button class="approve-btn" onclick="approveCert('${c.id}')">Approve</button>
                        <button class="reject-btn" onclick="rejectCert('${c.id}')">Reject</button>
                    ` : c.status === 'requested' ? `
                        <button class="approve-btn" onclick="approveCert('${c.id}')">Approve</button>
                        <button class="reject-btn" onclick="rejectCert('${c.id}')">Reject</button>
                        <button class="archive-btn" onclick="cancelCert('${c.id}')">Cancel</button>
                        <button class="edit-btn" onclick="editCert('${c.id}')">Edit</button>
                    ` : `
                        <button class="edit-btn" onclick="editCert('${c.id}')">Edit</button>
                        ${c.status !== 'cancelled' ? `<button class="archive-btn" onclick="cancelCert('${c.id}')">Cancel</button>` : ''}
                    `}
                </div>
            </div>
        `;
    }).join('');

    list.innerHTML = `
        <div class="cert-item">
            <strong>Eligible Users (No active request yet)</strong>
            <ul style="margin:8px 0 0 18px;">${eligibleMarkup}</ul>
        </div>
        ${certMarkup || '<p>No certification records yet.</p>'}
    `;
}

function approveCert(id) {
    const cert = certifications.find(c => c.id === id);
    if (cert) {
        const user = users.find(u => u.id === cert.userId);
        const eligibility = getUserCertificationEligibility(user || {});
        if (!eligibility.eligible) {
            alert('Cannot approve: user is not eligible (hours/completed programs requirements not met).');
            return;
        }
        if (!cert.proofDetails || String(cert.proofDetails).trim().length < 10) {
            alert('Cannot approve: proof details are missing or too short.');
            return;
        }
        cert.status = 'approved';
        cert.name = cert.name || 'Volunteer Certification';
        cert.description = cert.description || `Approved certification for ${user?.name || cert.userEmail || 'volunteer'}`;
        cert.issuedDate = new Date().toISOString().slice(0, 10);
        cert.validUntil = `${new Date().getFullYear() + 1}-12-31`;
        cert.approvedAt = new Date().toISOString();
        cert.certificateType = user?.badge && user.badge !== 'None' ? 'with_badge' : 'without_badge';
        cert.adminNote = cert.adminNote || `Approved after verification (${eligibility.hours} hrs, ${eligibility.completedCount} completed).`;
        saveCerts();
        updateCertifications();
        sendNotification(`Your certification request has been approved!`, 'certification', user?.email);
    }
}

function rejectCert(id) {
    const cert = certifications.find(c => c.id === id);
    if (cert) {
        const reason = prompt('Reject reason (optional):', cert.adminNote || '') || '';
        cert.status = 'rejected';
        cert.adminNote = reason.trim() || 'Rejected by admin.';
        cert.rejectedAt = new Date().toISOString();
        saveCerts();
        updateCertifications();
        const user = users.find(u => u.id === cert.userId);
        sendNotification(`Your certification request has been rejected.${reason ? ` Reason: ${reason}` : ''}`, 'certification', user?.email);
    }
}

function cancelCert(id) {
    const cert = certifications.find(c => c.id === id);
    if (!cert) return;
    const reason = prompt('Cancellation note:', cert.adminNote || '') || '';
    cert.status = 'cancelled';
    cert.adminNote = reason.trim() || 'Cancelled by admin.';
    cert.cancelledAt = new Date().toISOString();
    saveCerts();
    updateCertifications();
    const user = users.find(u => u.id === cert.userId);
    sendNotification(`Your certification has been cancelled.${reason ? ` Note: ${reason}` : ''}`, 'certification', user?.email);
}

function editCert(id) {
    const cert = certifications.find(c => c.id === id);
    if (!cert) return;
    const nextName = prompt('Certificate title:', cert.name || 'Volunteer Certification');
    if (!nextName) return;
    const nextDescription = prompt('Certificate description:', cert.description || '');
    if (nextDescription === null) return;
    cert.name = nextName.trim() || cert.name || 'Volunteer Certification';
    cert.description = nextDescription.trim() || cert.description || '';
    cert.updatedAt = new Date().toISOString();
    saveCerts();
    updateCertifications();
}

// Notifications
function updateNotifications() {
    document.getElementById('notificationHistory').innerHTML = notifications.slice(-10).reverse().map(n => `
        <div style="padding: 10px; margin: 5px 0; background: var(--glass); border-radius: 8px;">
            <strong>${n.type}</strong>: ${n.message}<br>
            <small>To: ${n.recipient}</small>
        </div>
    `).join('');
}

function sendNotification(message, type, recipient) {
    if (!message || !type || !recipient) {
        const inputMessage = document.getElementById('notificationMessage')?.value?.trim();
        const inputType = document.getElementById('notificationType')?.value || 'application';
        if (!inputMessage) {
            alert('Please enter a notification message.');
            return;
        }
        const approvedEmails = users
            .filter((u) => normalizeStatus(u.status) === 'approved' && u.email)
            .map((u) => u.email);
        if (approvedEmails.length === 0) {
            alert('No approved users available to notify.');
            return;
        }
        message = inputMessage;
        type = inputType;
        recipient = approvedEmails;
    }

    const notification = {
        id: Date.now(),
        message,
        type,
        recipient: Array.isArray(recipient) ? recipient.join(', ') : recipient,
        timestamp: new Date().toISOString()
    };
    notifications.push(notification);
    saveNotifications();
    updateNotifications();
    console.log(`Notification sent: ${message} to ${notification.recipient}`);
    alert(`Notification sent to ${notification.recipient}`);
}

// Logout
async function logoutAdmin() {
    try {
        const userEmail = auth.currentUser?.email || 'admin';
        logAction('user_logout', `Admin logged out: ${userEmail}`, { userType: 'admin' });
        await signOut(auth);
        window.location.href = 'index.html';
    } catch (error) {
        console.error("Logout error:", error);
        logAction('error', `Logout failed: ${error.message}`, { error: true });
        alert("Logout failed. Please try again.");
    }
}

async function loadAdminSession() {
    onAuthStateChanged(auth, async (user) => {
        if (!user) {
            redirectOnce('login.html');
            return;
        }

        if (isAdminEmail(user.email)) {
            cacheRole(user.uid, 'admin');
            renderAdminShell();
            restoreActiveTab();
            revealApp();
        }

        const cachedRole = getCachedRole(user.uid);
        if (cachedRole === 'admin') {
            renderAdminShell();
            restoreActiveTab();
            revealApp();
        }

        try {
            let userDoc = await getDoc(doc(db, 'volunteers', user.uid));
            if (!userDoc.exists()) {
                const fallbackQuery = query(collection(db, 'volunteers'), where('email', '==', user.email));
                const fallbackSnap = await getDocs(fallbackQuery);
                if (!fallbackSnap.empty) {
                    userDoc = fallbackSnap.docs[0];
                }
            }
            const role = userDoc.exists() ? normalizeRole(userDoc.data().role) : 'user';
            if (role !== 'admin' && !isAdminEmail(user.email)) {
                redirectOnce('user.html');
                return;
            }
            cacheRole(user.uid, role === 'admin' ? role : 'admin');
        } catch (err) {
            console.warn('Could not verify admin role', err);
            redirectOnce('login.html');
            return;
        }

        renderAdminShell();
        restoreActiveTab();
        revealApp();

        // Attachment preview behavior
        const attachmentInput = document.getElementById('taskAttachments');
        if (attachmentInput) {
            attachmentInput.addEventListener('change', async () => {
                try {
                    const atts = await getAttachmentsFromInput();
                    renderTaskAttachmentPreview(atts);
                } catch (err) {
                    console.warn(err);
                    renderTaskAttachmentPreview([]);
                }
            });
        }

        // Ensure programs mirror is present on load
        if (!realtimeInitialized) {
            realtimeInitialized = true;
            syncProgramsFromTasks();
            initFirestoreAdminState();
        }
        hasResolvedAuth = true;
    });
}

// Export all admin functions to window for onclick handlers
window.logoutAdmin = logoutAdmin;
window.showTab = showTab;

function showTaskModal() {
    console.warn('showTaskModal() is not implemented in this build.');
}

function closeTaskModal() {
    console.warn('closeTaskModal() is not implemented in this build.');
}

function saveTask() {
    console.warn('saveTask() is not implemented in this build.');
}

function editTask() {
    console.warn('editTask() is not implemented in this build.');
}

function archiveTask() {
    console.warn('archiveTask() is not implemented in this build.');
}

function deleteTask() {
    console.warn('deleteTask() is not implemented in this build.');
}

// ===== LOGGING SYSTEM =====
let allLogs = JSON.parse(localStorage.getItem('itanimAdminLogs') || '[]');

async function logAction(actionType, actionDetail, metadata = {}) {
    const logEntry = {
        id: `log-${Date.now()}`,
        timestamp: new Date().toISOString(),
        actionType,
        actionDetail,
        userId: auth.currentUser?.uid || 'system',
        userEmail: auth.currentUser?.email || 'system',
        metadata
    };

    allLogs.unshift(logEntry); // Add to beginning for most recent first
    if (allLogs.length > 10000) allLogs.pop(); // Keep last 10000 logs

    localStorage.setItem('itanimAdminLogs', JSON.stringify(allLogs));

    // Also save to Firestore
    if (useFirestore) {
        try {
            const logsRef = collection(db, 'admin_logs');
            await addDoc(logsRef, logEntry);
        } catch (err) {
            console.warn('Could not save log to Firestore', err);
        }
    }

    console.log(`[LOG] ${actionType}: ${actionDetail}`, metadata);
}

function filterLogs(searchTerm = '', filterType = '') {
    return allLogs.filter(log => {
        const matchesSearch = !searchTerm || 
            log.actionType.toLowerCase().includes(searchTerm.toLowerCase()) ||
            log.actionDetail.toLowerCase().includes(searchTerm.toLowerCase()) ||
            log.userEmail.toLowerCase().includes(searchTerm.toLowerCase());
        
        const matchesType = !filterType || log.actionType === filterType;
        
        return matchesSearch && matchesType;
    });
}

window.clearAllLogs = () => {
    if (confirm('Are you sure you want to delete all logs? This cannot be undone.')) {
        allLogs = [];
        localStorage.setItem('itanimAdminLogs', JSON.stringify(allLogs));
        renderLogs();
        alert('All logs cleared.');
    }
};

window.exportLogs = () => {
    const logsText = allLogs.map(log => 
        `[${log.timestamp}] ${log.actionType}: ${log.actionDetail} (${log.userEmail})`
    ).join('\n');
    
    const blob = new Blob([logsText], { type: 'text/plain' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `admin-logs-${new Date().toISOString().slice(0, 10)}.txt`;
    document.body.appendChild(a);
    a.click();
    window.URL.revokeObjectURL(url);
    document.body.removeChild(a);
};

function renderLogs() {
    const searchTerm = document.getElementById('logSearchInput')?.value || '';
    const filterType = document.getElementById('logFilterType')?.value || '';
    
    const filteredLogs = filterLogs(searchTerm, filterType);
    const logsList = document.getElementById('logsList');

    if (!logsList) return;

    if (filteredLogs.length === 0) {
        logsList.innerHTML = '<div style="padding: 20px; text-align: center; color: #999;">No logs found</div>';
        return;
    }

    logsList.innerHTML = filteredLogs.map(log => {
        const date = new Date(log.timestamp);
        const timeStr = date.toLocaleTimeString();
        const dateStr = date.toLocaleDateString();
        
        let actionColor = '#546B41'; // default green
        if (log.actionType.includes('error') || log.actionType.includes('reject')) actionColor = '#d9534f'; // red
        if (log.actionType.includes('approve')) actionColor = '#5cb85c'; // green
        if (log.actionType.includes('warning')) actionColor = '#f0ad4e'; // orange

        return `
            <div style="padding: 12px; border-bottom: 1px solid #e0e0e0; display: flex; justify-content: space-between; align-items: start; gap: 10px;">
                <div style="flex: 1;">
                    <div style="font-weight: bold; color: ${actionColor};">${log.actionType}</div>
                    <div style="color: #333; margin: 4px 0;">${log.actionDetail}</div>
                    <div style="font-size: 12px; color: #999;">
                        ${dateStr} ${timeStr} • ${log.userEmail}
                    </div>
                    ${Object.keys(log.metadata).length > 0 ? `
                        <div style="font-size: 12px; color: #666; margin-top: 4px;">
                            <strong>Metadata:</strong> ${JSON.stringify(log.metadata)}
                        </div>
                    ` : ''}
                </div>
            </div>
        `;
    }).join('');
}

window.renderLogs = renderLogs;

// Initialize logs search and filter listeners
document.addEventListener('DOMContentLoaded', () => {
    const logSearch = document.getElementById('logSearchInput');
    const logFilter = document.getElementById('logFilterType');

    if (logSearch) {
        logSearch.addEventListener('input', renderLogs);
    }
    if (logFilter) {
        logFilter.addEventListener('change', renderLogs);
    }
});

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    loadAdminSession();
});

// Keep Admin UI in sync when another page updates localStorage
// (e.g., index add program, user join request) in localhost mode.
window.addEventListener('storage', (event) => {
    if (useFirestore) return;
    if (event.key === 'itanimPrograms' || event.key === 'itanimUsers') {
        try {
            programs = JSON.parse(localStorage.getItem('itanimPrograms') || '[]');
            users = JSON.parse(localStorage.getItem('itanimUsers') || '[]');
        } catch {
            programs = [];
            users = [];
        }
        updateDashboard();
        updateAnalytics();
        updatePrograms();
        updateVolunteers();
        updateVolunteerProgramFilter();
        updateVolunteerProgramParticipants();
        updateAttendanceProgramOptions();
    }
});

window.saveRestrictionsFromUI = saveRestrictionsFromUI;
window.addSkill = addSkill;
window.deleteSkill = deleteSkill;
window.editSkill = editSkill;
window.showTaskModal = showTaskModal;
window.closeTaskModal = closeTaskModal;
window.saveTask = saveTask;
window.editTask = editTask;
window.archiveTask = archiveTask;
window.deleteTask = deleteTask;
window.approveUser = approveUser;
window.rejectUser = rejectUser;
window.updateBadgeThresholds = updateBadgeThresholds;
window.approveCert = approveCert;
window.rejectCert = rejectCert;
window.cancelCert = cancelCert;
window.editCert = editCert;
window.sendNotification = sendNotification;
window.updateRestrictions = saveRestrictionsFromUI;
window.showProgramModal = showProgramModal;
window.closeProgramModal = closeProgramModal;
window.saveProgram = saveProgram;
window.editProgram = editProgram;
window.archiveProgram = archiveProgram;
window.deleteProgram = deleteProgram;
window.approveProgram = approveProgram;
window.rejectProgram = rejectProgram;

window.debugAuthState = () => {
    console.log("=== ADMIN AUTH DEBUG ===");
    console.log("auth.currentUser:", auth.currentUser);
    console.log("useFirestore:", useFirestore);
    console.log("Firebase config projectId:", firebaseConfig.projectId);
    console.log("========================");
    alert(`Auth: ${auth.currentUser ? 'Logged in as ' + auth.currentUser.email : 'Not logged in'}\nFirestore: ${useFirestore ? 'Enabled' : 'Disabled'}`);
};
window.saveProgram = saveProgram;
